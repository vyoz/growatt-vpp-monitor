import React, { useEffect, useRef } from 'react';

// 根据功率计算动画速度 (功率越大速度越快)
// 返回值是每帧的实际像素移动距离
const getFlowSpeed = (power) => {
  const absPower = Math.abs(power);
  if (absPower <= 0.01) return 20; // 最慢速度：20像素/秒
  const maxPower = 6;
  const minSpeed = 20;   // 最慢：20 像素/秒
  const maxSpeed = 80;  // 最快：100 像素/秒
  const ratio = Math.min(absPower / maxPower, 1);
  const speed = minSpeed + ratio * (maxSpeed - minSpeed);
  return speed;
};

// 计算路径的实际像素长度
const getPathLength = (pathString) => {
  const commands = pathString.match(/[ML][^ML]*/g);
  let totalLength = 0;
  let currentX = 0, currentY = 0;
  
  commands.forEach(cmd => {
    const type = cmd[0];
    const coords = cmd.slice(1).trim().split(/[\s,]+/).map(Number);
    
    if (type === 'M') {
      currentX = coords[0];
      currentY = coords[1];
    } else if (type === 'L') {
      const dx = coords[0] - currentX;
      const dy = coords[1] - currentY;
      totalLength += Math.sqrt(dx * dx + dy * dy);
      currentX = coords[0];
      currentY = coords[1];
    }
  });
  
  return totalLength;
};

// SVG path 转换为 Canvas 坐标点
const pathToPoints = (pathString, numPoints = 100) => {
  const commands = pathString.match(/[ML][^ML]*/g);
  const points = [];
  
  let currentX = 0, currentY = 0;
  let segments = [];
  
  commands.forEach(cmd => {
    const type = cmd[0];
    const coords = cmd.slice(1).trim().split(/[\s,]+/).map(Number);
    
    if (type === 'M') {
      currentX = coords[0];
      currentY = coords[1];
    } else if (type === 'L') {
      segments.push({
        x1: currentX,
        y1: currentY,
        x2: coords[0],
        y2: coords[1]
      });
      currentX = coords[0];
      currentY = coords[1];
    }
  });
  
  // 计算总长度
  const lengths = segments.map(seg => {
    const dx = seg.x2 - seg.x1;
    const dy = seg.y2 - seg.y1;
    return Math.sqrt(dx * dx + dy * dy);
  });
  const totalLength = lengths.reduce((a, b) => a + b, 0);
  
  // 沿路径生成点
  for (let i = 0; i <= numPoints; i++) {
    const targetDist = (i / numPoints) * totalLength;
    let accumulatedDist = 0;
    
    for (let j = 0; j < segments.length; j++) {
      const segLength = lengths[j];
      if (accumulatedDist + segLength >= targetDist) {
        const t = (targetDist - accumulatedDist) / segLength;
        const seg = segments[j];
        points.push({
          x: seg.x1 + t * (seg.x2 - seg.x1),
          y: seg.y1 + t * (seg.y2 - seg.y1)
        });
        break;
      }
      accumulatedDist += segLength;
    }
  }
  
  return points;
};

const EnergyFlowCanvas = ({
  // 能量流动状态
  solarToHome = false,
  solarToBattery = false,
  batteryToHome = false,
  gridToHome = false,
  solarToGrid = false,
  batteryToGrid = false,
  // 各条线的功率值
  solarToHomePower = 0,
  solarToBatteryPower = 0,
  solarToGridPower = 0,
  gridToHomePower = 0,
  batteryToHomePower = 0,
  batteryToGridPower = 0,
}) => {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const progressRef = useRef({
    solarGrid: 0,
    solarHome: 0,
    solarBattery: 0,
    gridHome: 0,
    batteryHome: 0,
    batteryGrid: 0,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    
    // SVG viewBox 的原始尺寸
    const viewBoxWidth = 400;
    const viewBoxHeight = 320;
    
    // 使用 ResizeObserver 获取实际容器尺寸
    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;
    
    const updateCanvasSize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      
      // 设置 canvas 实际像素尺寸（考虑设备像素比）
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      
      // 计算统一缩放比例（与 SVG preserveAspectRatio="xMidYMid meet" 一致）
      const scaleX = rect.width / viewBoxWidth;
      const scaleY = rect.height / viewBoxHeight;
      scale = Math.min(scaleX, scaleY);
      
      // 计算居中偏移
      offsetX = (rect.width - viewBoxWidth * scale) / 2;
      offsetY = (rect.height - viewBoxHeight * scale) / 2;
      
      // 缩放 context 以匹配设备像素比
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    
    const resizeObserver = new ResizeObserver(updateCanvasSize);
    resizeObserver.observe(canvas);
    updateCanvasSize();

    // 定义路径（与 SVG 中的路径一致）
    const pathDefinitions = {
      solarGrid: 'M250,90 L250,70 L155,70',
      solarHome: 'M265,148 L265,176 L233,176',
      solarBattery: 'M250,135 L175,135 L175,155',
      gridHome: 'M190,169 L220,169',
      batteryHome: 'M182,187 L220,187',
      batteryGrid: 'M170,152 L170,100 L155,100',
    };
    
    // 计算每条路径的长度
    const pathLengths = {
      solarGrid: getPathLength(pathDefinitions.solarGrid),
      solarHome: getPathLength(pathDefinitions.solarHome),
      solarBattery: getPathLength(pathDefinitions.solarBattery),
      gridHome: getPathLength(pathDefinitions.gridHome),
      batteryHome: getPathLength(pathDefinitions.batteryHome),
      batteryGrid: getPathLength(pathDefinitions.batteryGrid),
    };
    
    // 生成路径点
    const paths = {
      solarGrid: pathToPoints(pathDefinitions.solarGrid),
      solarHome: pathToPoints(pathDefinitions.solarHome),
      solarBattery: pathToPoints(pathDefinitions.solarBattery),
      gridHome: pathToPoints(pathDefinitions.gridHome),
      batteryHome: pathToPoints(pathDefinitions.batteryHome),
      batteryGrid: pathToPoints(pathDefinitions.batteryGrid),
    };

    // 彗星参数
    const cometLength = 15; // 彗星长度（点数）
    const cometWidth = 3;   // 彗星头部宽度

    const drawComet = (points, progress, color) => {
      if (!points || points.length === 0) return;
      
      const currentIndex = Math.floor(progress * (points.length - 1));
      const startIndex = Math.max(0, currentIndex - cometLength);
      
      // 从尾到头绘制彗星
      for (let i = startIndex; i <= currentIndex; i++) {
        const point = points[i];
        const distanceFromHead = currentIndex - i;
        const opacity = 1 - (distanceFromHead / cometLength);
        const width = cometWidth * opacity;
        
        // 将颜色字符串转换为 rgba
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`;
        ctx.lineWidth = width * scale;
        ctx.lineCap = 'round';
        
        // 添加发光效果
        ctx.shadowBlur = 8 * opacity * scale;
        ctx.shadowColor = color;
        
        if (i > startIndex) {
          ctx.beginPath();
          // 应用统一缩放和居中偏移
          ctx.moveTo(points[i - 1].x * scale + offsetX, points[i - 1].y * scale + offsetY);
          ctx.lineTo(point.x * scale + offsetX, point.y * scale + offsetY);
          ctx.stroke();
        }
      }
      
      ctx.shadowBlur = 0;
    };

    const animate = () => {
      // 使用实际 canvas 尺寸清除
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // 假设 60 FPS，计算每帧应该移动的距离
      const frameRate = 60;
      
      // Solar flows (yellow #fbbf24)
      if (solarToGrid) {
        drawComet(paths.solarGrid, progressRef.current.solarGrid, '#fbbf24');
        const pixelsPerFrame = getFlowSpeed(solarToGridPower) / frameRate;
        const progressIncrement = pixelsPerFrame / pathLengths.solarGrid;
        progressRef.current.solarGrid += progressIncrement;
        if (progressRef.current.solarGrid > 1) progressRef.current.solarGrid = 0;
      }
      
      if (solarToHome) {
        drawComet(paths.solarHome, progressRef.current.solarHome, '#fbbf24');
        const pixelsPerFrame = getFlowSpeed(solarToHomePower) / frameRate;
        const progressIncrement = pixelsPerFrame / pathLengths.solarHome;
        progressRef.current.solarHome += progressIncrement;
        if (progressRef.current.solarHome > 1) progressRef.current.solarHome = 0;
      }
      
      if (solarToBattery) {
        drawComet(paths.solarBattery, progressRef.current.solarBattery, '#fbbf24');
        const pixelsPerFrame = getFlowSpeed(solarToBatteryPower) / frameRate;
        const progressIncrement = pixelsPerFrame / pathLengths.solarBattery;
        progressRef.current.solarBattery += progressIncrement;
        if (progressRef.current.solarBattery > 1) progressRef.current.solarBattery = 0;
      }
      
      // Grid flow (blue #60a5fa)
      if (gridToHome) {
        drawComet(paths.gridHome, progressRef.current.gridHome, '#60a5fa');
        const pixelsPerFrame = getFlowSpeed(gridToHomePower) / frameRate;
        const progressIncrement = pixelsPerFrame / pathLengths.gridHome;
        progressRef.current.gridHome += progressIncrement;
        if (progressRef.current.gridHome > 1) progressRef.current.gridHome = 0;
      }
      
      // Battery flows (cyan #00e8bb)
      if (batteryToHome) {
        drawComet(paths.batteryHome, progressRef.current.batteryHome, '#00e8bb');
        const pixelsPerFrame = getFlowSpeed(batteryToHomePower) / frameRate;
        const progressIncrement = pixelsPerFrame / pathLengths.batteryHome;
        progressRef.current.batteryHome += progressIncrement;
        if (progressRef.current.batteryHome > 1) progressRef.current.batteryHome = 0;
      }
      
      if (batteryToGrid) {
        drawComet(paths.batteryGrid, progressRef.current.batteryGrid, '#00e8bb');
        const pixelsPerFrame = getFlowSpeed(batteryToGridPower) / frameRate;
        const progressIncrement = pixelsPerFrame / pathLengths.batteryGrid;
        progressRef.current.batteryGrid += progressIncrement;
        if (progressRef.current.batteryGrid > 1) progressRef.current.batteryGrid = 0;
      }
      
      animationRef.current = requestAnimationFrame(animate);
    };
    
    animate();

    return () => {
      resizeObserver.disconnect();
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [
    solarToHome, solarToBattery, batteryToHome, gridToHome, solarToGrid, batteryToGrid,
    solarToHomePower, solarToBatteryPower, solarToGridPower, 
    gridToHomePower, batteryToHomePower, batteryToGridPower
  ]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute top-0 left-0 w-full h-full pointer-events-none"
      style={{ zIndex: 6 }}
    />
  );
};

export default EnergyFlowCanvas;
