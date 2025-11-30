import React, { useState, useEffect, useCallback, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from 'recharts';
import * as d3 from 'd3';
import SolarHouse3D from './SolarHouse3D';

// ============================================================
// 配置 - 修改这里的 API 地址
// ============================================================
//const API_BASE = 'http://localhost:5002';
const API_BASE = `http://${window.location.hostname}:5002`;

// ============================================================
// 工具函数
// ============================================================
const formatDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getToday = () => formatDate(new Date());

// ============================================================
// 模块标题组件
// ============================================================
const SectionTitle = ({ icon, title, subtitle }) => (
  <div className="mb-3">
    <h2 className="text-lg font-bold text-white flex items-center gap-2">
      <span className="text-xl">{icon}</span>
      <span>{title}</span>
    </h2>
    {subtitle && <p className="text-gray-400 text-xs">{subtitle}</p>}
  </div>
);

// ============================================================
// 模块容器组件
// ============================================================
const SectionContainer = ({ children, className = "" }) => (
  <div className={`bg-gray-900/50 rounded-2xl p-4 border border-gray-800 ${className}`}>
    {children}
  </div>
);

// ============================================================
// 日期选择器组件
// ============================================================
const DateRangePicker = ({ startDate, endDate, onStartDateChange, onEndDateChange, onApply }) => {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <label className="text-gray-400 text-sm">开始:</label>
        <input
          type="date"
          value={startDate}
          onChange={(e) => onStartDateChange(e.target.value)}
          className="bg-gray-700 text-white px-3 py-1.5 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-gray-400 text-sm">结束:</label>
        <input
          type="date"
          value={endDate}
          onChange={(e) => onEndDateChange(e.target.value)}
          className="bg-gray-700 text-white px-3 py-1.5 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
        />
      </div>
      <button
        onClick={() => onApply()}
        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded font-medium transition-colors"
      >
        查询
      </button>
      <button
        onClick={() => {
          const today = getToday();
          onStartDateChange(today);
          onEndDateChange(today);
          onApply(today, today);
        }}
        className="bg-gray-600 hover:bg-gray-500 text-white px-3 py-1.5 rounded text-sm transition-colors"
      >
        今天
      </button>
      <button
        onClick={() => {
          const today = formatDate(new Date());
          const weekAgo = formatDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
          onStartDateChange(weekAgo);
          onEndDateChange(today);
          onApply(weekAgo, today);
        }}
        className="bg-gray-600 hover:bg-gray-500 text-white px-3 py-1.5 rounded text-sm transition-colors"
      >
        最近7天
      </button>
      <button
        onClick={() => {
          const today = formatDate(new Date());
          const monthAgo = formatDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
          onStartDateChange(monthAgo);
          onEndDateChange(today);
          onApply(monthAgo, today);
        }}
        className="bg-gray-600 hover:bg-gray-500 text-white px-3 py-1.5 rounded text-sm transition-colors"
      >
        最近30天
      </button>
    </div>
  );
};


// ============================================================
// D3 Sankey 图组件
// ============================================================
const SankeyFlow = ({ data, title = "能量流向", unit = "kW", height = 420, instanceId = "default" }) => {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(700);

  const { 
    solar = 0, 
    battery_discharge = 0, 
    grid_import = 0, 
    battery_charge = 0, 
    load = 0, 
    grid_export = 0, 
    battery_net = 0 
  } = data || {};

  // 计算电池净值：避免同时显示充电和放电
  // 如果有 battery_net，用它来决定方向
  // 否则用 battery_charge 和 battery_discharge 的差值
  let batteryIn = 0;
  let batteryOut = 0;
  
  if (battery_net !== undefined && Math.abs(battery_net) > 0.001) {
    // 有 battery_net 值，用它决定方向
    if (battery_net > 0) {
      batteryIn = battery_net;  // 正值表示充电
      batteryOut = 0;
    } else {
      batteryIn = 0;
      batteryOut = -battery_net;  // 负值表示放电
    }
  } else {
    // 没有 battery_net，用充放电差值
    const netCharge = battery_charge - battery_discharge;
    if (netCharge > 0.001) {
      batteryIn = netCharge;  // 净充电
      batteryOut = 0;
    } else if (netCharge < -0.001) {
      batteryIn = 0;
      batteryOut = -netCharge;  // 净放电
    } else {
      // 充放电基本相等，都显示为0
      batteryIn = 0;
      batteryOut = 0;
    }
  }

  // 总输入和总输出
  const totalInput = solar + batteryOut + grid_import;
  const totalOutput = load + batteryIn + grid_export;

  // 节点颜色
  const nodeColors = {
    "Solar": "#FCD34D",
    "Battery Out": "#22D3EE",
    "Grid In": "#60A5FA",
    "Battery In": "#22D3EE",
    "Load": "#A78BFA",
    "Grid Out": "#34D399",
  };

  // 节点原始值
  const nodeValues = {
    "Solar": solar,
    "Battery Out": batteryOut,
    "Grid In": grid_import,
    "Battery In": batteryIn,
    "Load": load,
    "Grid Out": grid_export,
  };

  // 节点百分比
  const nodePercentages = {
    "Solar": totalInput > 0 ? (solar / totalInput * 100).toFixed(1) : "0.0",
    "Battery Out": totalInput > 0 ? (batteryOut / totalInput * 100).toFixed(1) : "0.0",
    "Grid In": totalInput > 0 ? (grid_import / totalInput * 100).toFixed(1) : "0.0",
    "Battery In": totalOutput > 0 ? (batteryIn / totalOutput * 100).toFixed(1) : "0.0",
    "Load": totalOutput > 0 ? (load / totalOutput * 100).toFixed(1) : "0.0",
    "Grid Out": totalOutput > 0 ? (grid_export / totalOutput * 100).toFixed(1) : "0.0",
  };

  // 计算流向
  let solarToLoad, solarToBatteryIn, solarToGridOut;
  let batteryOutToLoad, batteryOutToBatteryIn, batteryOutToGridOut;
  let gridInToLoad, gridInToBatteryIn;

  if (totalInput > 0.001 && totalOutput > 0.001) {
    const loadRatio = load / totalOutput;
    const batteryInRatio = batteryIn / totalOutput;
    const gridOutRatio = grid_export / totalOutput;

    solarToLoad = solar * loadRatio;
    solarToBatteryIn = solar * batteryInRatio;
    solarToGridOut = solar * gridOutRatio;

    batteryOutToLoad = batteryOut * loadRatio;
    batteryOutToBatteryIn = batteryOut * batteryInRatio;
    batteryOutToGridOut = batteryOut * gridOutRatio;

    gridInToLoad = grid_import * loadRatio;
    gridInToBatteryIn = grid_import * batteryInRatio;
  } else {
    solarToLoad = solarToBatteryIn = solarToGridOut = 0;
    batteryOutToLoad = batteryOutToBatteryIn = batteryOutToGridOut = 0;
    gridInToLoad = gridInToBatteryIn = 0;
  }

  // 监听容器宽度变化
  const initialWidthRef = useRef(null);
  
  useEffect(() => {
    const isMobile = window.innerWidth < 1024;
    
    if (isMobile) {
      // 手机上直接用屏幕宽度减去 padding
      const mobileWidth = window.innerWidth - 80;
      setContainerWidth(mobileWidth);
      initialWidthRef.current = mobileWidth;
    } else {
      // 电脑上：延迟获取容器宽度，等布局稳定
      const updateWidth = () => {
        if (containerRef.current) {
          const width = containerRef.current.getBoundingClientRect().width;
          if (width > 100) { // 确保宽度合理
            setContainerWidth(width);
            initialWidthRef.current = width;
          }
        }
      };
      
      // 立即尝试一次
      updateWidth();
      
      // 延迟再试几次，确保布局稳定
      const timer1 = setTimeout(updateWidth, 100);
      const timer2 = setTimeout(updateWidth, 300);
      const timer3 = setTimeout(updateWidth, 500);
      
      return () => {
        clearTimeout(timer1);
        clearTimeout(timer2);
        clearTimeout(timer3);
      };
    }
    
    // 监听窗口 resize
    const handleResize = () => {
      const isMobile = window.innerWidth < 1024;
      if (isMobile) {
        const mobileWidth = window.innerWidth - 80;
        setContainerWidth(mobileWidth);
      } else if (containerRef.current) {
        const width = containerRef.current.getBoundingClientRect().width;
        if (width > 100) {
          setContainerWidth(width);
        }
      }
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // D3 绘制
  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const margin = { top: 15, right: 20, bottom: 15, left: 20 };
    const width = containerWidth - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg
      .attr("width", containerWidth)
      .attr("height", height)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // 定义节点：左边3个输入，右边3个输出
    // 节点宽度根据容器宽度自适应：小屏幕用更窄的节点
    const nodeWidth = Math.min(90, Math.max(60, containerWidth * 0.12));
    const nodeMinHeight = Math.min(50, (innerHeight - 30) / 3 - 10);
    
    // 计算左侧节点高度（按值比例，但有最小高度）
    const leftNodes = ["Solar", "Battery Out", "Grid In"];
    const rightNodes = ["Battery In", "Load", "Grid Out"];
    
    const leftTotal = Math.max(totalInput, 0.001);
    const rightTotal = Math.max(totalOutput, 0.001);
    
    const availableHeight = innerHeight - 30; // 留一些间距

    // 计算节点位置和大小
    const nodeData = [];
    
    // 左侧节点
    let leftY = 0;
    leftNodes.forEach((name, i) => {
      const value = nodeValues[name];
      const ratio = leftTotal > 0 ? value / leftTotal : 0;
      //const h = Math.max(ratio * availableHeight * 0.8, nodeMinHeight);
      const nodeMaxHeight = (innerHeight - 30) / 3;  // 最大高度 = 可用高度/3
      const h = Math.min(Math.max(ratio * availableHeight * 0.8, nodeMinHeight), nodeMaxHeight);
      nodeData.push({
        name,
        x: 0,
        y: leftY,
        width: nodeWidth,
        height: h,
        value,
        side: "left",
        color: nodeColors[name],
        percentage: nodePercentages[name],
      });
      leftY += h + 8;
    });

    // 右侧节点
    let rightY = 0;
    rightNodes.forEach((name, i) => {
      const value = nodeValues[name];
      const ratio = rightTotal > 0 ? value / rightTotal : 0;
      //const h = Math.max(ratio * availableHeight * 0.8, nodeMinHeight);
      const nodeMaxHeight = (innerHeight - 30) / 3;  // 最大高度 = 可用高度/3
      const h = Math.min(Math.max(ratio * availableHeight * 0.8, nodeMinHeight), nodeMaxHeight);
      nodeData.push({
        name,
        x: width - nodeWidth,
        y: rightY,
        width: nodeWidth,
        height: h,
        value,
        side: "right",
        color: nodeColors[name],
        percentage: nodePercentages[name],
      });
      rightY += h + 8;
    });

    // 创建节点名到数据的映射
    const nodeMap = {};
    nodeData.forEach(n => { nodeMap[n.name] = n; });

    // 定义连接
    const linkData = [
      { source: "Solar", target: "Load", value: solarToLoad },
      { source: "Solar", target: "Battery In", value: solarToBatteryIn },
      { source: "Solar", target: "Grid Out", value: solarToGridOut },
      { source: "Battery Out", target: "Load", value: batteryOutToLoad },
      { source: "Battery Out", target: "Battery In", value: batteryOutToBatteryIn },
      { source: "Battery Out", target: "Grid Out", value: batteryOutToGridOut },
      { source: "Grid In", target: "Load", value: gridInToLoad },
      { source: "Grid In", target: "Battery In", value: gridInToBatteryIn },
    ].filter(l => l.value > 0.001);

    // 计算每个节点的流入/流出偏移
    const nodeSourceOffset = {};
    const nodeTargetOffset = {};
    nodeData.forEach(n => {
      nodeSourceOffset[n.name] = 0;
      nodeTargetOffset[n.name] = 0;
    });

    // 计算每个源节点的总流出值，用于计算连接线宽度比例
    const sourceFlowTotals = {};
    const targetFlowTotals = {};
    linkData.forEach(link => {
      sourceFlowTotals[link.source] = (sourceFlowTotals[link.source] || 0) + link.value;
      targetFlowTotals[link.target] = (targetFlowTotals[link.target] || 0) + link.value;
    });

    // 绘制渐变定义
    const defs = g.append("defs");
    
    linkData.forEach((link, i) => {
      const sourceNode = nodeMap[link.source];
      const gradientId = `gradient-${instanceId}-${i}`;
      
      const gradient = defs.append("linearGradient")
        .attr("id", gradientId)
        .attr("x1", "0%")
        .attr("x2", "100%");
      
      gradient.append("stop")
        .attr("offset", "0%")
        .attr("stop-color", sourceNode.color)
        .attr("stop-opacity", 0.8);
      
      gradient.append("stop")
        .attr("offset", "100%")
        .attr("stop-color", sourceNode.color)
        .attr("stop-opacity", 0.3);
    });

    // 计算并绘制连接
    linkData.forEach((link, i) => {
      const sourceNode = nodeMap[link.source];
      const targetNode = nodeMap[link.target];
      
      // 计算link的粗细：同时考虑源节点和目标节点的比例
      const sourceTotal = sourceFlowTotals[link.source] || link.value;
      const targetTotal = targetFlowTotals[link.target] || link.value;
      const sourceRatio = link.value / sourceTotal;
      const targetRatio = link.value / targetTotal;
      // 分别计算在源和目标节点的宽度
      const sourceWidth = Math.max(2, sourceRatio * (sourceNode.height - 10));
      const targetWidth = Math.max(2, targetRatio * (targetNode.height - 10));
      
      
      // 计算起点和终点
      const x0 = sourceNode.x + sourceNode.width;
      const y0 = sourceNode.y + nodeSourceOffset[link.source] + sourceWidth / 2 + 5;
      const x1 = targetNode.x;
      const y1 = targetNode.y + nodeTargetOffset[link.target] + targetWidth / 2 + 5;
      // 源端和目标端的上下边界
      const sy0 = y0 - sourceWidth / 2;
      const sy1 = y0 + sourceWidth / 2;
      const ty0 = y1 - targetWidth / 2;
      const ty1 = y1 + targetWidth / 2;
      
      // 更新偏移
      nodeSourceOffset[link.source] += sourceWidth;
      nodeTargetOffset[link.target] += targetWidth;

      // 绘制贝塞尔曲线
      const curvature = 0.5;
      const xi = d3.interpolateNumber(x0, x1);
      const x2 = xi(curvature);
      const x3 = xi(1 - curvature);
    
      
      // 绘制填充区域（四边形，用贝塞尔曲线连接）      
      g.append("path")
        .attr("d", `
          M${x0},${sy0}
          C${x2},${sy0} ${x3},${ty0} ${x1},${ty0}
          L${x1},${ty1}
          C${x3},${ty1} ${x2},${sy1} ${x0},${sy1}
          Z
        `)
        .attr("fill", `url(#gradient-${instanceId}-${i})`)
        .attr("opacity", 0.9);
    });

    // 绘制节点
    nodeData.forEach(node => {
      const nodeG = g.append("g").attr("transform", `translate(${node.x},${node.y})`);
      
      // 节点矩形
      nodeG.append("rect")
        .attr("width", node.width)
        .attr("height", node.height)
        .attr("rx", 6)
        .attr("fill", node.color)
        .attr("opacity", 0.9 );
      
      // 节点文字
      const textY = node.height / 2;
      
      nodeG.append("text")
        .attr("x", node.width / 2)
        .attr("y", textY - 12)
        .attr("text-anchor", "middle")
        .attr("fill", "#F3F4F6")
        .attr("font-size", "11px")
        .attr("font-weight", "bold")
        .text(node.name);
      
      nodeG.append("text")
        .attr("x", node.width / 2)
        .attr("y", textY + 4)
        .attr("text-anchor", "middle")
        .attr("fill", "#FFFFFF")
        .attr("font-size", "13px")
        .attr("font-weight", "bold")
        .text(node.value.toFixed(2));
      
      nodeG.append("text")
        .attr("x", node.width / 2)
        .attr("y", textY + 20)
        .attr("text-anchor", "middle")
        .attr("fill", "#E5E7EB")
        .attr("font-size", "10px")
        .text(`(${node.percentage}%)`);
    });

  }, [data, containerWidth, height, instanceId, unit, solar, batteryOut, grid_import, batteryIn, load, grid_export, totalInput, totalOutput, solarToLoad, solarToBatteryIn, solarToGridOut, batteryOutToLoad, batteryOutToBatteryIn, batteryOutToGridOut, gridInToLoad, gridInToBatteryIn, nodeColors, nodeValues, nodePercentages]);

  // 检查是否有能量流
  const hasFlow = totalInput > 0.001 || totalOutput > 0.001;

  if (!hasFlow) {
    return (
      <div className="flex items-center justify-center text-gray-500" style={{ height }}>
        🌙 No energy flow
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width: "100%", height, overflow: "hidden" }}>
      <svg ref={svgRef} style={{ maxWidth: "100%", display: "block" }}></svg>
    </div>
  );
};


// ============================================================
// 状态卡片组件
// ============================================================
const StatCard = ({ title, value, unit, icon, color, subtitle }) => {
  const colorClasses = {
    yellow: 'from-yellow-500 to-orange-500',
    cyan: 'from-cyan-500 to-blue-500',
    'cyan-in': 'from-cyan-600 to-cyan-400',
    'cyan-out': 'from-teal-500 to-cyan-500',
    purple: 'from-purple-500 to-pink-500',
    blue: 'from-blue-500 to-indigo-500',
    'blue-in': 'from-blue-600 to-blue-400',
    'blue-out': 'from-indigo-500 to-blue-500',
    green: 'from-green-500 to-emerald-500',
    'green-out': 'from-emerald-500 to-green-400',
  };

  return (
    <div className={`bg-gradient-to-br ${colorClasses[color] || colorClasses.blue} rounded-xl p-3 shadow-lg`}>
      <p className="text-white/80 text-xs font-medium">{icon} {title}</p>
      {subtitle && <p className="text-white/60 text-xs">{subtitle}</p>}
      <p className="text-white text-xl font-bold mt-1">
        {typeof value === 'number' ? value.toFixed(2) : value} <span className="text-sm">{unit}</span>
      </p>
    </div>
  );
};


// ============================================================
// 模块一：实时监控
// ============================================================
const RealtimeSection = ({ currentData, error }) => {
  // ========== DUMMY 数据 - 调试用，调完后删除 ==========
  const dummyData = {
    solar: 5.5,
    grid_import: 0.8,
    grid_export: 0.3,
    battery_charge: 1.2,
    battery_discharge: 0.5,
    load: 4.2,
    soc_inv: 77,
    timestamp: new Date().toISOString()
  };
  
  // 使用 dummy 数据（调试完后改回 currentData）
  //const data = dummyData;  // 改回 currentData 使用真实数据
  const data = currentData;
  
  // 强制所有流动线可见（调试用）
  // const solarToHome = true;
  // const solarToBattery = true;
  // const batteryToHome = true;
  // const gridToHome = true;
  // const solarToGrid = true;
  // const batteryToGrid = true;
  // ========== DUMMY 数据结束 ==========
  
  
  const solarToHome = currentData.solar > 0.01 && currentData.load > 0.01;
  const solarToBattery = currentData.solar > 0.01 && currentData.battery_charge > 0.01;
  const batteryToHome = currentData.battery_discharge > 0.01 && currentData.load > 0.01;
  const gridToHome = currentData.grid_import > 0.01 && currentData.load > 0.01;
  const solarToGrid = currentData.solar > 0.01 && currentData.grid_export > 0.01;
  const batteryToGrid = currentData.battery_discharge > 0.01 && currentData.grid_export > 0.01;
  
  // 计算各条线的功率值（用于动画速度）
  const solarToHomePower = Math.min(currentData.solar, currentData.load);
  const solarToBatteryPower = currentData.battery_charge;
  const solarToGridPower = currentData.grid_export;
  const gridToHomePower = currentData.grid_import;
  const batteryToHomePower = currentData.battery_discharge;
  const batteryToGridPower = Math.min(currentData.battery_discharge, currentData.grid_export);
  
  
  return (
    <SectionContainer>
      {/* 标题行：左边标题，右边电池状态 */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span className="text-xl">⚡</span>
            <span>实时监控</span>
          </h2>
          <p className="text-gray-400 text-xs">
            {data.timestamp ? `最后更新: ${new Date(data.timestamp).toLocaleTimeString('zh-CN')}` : '等待数据...'}
          </p>
        </div>
        
        {/* 电池状态 */}
        <div className="flex items-center gap-3">
          <BatteryCard title="" value={data.soc_inv} />
        </div>
      </div>
      
      {error && (
        <div className="mb-3 px-3 py-1.5 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
          ⚠️ {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* 左侧：3D 房屋模型 - 占1列 */}
        <div className="lg:col-span-1 bg-gray-800/50 rounded-xl overflow-hidden h-[260px] lg:h-[320px]">
          <SolarHouse3D
            solar={data.solar}
            gridImport={data.grid_import}
            gridExport={data.grid_export}
            batteryCharge={data.battery_charge}
            batteryDischarge={data.battery_discharge}
            load={data.load}
            batteryPercent={data.soc_inv || data.soc_bms || 0}
            solarToHome={solarToHome}
            solarToBattery={solarToBattery}
            batteryToHome={batteryToHome}
            gridToHome={gridToHome}
            solarToGrid={solarToGrid}
            batteryToGrid={batteryToGrid}
            solarToHomePower={solarToHomePower}
            solarToBatteryPower={solarToBatteryPower}
            solarToGridPower={solarToGridPower}
            gridToHomePower={gridToHomePower}
            batteryToHomePower={batteryToHomePower}
            batteryToGridPower={batteryToGridPower}
          />
        </div>

        {/* 右侧：Sankey图 - 占2列 */}
        <div className="lg:col-span-2 bg-gray-800/50 rounded-xl p-3 overflow-hidden">
          <h3 className="text-gray-400 text-xs font-medium mb-1">能量流向 <span className="text-gray-500">(kW)</span></h3>
          <SankeyFlow data={data} height={280} instanceId="realtime" />
        </div>
      </div>
    </SectionContainer>
  );
};

// 紧凑版状态卡片
// const MiniStatCard = ({ title, value, icon, color, unit = "kW" }) => {
//   const colorClasses = {
//     // yellow: 'bg-yellow-500/20 text-yellow-400',
//     // purple: 'bg-purple-500/20 text-purple-400',
//     // cyan: 'bg-cyan-500/20 text-cyan-400',
//     // blue: 'bg-blue-500/20 text-blue-400',
//     // green: 'bg-green-500/20 text-green-400',
//     yellow: 'bg-[#FCD34D]/20 text-[#FCD34D]',
//     purple: 'bg-[#A78BFA]/20 text-[#A78BFA]',
//     cyan: 'bg-[#22D3EE]/20 text-[#22D3EE]',
//     blue: 'bg-[#60A5FA]/20 text-[#60A5FA]',
//     green: 'bg-[#34D399]/20 text-[#34D399]',
//   };

//   return (
//     <div className={`${colorClasses[color] || colorClasses.blue} rounded-lg px-2 py-1.5`}>
//       <p className="text-xs opacity-80 leading-tight">{icon} {title}</p>
//       <p className="text-white text-base font-bold leading-tight">
//         {typeof value === 'number' ? value.toFixed(2) : value}
//         <span className="text-xs ml-1 opacity-70">{unit}</span>
//       </p>
//     </div>
//   );
//};
const MiniStatCard = ({ title, value, icon, color, unit = "kW" }) => {
  const colors = {
    yellow: '#FCD34D',
    purple: '#A78BFA',
    cyan: '#22D3EE',
    blue: '#60A5FA',
    green: '#34D399',
    emerald: '#F59E0B',
  };
  
  const c = colors[color] || colors.blue;

  return (
    <div 
      className="rounded-lg px-2 py-1.5"
      style={{ backgroundColor: `${c}B9`, color: c }}
    >
      <p className="text-xs opacity-80 leading-tight">{icon} {title}</p>
      <p className="text-white text-base font-bold leading-tight">
        {typeof value === 'number' ? value.toFixed(2) : value}
        <span className="text-xs ml-1 opacity-70">{unit}</span>
      </p>
    </div>
  );
};

// 电池状态卡片（带SVG电池图标）
const BatteryCard = ({ title, value }) => {
  const percentage = typeof value === 'number' ? value : 0;
  
  // 根据电量选择颜色
  const getColor = (pct) => {
    if (pct >= 30) return '#34D399';  // 绿色
    if (pct >= 10) return '#F59E0B';  // 橙色
    return '#EF4444';  // 红色
  };
  
  const color = getColor(percentage);
  const fillWidth = Math.max(0, Math.min(100, percentage));

  return (
    <div className="bg-gray-800/50 rounded-lg px-3 py-2 flex items-center gap-3">
      {/* SVG 电池图标 */}
      <svg width="48" height="24" viewBox="0 0 48 24">
        {/* 电池外框 */}
        <rect x="1" y="3" width="40" height="18" rx="3" ry="3" 
          fill="none" stroke="#6B7280" strokeWidth="2"/>
        {/* 电池头 */}
        <rect x="41" y="8" width="5" height="8" rx="1" ry="1" 
          fill="#6B7280"/>
        {/* 电量填充 */}
        <rect x="3" y="5" width={fillWidth * 0.36} height="14" rx="2" ry="2" 
          fill={color}/>
      </svg>
      
      {/* 文字信息 - 无title时只显示百分比 */}
      <p className="text-white text-lg font-bold">
        {percentage.toFixed(0)}
        <span className="text-sm ml-0.5">%</span>
      </p>
    </div>
  );
};

// ============================================================
// 模块二：历史统计
// ============================================================
const StatisticsSection = ({ dailyData, isLoading, startDate, endDate, onStartDateChange, onEndDateChange, onApply }) => {
  const [viewMode, setViewMode] = useState('chart');
  
  // 当数据变化时，多天默认显示柱状图，单天默认显示sankey
  useEffect(() => {
    if (dailyData.length === 1) {
      setViewMode('sankey');
    } else if (dailyData.length > 1) {
      setViewMode('chart');
    }
  }, [dailyData.length]);

  // 计算汇总
  const totals = dailyData.reduce((acc, d) => ({
    solar: acc.solar + (d.solar_kwh || 0),
    load: acc.load + (d.load_kwh || 0),
    battery_charge: acc.battery_charge + (d.battery_charge_kwh || 0),
    battery_discharge: acc.battery_discharge + (d.battery_discharge_kwh || 0),
    grid_import: acc.grid_import + (d.grid_import_kwh || 0),
    grid_export: acc.grid_export + (d.grid_export_kwh || 0),
  }), { solar: 0, load: 0, battery_charge: 0, battery_discharge: 0, grid_import: 0, grid_export: 0 });

  const chartData = dailyData.map(d => ({
    date: d.date?.slice(5) || '',
    solar: d.solar_kwh || 0,
    load: d.load_kwh || 0,
    gridExport: d.grid_export_kwh || 0,
    gridImport: d.grid_import_kwh || 0,
    batteryCharge: d.battery_charge_kwh || 0,
    batteryDischarge: d.battery_discharge_kwh || 0,
  }));

  const dateRangeText = startDate === endDate ? startDate : `${startDate} ~ ${endDate}`;

  return (
    <SectionContainer>
      {/* 标题和日期选择器在同一行 */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">📊</span>
          <div>
            <h2 className="text-lg font-bold text-white">历史统计</h2>
            <p className="text-gray-400 text-xs">{dateRangeText}</p>
          </div>
        </div>
        
        {/* 紧凑版日期选择器 */}
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="date"
            value={startDate}
            onChange={(e) => onStartDateChange(e.target.value)}
            className="bg-gray-700 text-white text-xs px-2 py-1 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
          />
          <span className="text-gray-400 text-xs">~</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => onEndDateChange(e.target.value)}
            className="bg-gray-700 text-white text-xs px-2 py-1 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
          />
          <button
            onClick={onApply}
            className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-xs font-medium transition-colors"
          >
            查询
          </button>
          <button
            onClick={() => {
              const today = getToday();
              onStartDateChange(today);
              onEndDateChange(today);
              setTimeout(onApply, 0);
            }}
            className="bg-gray-600 hover:bg-gray-500 text-white px-2 py-1 rounded text-xs transition-colors"
          >
            今天
          </button>
          <button
            onClick={() => {
              const today = new Date();
              const weekAgo = new Date(today);
              weekAgo.setDate(weekAgo.getDate() - 7);
              onStartDateChange(formatDate(weekAgo));
              onEndDateChange(formatDate(today));
              setTimeout(onApply, 0);
            }}
            className="bg-gray-600 hover:bg-gray-500 text-white px-2 py-1 rounded text-xs transition-colors"
          >
            7天
          </button>
          <button
            onClick={() => {
              const today = new Date();
              const monthAgo = new Date(today);
              monthAgo.setDate(monthAgo.getDate() - 30);
              onStartDateChange(formatDate(monthAgo));
              onEndDateChange(formatDate(today));
              setTimeout(onApply, 0);
            }}
            className="bg-gray-600 hover:bg-gray-500 text-white px-2 py-1 rounded text-xs transition-colors"
          >
            30天
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-gray-400 text-center py-8">加载中...</div>
      ) : !dailyData || dailyData.length === 0 ? (
        <div className="text-gray-400 text-center py-8">暂无数据</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* 左侧：数据卡片 - 占1列 */}
          <div className="lg:col-span-1 space-y-2">
            <h3 className="text-gray-400 text-xs font-medium">
              {dailyData.length === 1 ? '当日统计 (kWh)' : `${dailyData.length}天汇总 (kWh)`}
            </h3>
            <div className="grid grid-cols-2 gap-1.5">
              <MiniStatCard title="Solar" value={totals.solar} icon="☀️" color="yellow" unit="kWh" />
              <MiniStatCard title="Load" value={totals.load} icon="🏠" color="purple" unit="kWh" />
              <MiniStatCard title="Charge" value={totals.battery_charge} icon="🔋↓" color="cyan" unit="kWh" />
              <MiniStatCard title="Discharge" value={totals.battery_discharge} icon="🔋↑" color="cyan" unit="kWh" />
              <MiniStatCard title="Grid In" value={totals.grid_import} icon="⬇️" color="blue" unit="kWh" />
              <MiniStatCard title="Grid Out" value={totals.grid_export} icon="⬆️" color="green" unit="kWh" />
            </div>
            
            {/* 多天时显示视图切换 */}
            {dailyData.length > 1 && (
              <div className="pt-1">
                <h3 className="text-gray-400 text-xs font-medium mb-1">视图切换</h3>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setViewMode('chart')}
                    className={`flex-1 px-2 py-1 rounded text-xs transition-colors ${
                      viewMode === 'chart' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    📊 柱状图
                  </button>
                  <button
                    onClick={() => setViewMode('sankey')}
                    className={`flex-1 px-2 py-1 rounded text-xs transition-colors ${
                      viewMode === 'sankey' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    ⚡ 流向图
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 右侧：图表 - 占2列 */}
          <div className="lg:col-span-2 bg-gray-800/50 rounded-xl p-3">
            <h3 className="text-gray-400 text-xs font-medium mb-1">
              {viewMode === 'sankey' ? '能量流向' : '每日统计'} <span className="text-gray-500">(kWh)</span>
            </h3>
            
            {/* 柱状图（多天且选择chart时显示） */}
            {dailyData.length > 1 && viewMode === 'chart' && (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="date" stroke="#9CA3AF" />
                  <YAxis stroke="#9CA3AF" />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '8px' }}
                    labelStyle={{ color: '#F3F4F6' }}
                  />
                  <Legend />
                  <Bar dataKey="solar" fill="#FCD34D" name="Solar" />
                  <Bar dataKey="load" fill="#A78BFA" name="Load" />
                  <Bar dataKey="gridExport" fill="#34D399" name="Grid Export" />
                  <Bar dataKey="gridImport" fill="#60A5FA" name="Grid Import" />
                </BarChart>
              </ResponsiveContainer>
            )}

            {/* Sankey图 */}
            {(dailyData.length === 1 || viewMode === 'sankey') && (
              <SankeyFlow 
                data={{
                  solar: totals.solar,
                  load: totals.load,
                  battery_charge: totals.battery_charge,
                  battery_discharge: totals.battery_discharge,
                  grid_import: totals.grid_import,
                  grid_export: totals.grid_export,
                  battery_net: totals.battery_charge - totals.battery_discharge,
                }}
                unit="kWh"
                height={280}
                instanceId="history"
              />
            )}
          </div>
        </div>
      )}
    </SectionContainer>
  );
};


// ============================================================
// 模块三：曲线图
// ============================================================
const ChartSection = ({ historicalData, startDate, endDate }) => {
  const dateRangeText = startDate === endDate ? startDate : `${startDate} ~ ${endDate}`;

  return (
    <SectionContainer>
      <SectionTitle 
        icon="📈" 
        title="功率曲线" 
        subtitle={`时间范围: ${dateRangeText} | 数据点: ${historicalData.length}`}
      />

      {historicalData.length === 0 ? (
        <div className="text-gray-400 text-center py-12">暂无数据</div>
      ) : (
        <div className="bg-gray-800/50 rounded-xl p-4">
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={historicalData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="time" stroke="#9CA3AF" fontSize={11} />
              <YAxis stroke="#9CA3AF" />
              <Tooltip
                contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '8px' }}
                labelStyle={{ color: '#F3F4F6' }}
              />
              <Legend />
              <Line type="monotone" dataKey="solar" stroke="#FCD34D" strokeWidth={2} dot={false} name="Solar (kW)" />
              <Line type="monotone" dataKey="load" stroke="#A78BFA" strokeWidth={2} dot={false} name="Load (kW)" />
              <Line type="monotone" dataKey="battery" stroke="#22D3EE" strokeWidth={2} dot={false} name="Battery (kW)" />
              <Line type="monotone" dataKey="grid" stroke="#60A5FA" strokeWidth={2} dot={false} name="Grid (kW)" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </SectionContainer>
  );
};


// ============================================================
// 模块四：电池电量曲线
// ============================================================
const BatterySOCSection = ({ socData, startDate, endDate, onStartDateChange, onEndDateChange, onApply, isLoading }) => {
  const scrollContainerRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  
  const dateRangeText = startDate === endDate ? startDate : `${startDate} ~ ${endDate}`;
  
  // 计算图表宽度：每个数据点 80px，最小容器宽度
  const hoursCount = socData.length;
  const chartWidth = hoursCount * 80;
  const needsScroll = hoursCount > 15;
  
  // 数据加载完成后，滚动到最右端（最新数据）
  useEffect(() => {
    if (needsScroll && scrollContainerRef.current) {
      // 延迟一点确保图表已渲染
      setTimeout(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollLeft = scrollContainerRef.current.scrollWidth;
        }
      }, 100);
    }
  }, [socData, needsScroll]);
  
  // 鼠标/触摸拖动处理
  const handleMouseDown = (e) => {
    if (!needsScroll) return;
    setIsDragging(true);
    setStartX(e.pageX || e.touches?.[0]?.pageX);
    setScrollLeft(scrollContainerRef.current?.scrollLeft || 0);
  };
  
  const handleMouseMove = (e) => {
    if (!isDragging || !scrollContainerRef.current) return;
    e.preventDefault();
    const x = e.pageX || e.touches?.[0]?.pageX;
    const walk = (startX - x) * 1.5;
    scrollContainerRef.current.scrollLeft = scrollLeft + walk;
  };
  
  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // 格式化时间显示（只显示小时）
  const formatHour = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <SectionContainer>
      {/* 标题和日期选择器 */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">🔋</span>
          <div>
            <h2 className="text-lg font-bold text-white">电池电量曲线</h2>
            <p className="text-gray-400 text-xs">{dateRangeText} | 数据点: {socData.length}</p>
          </div>
        </div>
        
        {/* 日期选择器 */}
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="date"
            value={startDate}
            onChange={(e) => onStartDateChange(e.target.value)}
            className="bg-gray-700 text-white text-xs px-2 py-1 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
          />
          <span className="text-gray-400 text-xs">~</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => onEndDateChange(e.target.value)}
            className="bg-gray-700 text-white text-xs px-2 py-1 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
          />
          <button
            onClick={() => onApply()}
            className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-xs font-medium transition-colors"
          >
            查询
          </button>
          <button
            onClick={() => {
              const today = getToday();
              onStartDateChange(today);
              onEndDateChange(today);
              onApply(today, today);
            }}
            className="bg-gray-600 hover:bg-gray-500 text-white px-2 py-1 rounded text-xs transition-colors"
          >
            今天
          </button>
          <button
            onClick={() => {
              const today = formatDate(new Date());
              const weekAgo = formatDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
              onStartDateChange(weekAgo);
              onEndDateChange(today);
              onApply(weekAgo, today);
            }}
            className="bg-gray-600 hover:bg-gray-500 text-white px-2 py-1 rounded text-xs transition-colors"
          >
            7天
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-gray-400 text-center py-8">加载中...</div>
      ) : socData.length === 0 ? (
        <div className="text-gray-400 text-center py-8">暂无数据</div>
      ) : (
        <div className="bg-gray-800/50 rounded-xl p-4">
          {/* 滚动提示 */}
          {needsScroll && (
            <div className="text-gray-400 text-xs mb-2 flex items-center gap-1">
              <span>👆</span>
              <span>左右拖动查看更多数据</span>
            </div>
          )}
          
          {/* 可滚动的图表容器 */}
          <div 
            ref={scrollContainerRef}
            className={`overflow-x-auto ${needsScroll ? 'cursor-grab active:cursor-grabbing' : ''}`}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleMouseDown}
            onTouchMove={handleMouseMove}
            onTouchEnd={handleMouseUp}
            style={{ 
              scrollbarWidth: 'thin',
              scrollbarColor: '#4B5563 #1F2937'
            }}
          >
            {needsScroll ? (
              // 滚动模式：固定宽度
              <LineChart 
                data={socData} 
                width={chartWidth} 
                height={350}
                margin={{ top: 10, right: 30, left: 40, bottom: 80 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis 
                  dataKey="time" 
                  stroke="#9CA3AF" 
                  fontSize={10}
                  interval={0}
                  angle={-45}
                  textAnchor="end"
                />
                <YAxis 
                  stroke="#9CA3AF" 
                  domain={[0, 100]}
                  tickFormatter={(value) => `${value}%`}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '8px' }}
                  labelStyle={{ color: '#F3F4F6' }}
                  formatter={(value) => [`${value}%`, 'SOC']}
                />
                <Legend wrapperStyle={{ paddingTop: '20px' }} />
                <Line 
                  type="monotone" 
                  dataKey="soc" 
                  stroke="#34D399" 
                  strokeWidth={2} 
                  dot={false} 
                  name="电池电量 (%)"
                  connectNulls
                />
              </LineChart>
            ) : (
              // 非滚动模式：响应式宽度
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={socData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis 
                    dataKey="time" 
                    stroke="#9CA3AF" 
                    fontSize={10}
                    interval="preserveStartEnd"
                  />
                  <YAxis 
                    stroke="#9CA3AF" 
                    domain={[0, 100]}
                    tickFormatter={(value) => `${value}%`}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '8px' }}
                    labelStyle={{ color: '#F3F4F6' }}
                    formatter={(value) => [`${value}%`, 'SOC']}
                  />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="soc" 
                    stroke="#34D399" 
                    strokeWidth={2} 
                    dot={false} 
                    name="电池电量 (%)"
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}
    </SectionContainer>
  );
};


// ============================================================
// 主 Dashboard 组件
// ============================================================
function App() {
  const [currentData, setCurrentData] = useState({
    solar: 0, battery_discharge: 0, grid_import: 0, battery_charge: 0,
    load: 0, grid_export: 0, battery_net: 0, soc_inv: 0, soc_bms: 0,
    timestamp: null, connected: false
  });

  const [historicalData, setHistoricalData] = useState([]);
  const [dailyData, setDailyData] = useState([]);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [socData, setSocData] = useState([]);
  const [socLoading, setSocLoading] = useState(false);
  //const [error, setError] = useState(null);
  const [realtimeError, setRealtimeError] = useState(null); 
  
  const [startDate, setStartDate] = useState(getToday());
  const [endDate, setEndDate] = useState(getToday());
  
  // SOC 图表单独的日期状态
  const [socStartDate, setSocStartDate] = useState(getToday());
  const [socEndDate, setSocEndDate] = useState(getToday());

  // 实时数据轮询
  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/current`);
        if (!response.ok) throw new Error('API 请求失败');
        const data = await response.json();
        setCurrentData(data);
        setRealtimeError(null);
        
        setHistoricalData(prev => {
          const newData = [...prev, {
            time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
            solar: data.solar,
            load: data.load,
            battery: data.battery_net,
            grid: data.grid_export - data.grid_import
          }];
          return newData.slice(-60);
        });
      } catch (err) {
        //setError(`连接失败: ${err.message}`);
        setRealtimeError(`连接失败: ${err.message}`);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  // 获取每日统计数据
  const fetchDailyRange = useCallback(async (start, end) => {
    const queryStart = start || startDate;
    const queryEnd = end || endDate;
    setDailyLoading(true);
    try {
      if (queryStart === queryEnd) {
        const response = await fetch(`${API_BASE}/api/daily?date=${queryStart}`);
        if (!response.ok) throw new Error('获取每日数据失败');
        const data = await response.json();
        setDailyData([data]);
      } else {
        const response = await fetch(`${API_BASE}/api/daily/range?start_date=${queryStart}&end_date=${queryEnd}`);
        if (!response.ok) throw new Error('获取日期范围数据失败');
        const result = await response.json();
        setDailyData(result.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch daily data:', err);
      setDailyData([]);
    } finally {
      setDailyLoading(false);
    }
  }, [startDate, endDate]);

  // 获取历史曲线数据
  const fetchHistoryRange = useCallback(async (start, end) => {
    const queryStart = start || startDate;
    const queryEnd = end || endDate;
    try {
      const response = await fetch(`${API_BASE}/api/history/range?start_date=${queryStart}&end_date=${queryEnd}&limit=300`);
      if (!response.ok) return;
      const result = await response.json();
      
      if (result.data && result.data.length > 0) {
        const chartData = result.data.map(d => ({
          time: new Date(d.timestamp).toLocaleString('zh-CN', { 
            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' 
          }),
          solar: d.solar,
          load: d.load,
          battery: d.battery_net,
          grid: d.grid_export - d.grid_import
        }));
        setHistoricalData(chartData);
      }
    } catch (err) {
      console.error('Failed to fetch history range:', err);
    }
  }, [startDate, endDate]);

  // 获取 SOC 历史数据
  const fetchSOCData = useCallback(async (start, end) => {
    const queryStart = start || socStartDate;
    const queryEnd = end || socEndDate;
    setSocLoading(true);
    try {
      // 获取更多数据点用于 SOC 曲线
      const response = await fetch(`${API_BASE}/api/history/range?start_date=${queryStart}&end_date=${queryEnd}&limit=5000`);
      if (!response.ok) throw new Error('获取SOC数据失败');
      const result = await response.json();
      
      if (result.data && result.data.length > 0) {
        // 按小时采样：取每个小时前30秒内的第一个数据点
        const hourlyData = [];
        const seenHours = new Set();
        
        for (const d of result.data) {
          const date = new Date(d.timestamp);
          const minute = date.getMinutes();
          const second = date.getSeconds();
          
          // 只取每小时0-30秒内的数据
          if (minute === 0 && second <= 30) {
            // 生成小时标识：YYYY-MM-DD-HH
            const hourKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`;
            
            if (!seenHours.has(hourKey)) {
              seenHours.add(hourKey);
              hourlyData.push({
                time: `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}时`,
                timestamp: d.timestamp,
                soc: d.soc_bms || d.soc_inv || 0
              });
            }
          }
        }
        
        setSocData(hourlyData);
      } else {
        setSocData([]);
      }
    } catch (err) {
      console.error('Failed to fetch SOC data:', err);
      setSocData([]);
    } finally {
      setSocLoading(false);
    }
  }, [socStartDate, socEndDate]);

  // SOC 查询按钮处理
  const handleSOCApply = (start, end) => {
    fetchSOCData(start, end);
  };

  // 初始加载 - 每次都用最新的今天日期
  useEffect(() => {
    const today = getToday();
    setStartDate(today);
    setEndDate(today);
    setSocStartDate(today);
    setSocEndDate(today);
    fetchDailyRange(today, today);
    fetchSOCData(today, today);
  }, []); // 只在组件挂载时执行一次

  // 查询按钮处理
  const handleApply = (start, end) => {
    fetchDailyRange(start, end);
    fetchHistoryRange(start, end);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-3 md:p-6">
      {/* 头部 */}
      <div className="max-w-7xl mx-auto mb-4 md:mb-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <h1 className="text-xl md:text-3xl font-bold bg-gradient-to-r from-yellow-400 to-orange-500 bg-clip-text text-transparent">
            ☀️ Growatt Solar Dashboard
          </h1>
          <div className="flex items-center gap-4">
            <span className={`px-3 py-1 rounded-full text-sm ${
              currentData.connected && !realtimeError 
                ? 'bg-green-500/20 text-green-400' 
                : 'bg-red-500/20 text-red-400'
            }`}>
              {currentData.connected && !realtimeError ? '● 已连接' : '○ 未连接'}
            </span>
          </div>
        </div>
      </div>

      {/* 三个模块 */}
      <div className="max-w-7xl mx-auto space-y-4 md:space-y-6">
        {/* 模块一：实时监控 */}
        <RealtimeSection currentData={currentData} error={realtimeError} />

        {/* 模块二：历史统计 */}
        <StatisticsSection 
          dailyData={dailyData}
          isLoading={dailyLoading}
          startDate={startDate}
          endDate={endDate}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
          onApply={handleApply}
        />

        {/* 模块三：曲线图 */}
        <ChartSection 
          historicalData={historicalData}
          startDate={startDate}
          endDate={endDate}
        />

        {/* 模块四：电池电量曲线 */}
        <BatterySOCSection 
          socData={socData}
          isLoading={socLoading}
          startDate={socStartDate}
          endDate={socEndDate}
          onStartDateChange={setSocStartDate}
          onEndDateChange={setSocEndDate}
          onApply={handleSOCApply}
        />
      </div>

      {/* 底部 */}
      <div className="max-w-7xl mx-auto mt-8 text-center text-gray-500 text-sm">
        Growatt Solar Monitor | API: {API_BASE}
      </div>
    </div>
  );
}

export default App;
