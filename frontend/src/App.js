import React, { useState, useEffect, useCallback, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from 'recharts';
import * as d3 from 'd3';

// ============================================================
// 配置 - 修改这里的 API 地址
// ============================================================
const API_BASE = 'http://localhost:5002';

// ============================================================
// 工具函数
// ============================================================
const formatDate = (date) => {
  return date.toISOString().split('T')[0];
};

const getToday = () => formatDate(new Date());

// ============================================================
// 模块标题组件
// ============================================================
const SectionTitle = ({ icon, title, subtitle }) => (
  <div className="mb-4">
    <h2 className="text-2xl font-bold text-white flex items-center gap-2">
      <span>{icon}</span>
      <span>{title}</span>
    </h2>
    {subtitle && <p className="text-gray-400 text-sm mt-1">{subtitle}</p>}
  </div>
);

// ============================================================
// 模块容器组件
// ============================================================
const SectionContainer = ({ children, className = "" }) => (
  <div className={`bg-gray-900/50 rounded-2xl p-6 border border-gray-800 ${className}`}>
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
        onClick={onApply}
        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded font-medium transition-colors"
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
        className="bg-gray-600 hover:bg-gray-500 text-white px-3 py-1.5 rounded text-sm transition-colors"
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
        className="bg-gray-600 hover:bg-gray-500 text-white px-3 py-1.5 rounded text-sm transition-colors"
      >
        最近7天
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

  const batteryOut = battery_discharge > 0.001 ? battery_discharge : Math.max(0, -battery_net);
  const batteryIn = battery_charge > 0.001 ? battery_charge : Math.max(0, battery_net);

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
  useEffect(() => {
    if (containerRef.current) {
      const resizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
          setContainerWidth(entry.contentRect.width || 700);
        }
      });
      resizeObserver.observe(containerRef.current);
      return () => resizeObserver.disconnect();
    }
  }, []);

  // D3 绘制
  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const margin = { top: 20, right: 120, bottom: 20, left: 120 };
    const width = containerWidth - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg
      .attr("width", containerWidth)
      .attr("height", height)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // 定义节点：左边3个输入，右边3个输出
    const nodeWidth = 100;
    const nodeMinHeight = 60;
    
    // 计算左侧节点高度（按值比例，但有最小高度）
    const leftNodes = ["Solar", "Battery Out", "Grid In"];
    const rightNodes = ["Battery In", "Load", "Grid Out"];
    
    const leftTotal = Math.max(totalInput, 0.001);
    const rightTotal = Math.max(totalOutput, 0.001);
    
    const availableHeight = innerHeight - 40; // 留一些间距

    // 计算节点位置和大小
    const nodeData = [];
    
    // 左侧节点
    let leftY = 0;
    leftNodes.forEach((name, i) => {
      const value = nodeValues[name];
      const ratio = leftTotal > 0 ? value / leftTotal : 0;
      const h = Math.max(ratio * availableHeight * 0.8, nodeMinHeight);
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
      leftY += h + 15;
    });

    // 右侧节点
    let rightY = 0;
    rightNodes.forEach((name, i) => {
      const value = nodeValues[name];
      const ratio = rightTotal > 0 ? value / rightTotal : 0;
      const h = Math.max(ratio * availableHeight * 0.8, nodeMinHeight);
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
      rightY += h + 15;
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
      
      // 计算link的粗细：按照源节点高度的比例分配
      const sourceTotal = sourceFlowTotals[link.source] || link.value;
      const linkRatio = link.value / sourceTotal;
      // 连接线宽度 = 节点可用高度 * 该连接占源节点流出的比例
      const usableHeight = sourceNode.height - 10; // 留一点边距
      const linkWidth = Math.max(2, linkRatio * usableHeight);
      
      // 计算起点和终点
      const x0 = sourceNode.x + sourceNode.width;
      const y0 = sourceNode.y + nodeSourceOffset[link.source] + linkWidth / 2 + 5;
      const x1 = targetNode.x;
      const y1 = targetNode.y + nodeTargetOffset[link.target] + linkWidth / 2 + 5;
      
      // 更新偏移
      nodeSourceOffset[link.source] += linkWidth;
      nodeTargetOffset[link.target] += linkWidth;

      // 绘制贝塞尔曲线
      const curvature = 0.5;
      const xi = d3.interpolateNumber(x0, x1);
      const x2 = xi(curvature);
      const x3 = xi(1 - curvature);

      g.append("path")
        .attr("d", `M${x0},${y0} C${x2},${y0} ${x3},${y1} ${x1},${y1}`)
        .attr("fill", "none")
        .attr("stroke", `url(#gradient-${instanceId}-${i})`)
        .attr("stroke-width", linkWidth)
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
        .attr("opacity", node.value > 0.001 ? 0.9 : 0.3);
      
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
        .text(`${node.value.toFixed(2)} ${unit}`);
      
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
    <div ref={containerRef} style={{ width: "100%", height }}>
      <svg ref={svgRef}></svg>
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
  return (
    <SectionContainer>
      <SectionTitle 
        icon="⚡" 
        title="实时监控" 
        subtitle={currentData.timestamp ? `最后更新: ${new Date(currentData.timestamp).toLocaleTimeString('zh-CN')}` : '等待数据...'}
      />
      
      {error && (
        <div className="mb-4 px-4 py-2 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
          ⚠️ {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 左侧：数据卡片 - 占1列 */}
        <div className="lg:col-span-1 space-y-3">
          <h3 className="text-gray-400 text-xs font-medium">功率数据 (kW)</h3>
          <div className="grid grid-cols-2 gap-2">
            <MiniStatCard title="Solar" value={currentData.solar} icon="☀️" color="yellow" />
            <MiniStatCard title="Load" value={currentData.load} icon="🏠" color="purple" />
            <MiniStatCard title="Batt In" value={currentData.battery_charge} icon="🔋↓" color="cyan" />
            <MiniStatCard title="Batt Out" value={currentData.battery_discharge} icon="🔋↑" color="cyan" />
            <MiniStatCard title="Grid In" value={currentData.grid_import} icon="⬇️" color="blue" />
            <MiniStatCard title="Grid Out" value={currentData.grid_export} icon="⬆️" color="green" />
          </div>
          
          <h3 className="text-gray-400 text-xs font-medium">电池状态</h3>
          <div className="grid grid-cols-2 gap-2">
            <MiniStatCard title="SOC INV" value={currentData.soc_inv} icon="📊" color="green" unit="%" />
            <MiniStatCard title="SOC BMS" value={currentData.soc_bms} icon="📈" color="green" unit="%" />
          </div>
        </div>

        {/* 右侧：Sankey图 - 占2列 */}
        <div className="lg:col-span-2 bg-gray-800/50 rounded-xl p-4">
          <h3 className="text-gray-400 text-sm font-medium mb-2">能量流向</h3>
          <SankeyFlow data={currentData} height={320} instanceId="realtime" />
        </div>
      </div>
    </SectionContainer>
  );
};

// 紧凑版状态卡片
const MiniStatCard = ({ title, value, icon, color, unit = "kW" }) => {
  const colorClasses = {
    yellow: 'bg-yellow-500/20 text-yellow-400',
    purple: 'bg-purple-500/20 text-purple-400',
    cyan: 'bg-cyan-500/20 text-cyan-400',
    blue: 'bg-blue-500/20 text-blue-400',
    green: 'bg-green-500/20 text-green-400',
  };

  return (
    <div className={`${colorClasses[color] || colorClasses.blue} rounded-lg p-2`}>
      <p className="text-xs opacity-80">{icon} {title}</p>
      <p className="text-white text-lg font-bold">
        {typeof value === 'number' ? value.toFixed(2) : value}
        <span className="text-xs ml-1 opacity-70">{unit}</span>
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
      <SectionTitle 
        icon="📊" 
        title="历史统计" 
        subtitle={`查询范围: ${dateRangeText}`}
      />

      {/* 日期选择器 */}
      <div className="mb-6">
        <DateRangePicker
          startDate={startDate}
          endDate={endDate}
          onStartDateChange={onStartDateChange}
          onEndDateChange={onEndDateChange}
          onApply={onApply}
        />
      </div>

      {isLoading ? (
        <div className="text-gray-400 text-center py-12">加载中...</div>
      ) : !dailyData || dailyData.length === 0 ? (
        <div className="text-gray-400 text-center py-12">暂无数据</div>
      ) : (
        <>
          {/* 汇总数据卡片 */}
          <div className="mb-6">
            <h3 className="text-gray-400 text-sm font-medium mb-3">
              {dailyData.length === 1 ? '当日统计 (kWh)' : `${dailyData.length}天汇总 (kWh)`}
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="bg-yellow-500/20 rounded-lg p-3">
                <div className="text-yellow-400 text-xs">☀️ Solar</div>
                <div className="text-white text-xl font-bold">{totals.solar.toFixed(2)}</div>
              </div>
              <div className="bg-purple-500/20 rounded-lg p-3">
                <div className="text-purple-400 text-xs">🏠 Load</div>
                <div className="text-white text-xl font-bold">{totals.load.toFixed(2)}</div>
              </div>
              <div className="bg-cyan-500/20 rounded-lg p-3">
                <div className="text-cyan-400 text-xs">🔋↓ Charge</div>
                <div className="text-white text-xl font-bold">{totals.battery_charge.toFixed(2)}</div>
              </div>
              <div className="bg-cyan-500/20 rounded-lg p-3">
                <div className="text-cyan-400 text-xs">🔋↑ Discharge</div>
                <div className="text-white text-xl font-bold">{totals.battery_discharge.toFixed(2)}</div>
              </div>
              <div className="bg-blue-500/20 rounded-lg p-3">
                <div className="text-blue-400 text-xs">⬇️ Grid Import</div>
                <div className="text-white text-xl font-bold">{totals.grid_import.toFixed(2)}</div>
              </div>
              <div className="bg-green-500/20 rounded-lg p-3">
                <div className="text-green-400 text-xs">⬆️ Grid Export</div>
                <div className="text-white text-xl font-bold">{totals.grid_export.toFixed(2)}</div>
              </div>
            </div>
          </div>

          {/* 视图切换按钮 */}
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-gray-400 text-sm font-medium">
              {dailyData.length > 1 ? '详细数据' : '能量分布'}
            </h3>
            <div className="flex gap-2">
              {dailyData.length > 1 && (
                <button
                  onClick={() => setViewMode('chart')}
                  className={`px-3 py-1.5 rounded text-sm transition-colors ${
                    viewMode === 'chart' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  📊 柱状图
                </button>
              )}
              <button
                onClick={() => setViewMode('sankey')}
                className={`px-3 py-1.5 rounded text-sm transition-colors ${
                  viewMode === 'sankey' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                ⚡ 能量流向
              </button>
            </div>
          </div>

          {/* 柱状图（多天且选择chart时显示） */}
          {dailyData.length > 1 && viewMode === 'chart' && (
            <div className="bg-gray-800/50 rounded-xl p-4">
              <ResponsiveContainer width="100%" height={300}>
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
            </div>
          )}

          {/* Sankey图（选择sankey时显示） */}
          {viewMode === 'sankey' && (
            <div className="bg-gray-800/50 rounded-xl p-4">
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
                height={420}
                instanceId="history"
              />
            </div>
          )}
        </>
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
  const [error, setError] = useState(null);
  
  const [startDate, setStartDate] = useState(getToday());
  const [endDate, setEndDate] = useState(getToday());

  // 实时数据轮询
  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/current`);
        if (!response.ok) throw new Error('API 请求失败');
        const data = await response.json();
        setCurrentData(data);
        setError(null);
        
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
        setError(`连接失败: ${err.message}`);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  // 获取每日统计数据
  const fetchDailyRange = useCallback(async () => {
    setDailyLoading(true);
    try {
      if (startDate === endDate) {
        const response = await fetch(`${API_BASE}/api/daily?date=${startDate}`);
        if (!response.ok) throw new Error('获取每日数据失败');
        const data = await response.json();
        setDailyData([data]);
      } else {
        const response = await fetch(`${API_BASE}/api/daily/range?start_date=${startDate}&end_date=${endDate}`);
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
  const fetchHistoryRange = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/history/range?start_date=${startDate}&end_date=${endDate}&limit=300`);
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

  // 初始加载
  useEffect(() => {
    fetchDailyRange();
  }, [fetchDailyRange]);

  // 查询按钮处理
  const handleApply = () => {
    fetchDailyRange();
    fetchHistoryRange();
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-4 md:p-6">
      {/* 头部 */}
      <div className="max-w-7xl mx-auto mb-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-yellow-400 to-orange-500 bg-clip-text text-transparent">
            ☀️ Growatt Solar Dashboard
          </h1>
          <div className="flex items-center gap-4">
            <span className={`px-3 py-1 rounded-full text-sm ${currentData.connected ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
              {currentData.connected ? '● 已连接' : '○ 未连接'}
            </span>
          </div>
        </div>
      </div>

      {/* 三个模块 */}
      <div className="max-w-7xl mx-auto space-y-6">
        {/* 模块一：实时监控 */}
        <RealtimeSection currentData={currentData} error={error} />

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
      </div>

      {/* 底部 */}
      <div className="max-w-7xl mx-auto mt-8 text-center text-gray-500 text-sm">
        Growatt Solar Monitor | API: {API_BASE}
      </div>
    </div>
  );
}

export default App;
