import React, { useState, useEffect, useRef } from 'react';
import * as d3 from 'd3';

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
  let batteryIn = 0;
  let batteryOut = 0;
  
  if (battery_net !== undefined && Math.abs(battery_net) > 0.001) {
    if (battery_net > 0) {
      batteryIn = battery_net;
      batteryOut = 0;
    } else {
      batteryIn = 0;
      batteryOut = -battery_net;
    }
  } else {
    const netCharge = battery_charge - battery_discharge;
    if (netCharge > 0.001) {
      batteryIn = netCharge;
      batteryOut = 0;
    } else if (netCharge < -0.001) {
      batteryIn = 0;
      batteryOut = -netCharge;
    } else {
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

  // 监听容器宽度变化 - 使用 ResizeObserver 实时响应
  useEffect(() => {
    const updateWidth = () => {
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
    
    // 初始更新
    updateWidth();
    
    // 延迟更新以确保布局稳定
    const timer1 = setTimeout(updateWidth, 100);
    const timer2 = setTimeout(updateWidth, 300);
    
    // 使用 ResizeObserver 监听容器尺寸变化
    let resizeObserver = null;
    if (containerRef.current && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const width = entry.contentRect.width;
          if (width > 100) {
            setContainerWidth(width);
          }
        }
      });
      resizeObserver.observe(containerRef.current);
    }
    
    // 窗口 resize 事件作为后备
    window.addEventListener('resize', updateWidth);
    
    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      window.removeEventListener('resize', updateWidth);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, []);

  // D3 绘制
  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const margin = { top: 8, right: 20, bottom: 8, left: 20 };
    const width = containerWidth - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg
      .attr("width", containerWidth)
      .attr("height", height)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const nodeWidth = Math.min(100, Math.max(75, containerWidth * 0.14));
    
    const leftNodes = ["Solar", "Battery Out", "Grid In"];
    const rightNodes = ["Battery In", "Load", "Grid Out"];
    
    const leftTotal = Math.max(totalInput, 0.001);
    const rightTotal = Math.max(totalOutput, 0.001);
    
    const nodeGap = 4;
    const totalGaps = (leftNodes.length - 1) * nodeGap;
    const totalNodeHeight = innerHeight - 10 - totalGaps;  // 所有节点的总高度（不含间距）
    const minNodeHeight = 55;  // 每个节点的最小高度

    const nodeData = [];
    
    // 计算高度的辅助函数：先分配最小高度，剩余按比例分配
    const calculateHeights = (nodes, values, total) => {
      const n = nodes.length;
      const baseHeight = minNodeHeight * n;
      const extraHeight = Math.max(0, totalNodeHeight - baseHeight);
      
      return nodes.map(name => {
        const value = values[name];
        const ratio = total > 0.001 ? value / total : 0;
        return minNodeHeight + ratio * extraHeight;
      });
    };
    
    const leftHeights = calculateHeights(leftNodes, nodeValues, leftTotal);
    const rightHeights = calculateHeights(rightNodes, nodeValues, rightTotal);
    
    // 左侧节点
    let leftY = 0;
    leftNodes.forEach((name, i) => {
      const h = leftHeights[i];
      nodeData.push({
        name,
        x: 0,
        y: leftY,
        width: nodeWidth,
        height: h,
        value: nodeValues[name],
        side: "left",
        color: nodeColors[name],
        percentage: nodePercentages[name],
      });
      leftY += h + nodeGap;
    });

    // 右侧节点
    let rightY = 0;
    rightNodes.forEach((name, i) => {
      const h = rightHeights[i];
      nodeData.push({
        name,
        x: width - nodeWidth,
        y: rightY,
        width: nodeWidth,
        height: h,
        value: nodeValues[name],
        side: "right",
        color: nodeColors[name],
        percentage: nodePercentages[name],
      });
      rightY += h + nodeGap;
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

    // 计算流量总值
    const sourceFlowTotals = {};
    const targetFlowTotals = {};
    linkData.forEach(link => {
      sourceFlowTotals[link.source] = (sourceFlowTotals[link.source] || 0) + link.value;
      targetFlowTotals[link.target] = (targetFlowTotals[link.target] || 0) + link.value;
    });

    // 绘制渐变定义
    const defs = g.append("defs");
    
    // Flow 渐变 - 从source颜色渐变到target颜色
    linkData.forEach((link, i) => {
      const sourceNode = nodeMap[link.source];
      const targetNode = nodeMap[link.target];
      const gradientId = `gradient-${instanceId}-${i}`;
      
      const gradient = defs.append("linearGradient")
        .attr("id", gradientId)
        .attr("x1", "0%")
        .attr("x2", "100%");
      
      gradient.append("stop")
        .attr("offset", "0%")
        .attr("stop-color", sourceNode.color)
        .attr("stop-opacity", 0.85);
      
      gradient.append("stop")
        .attr("offset", "100%")
        .attr("stop-color", targetNode.color)
        .attr("stop-opacity", 0.85);
    });
    
    // 节点渐变
    nodeData.forEach((node, i) => {
      const nodeGradientId = `node-gradient-${instanceId}-${node.name.replace(/\s+/g, '-')}`;
      
      const nodeGradient = defs.append("linearGradient")
        .attr("id", nodeGradientId)
        .attr("x1", node.side === "left" ? "0%" : "100%")
        .attr("x2", node.side === "left" ? "100%" : "0%")
        .attr("y1", "0%")
        .attr("y2", "100%");
      
      nodeGradient.append("stop")
        .attr("offset", "0%")
        .attr("stop-color", node.color)
        .attr("stop-opacity", 1);
      
      nodeGradient.append("stop")
        .attr("offset", "50%")
        .attr("stop-color", d3.color(node.color).brighter(0.3))
        .attr("stop-opacity", 0.95);
      
      nodeGradient.append("stop")
        .attr("offset", "100%")
        .attr("stop-color", node.color)
        .attr("stop-opacity", 0.9);
    });

    // 绘制连接
    linkData.forEach((link, i) => {
      const sourceNode = nodeMap[link.source];
      const targetNode = nodeMap[link.target];
      
      const sourceTotal = sourceFlowTotals[link.source] || link.value;
      const targetTotal = targetFlowTotals[link.target] || link.value;
      const sourceRatio = link.value / sourceTotal;
      const targetRatio = link.value / targetTotal;
      const sourceWidth = Math.max(2, sourceRatio * sourceNode.height);
      const targetWidth = Math.max(2, targetRatio * targetNode.height);
      
      const x0 = sourceNode.x + sourceNode.width;
      const y0 = sourceNode.y + nodeSourceOffset[link.source] + sourceWidth / 2;
      const x1 = targetNode.x;
      const y1 = targetNode.y + nodeTargetOffset[link.target] + targetWidth / 2;
      const sy0 = y0 - sourceWidth / 2;
      const sy1 = y0 + sourceWidth / 2;
      const ty0 = y1 - targetWidth / 2;
      const ty1 = y1 + targetWidth / 2;
      
      nodeSourceOffset[link.source] += sourceWidth;
      nodeTargetOffset[link.target] += targetWidth;

      const curvature = 0.5;
      const xi = d3.interpolateNumber(x0, x1);
      const x2 = xi(curvature);
      const x3 = xi(1 - curvature);
      
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
      const nodeGradientId = `node-gradient-${instanceId}-${node.name.replace(/\s+/g, '-')}`;
      
      // 节点矩形 - 用path绘制自定义圆角
      // 左侧节点：左边圆角，右边直角
      // 右侧节点：右边圆角，左边直角
      const r = 6;  // 圆角半径
      const w = node.width;
      const h = node.height;
      
      let pathD;
      if (node.side === "left") {
        // 左侧节点：左上、左下圆角，右边直角
        pathD = `
          M ${r} 0
          L ${w} 0
          L ${w} ${h}
          L ${r} ${h}
          Q 0 ${h} 0 ${h - r}
          L 0 ${r}
          Q 0 0 ${r} 0
          Z
        `;
      } else {
        // 右侧节点：右上、右下圆角，左边直角
        pathD = `
          M 0 0
          L ${w - r} 0
          Q ${w} 0 ${w} ${r}
          L ${w} ${h - r}
          Q ${w} ${h} ${w - r} ${h}
          L 0 ${h}
          L 0 0
          Z
        `;
      }
      
      nodeG.append("path")
        .attr("d", pathD)
        .attr("fill", `url(#${nodeGradientId})`);
      
      // 标题button的样式 - 在block内部靠顶部
      const labelPadding = { x: 4, y: 2 };
      const labelRadius = 4;
      
      // 浅色button背景色 - 混合白色让它更浅
      const baseColor = d3.color(node.color);
      const buttonColor = d3.interpolateRgb(baseColor, "#FFFFFF")(0.5);
      const buttonColorDark = d3.interpolateRgb(baseColor, "#000000")(0.15);
      const buttonColorLight = d3.interpolateRgb(baseColor, "#FFFFFF")(0.75);
      
      // 第一行：名称 - 带button背景，在block顶部
      const nameText = node.name;
      const nameFontSize = 11;
      // 限制button宽度不超过block宽度-8
      const nameWidth = Math.min(nameText.length * nameFontSize * 0.6 + labelPadding.x * 2, node.width - 8);
      const nameHeight = nameFontSize + labelPadding.y * 2;
      const nameY = 6 + nameHeight / 2;  // 距离顶部6px
      const nameX = (node.width - nameWidth) / 2;
      
      // 为button创建立体渐变
      const buttonGradientId = `button-gradient-${instanceId}-${node.name.replace(/\s+/g, '-')}`;
      defs.append("linearGradient")
        .attr("id", buttonGradientId)
        .attr("x1", "0%")
        .attr("x2", "0%")
        .attr("y1", "0%")
        .attr("y2", "100%")
        .selectAll("stop")
        .data([
          { offset: "0%", color: buttonColorLight },
          { offset: "50%", color: buttonColor },
          { offset: "100%", color: d3.interpolateRgb(baseColor, "#FFFFFF")(0.35) }
        ])
        .enter()
        .append("stop")
        .attr("offset", d => d.offset)
        .attr("stop-color", d => d.color);
      
      // 阴影（底部深色边）
      nodeG.append("rect")
        .attr("x", nameX)
        .attr("y", 7)
        .attr("width", nameWidth)
        .attr("height", nameHeight)
        .attr("rx", labelRadius)
        .attr("fill", buttonColorDark)
        .attr("opacity", 0.4);
      
      // 主button背景（带渐变）
      nodeG.append("rect")
        .attr("x", nameX)
        .attr("y", 6)
        .attr("width", nameWidth)
        .attr("height", nameHeight)
        .attr("rx", labelRadius)
        .attr("fill", `url(#${buttonGradientId})`)
        .attr("stroke", buttonColorLight)
        .attr("stroke-width", 0.5);
      
      nodeG.append("text")
        .attr("x", node.width / 2)
        .attr("y", nameY)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .attr("fill", "#1F2937")
        .attr("font-size", `${nameFontSize}px`)
        .attr("font-weight", "bold")
        .text(nameText);
      
      // 第二行：数值 - 在block中下部
      const valueY = node.height * 0.55;
      nodeG.append("text")
        .attr("x", node.width / 2)
        .attr("y", valueY)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .attr("fill", "#1F2937")
        .attr("font-size", "14px")
        .attr("font-weight", "bold")
        .text(node.value.toFixed(2));
      
      // 第三行：百分比 - 在数值下方
      nodeG.append("text")
        .attr("x", node.width / 2)
        .attr("y", valueY + 16)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .attr("fill", "#374151")
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

export default SankeyFlow;
