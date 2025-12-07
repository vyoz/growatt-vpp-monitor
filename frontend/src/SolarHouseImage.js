import React, { useEffect, useRef, useState } from 'react';

// ============================================================
// 能量流动路径定义 - 基于PNG图片坐标系统
// 图片尺寸参考: 按比例缩放，viewBox设为 0 0 600 500
// 关键位置估算：
//   - 太阳能板中心: 约 (400, 80)
//   - 电网连接点(左侧电表): 约 (175, 215)  
//   - 电池(蓝色储能盒): 约 (195, 340)
//   - 逆变器(灰色盒子): 约 (175, 265)
//   - 房屋负载中心(室内): 约 (400, 280)
// ============================================================
const ENERGY_FLOW_PATHS = {
  // Solar → Grid: 太阳能板 → out
  //solarGrid: 'M480,220 L480,310 L525,315',
  solarGrid: 'M227,215 L227,298 L274,307 L274,313 L225,323',
  
  // Solar → Home: 太阳能板 → 房屋内部
  //solarHome: 'M280,155 L280,175',
  solarHome: 'M334,227 L334,324 L420,308 L390,305',
  
  // Solar → Battery: 太阳能板 → 电池
  solarBattery: 'M227,215 L227,298 L284,311',
  
  // Grid → Home: 电网 → 房屋
  //gridHome: 'M220,325 L281,315 L281,215',
  gridHome: 'M400,349 L322,329 L420,308 L390,305',
  
  // Grid → Battery: 电网 → 电池
  //gridToBattery: 'M255,335 L295,327',
  gridToBattery: 'M400,349 L322,329',
  
  // Battery → Home: 电池 → 房屋
  //batteryHome: 'M295,238 L295,218',
  batteryHome: 'M323,320 L337,324 L420,308 L390,305',
  
  // Battery → Grid: 电池 → 电网（反向出口）
  //batteryGrid: 'M320,329 L400,349 ',
  batteryGrid: 'M284,310 L274,307 L274,313 L225,323',
};

const COMET_COLORS = {
  solar: '#fbbf24',    // 黄金色
  grid: '#60a5fa',     // 蓝色
  battery: '#00e8bb',  // 青绿色
  // solar: '#00e8bb',    // 黄金色
  // grid: '#60a5fa',     // 蓝色
  // battery: '#00e8bb',  // 青绿色
};

// ============================================================
// 调试模式 - 设为 true 显示所有路径
// ============================================================
const DEBUG_SHOW_ALL_PATHS = false;  // 调试完成后改回 false

// ============================================================
// 工具函数
// ============================================================
const formatPower = (value) => {
  if (value === undefined || value === null) return { value: '0.00', unit: 'kW' };
  return { value: value.toFixed(2), unit: 'kW' };
};

// ============================================================
// 彗星动画配置 - 基准像素速度 + 功率比例缩放
// ============================================================
const COMET_BASE_PIXEL_SPEED = 40;  // 基准像素速度（1kW 时）
const COMET_MAX_POWER = 6;          // 最大参考功率

// 根据功率计算像素速度
// 功率越大速度越快，线性关系：0kW -> 0, 1kW -> 50, 6kW -> 300
const getPixelSpeed = (power) => {
  const absPower = Math.abs(power);
  if (absPower <= 0.01) return COMET_BASE_PIXEL_SPEED * 0.3;  // 最小速度
  return COMET_BASE_PIXEL_SPEED * absPower;
};

const getPathLength = (pathString) => {
  const commands = pathString.match(/[ML][^ML]*/g);
  if (!commands) return 0;
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

const pathToPoints = (pathString, numPoints = 100) => {
  const commands = pathString.match(/[ML][^ML]*/g);
  if (!commands) return [];
  let currentX = 0, currentY = 0;
  let segments = [];
  
  commands.forEach(cmd => {
    const type = cmd[0];
    const coords = cmd.slice(1).trim().split(/[\s,]+/).map(Number);
    if (type === 'M') {
      currentX = coords[0];
      currentY = coords[1];
    } else if (type === 'L') {
      segments.push({ x1: currentX, y1: currentY, x2: coords[0], y2: coords[1] });
      currentX = coords[0];
      currentY = coords[1];
    }
  });
  
  const lengths = segments.map(seg => Math.sqrt((seg.x2 - seg.x1) ** 2 + (seg.y2 - seg.y1) ** 2));
  const totalLength = lengths.reduce((a, b) => a + b, 0);
  const points = [];
  
  for (let i = 0; i <= numPoints; i++) {
    const targetDist = (i / numPoints) * totalLength;
    let accumulatedDist = 0;
    for (let j = 0; j < segments.length; j++) {
      if (accumulatedDist + lengths[j] >= targetDist) {
        const t = lengths[j] > 0 ? (targetDist - accumulatedDist) / lengths[j] : 0;
        const seg = segments[j];
        points.push({ x: seg.x1 + t * (seg.x2 - seg.x1), y: seg.y1 + t * (seg.y2 - seg.y1) });
        break;
      }
      accumulatedDist += lengths[j];
    }
  }
  return points;
};

// ============================================================
// 能量流动 Canvas 组件
// ============================================================
const EnergyFlowCanvas = ({
  solarToHome, solarToBattery, batteryToHome, gridToHome, gridToBattery, solarToGrid, batteryToGrid,
  solarToHomePower, solarToBatteryPower, solarToGridPower, gridToHomePower, gridToBatteryPower, batteryToHomePower, batteryToGridPower,
}) => {
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const progressRef = useRef({
    solarGrid: 0, solarHome: 0, solarBattery: 0,
    gridHome: 0, gridToBattery: 0, batteryHome: 0, batteryGrid: 0,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const viewBoxWidth = 600;
    const viewBoxHeight = 500;
    let scale = 1, offsetX = 0, offsetY = 0;
    
    const updateCanvasSize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const scaleX = rect.width / viewBoxWidth;
      const scaleY = rect.height / viewBoxHeight;
      scale = Math.min(scaleX, scaleY);
      offsetX = (rect.width - viewBoxWidth * scale) / 2;
      offsetY = (rect.height - viewBoxHeight * scale) / 2;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    
    const resizeObserver = new ResizeObserver(updateCanvasSize);
    resizeObserver.observe(canvas);
    updateCanvasSize();

    // 预计算路径
    const pathLengths = {};
    const paths = {};
    Object.keys(ENERGY_FLOW_PATHS).forEach(key => {
      pathLengths[key] = getPathLength(ENERGY_FLOW_PATHS[key]);
      paths[key] = pathToPoints(ENERGY_FLOW_PATHS[key]);
    });

    const cometLength = 18;
    const cometWidth = 4;

    const drawComet = (points, progress, color) => {
      if (!points || points.length === 0) return;
      const currentIndex = Math.floor(progress * (points.length - 1));
      const startIndex = Math.max(0, currentIndex - cometLength);
      
      for (let i = startIndex; i <= currentIndex; i++) {
        const point = points[i];
        const distanceFromHead = currentIndex - i;
        let opacity = 1 - (distanceFromHead / cometLength);

        // 终点渐隐：当接近终点时逐渐变透明
        const fadeLength = 10;  // 最后20个点开始渐隐
        const distanceToEnd = points.length - 1 - currentIndex;
        if (distanceToEnd < fadeLength) {
          opacity *= distanceToEnd / fadeLength;
        }

        const width = cometWidth * opacity;
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`;
        ctx.lineWidth = width * scale;
        ctx.lineCap = 'round';
        ctx.shadowBlur = 10 * opacity * scale;
        ctx.shadowColor = color;
        
        if (i > startIndex) {
          ctx.beginPath();
          ctx.moveTo(points[i - 1].x * scale + offsetX, points[i - 1].y * scale + offsetY);
          ctx.lineTo(point.x * scale + offsetX, point.y * scale + offsetY);
          ctx.stroke();
        }
      }
      ctx.shadowBlur = 0;
    };

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const frameRate = 60;
      
      // Solar flows
      if (solarToGrid) {
        drawComet(paths.solarGrid, progressRef.current.solarGrid, COMET_COLORS.solar);
        progressRef.current.solarGrid += getPixelSpeed(solarToGridPower) / frameRate / pathLengths.solarGrid;
        if (progressRef.current.solarGrid > 1) progressRef.current.solarGrid = 0;
      }
      if (solarToHome) {
        drawComet(paths.solarHome, progressRef.current.solarHome, COMET_COLORS.solar);
        progressRef.current.solarHome += getPixelSpeed(solarToHomePower) / frameRate / pathLengths.solarHome;
        if (progressRef.current.solarHome > 1) progressRef.current.solarHome = 0;
      }
      if (solarToBattery) {
        drawComet(paths.solarBattery, progressRef.current.solarBattery, COMET_COLORS.solar);
        progressRef.current.solarBattery += getPixelSpeed(solarToBatteryPower) / frameRate / pathLengths.solarBattery;
        if (progressRef.current.solarBattery > 1) progressRef.current.solarBattery = 0;
      }
      
      // Grid flows
      if (gridToHome) {
        drawComet(paths.gridHome, progressRef.current.gridHome, COMET_COLORS.grid);
        progressRef.current.gridHome += getPixelSpeed(gridToHomePower) / frameRate / pathLengths.gridHome;
        if (progressRef.current.gridHome > 1) progressRef.current.gridHome = 0;
      }
      if (gridToBattery) {
        drawComet(paths.gridToBattery, progressRef.current.gridToBattery, COMET_COLORS.grid);
        progressRef.current.gridToBattery += getPixelSpeed(gridToBatteryPower) / frameRate / pathLengths.gridToBattery;
        if (progressRef.current.gridToBattery > 1) progressRef.current.gridToBattery = 0;
      }
      
      // Battery flows
      if (batteryToHome) {
        drawComet(paths.batteryHome, progressRef.current.batteryHome, COMET_COLORS.battery);
        progressRef.current.batteryHome += getPixelSpeed(batteryToHomePower) / frameRate / pathLengths.batteryHome;
        if (progressRef.current.batteryHome > 1) progressRef.current.batteryHome = 0;
      }
      if (batteryToGrid) {
        drawComet(paths.batteryGrid, progressRef.current.batteryGrid, COMET_COLORS.battery);
        progressRef.current.batteryGrid += getPixelSpeed(batteryToGridPower) / frameRate / pathLengths.batteryGrid;
        if (progressRef.current.batteryGrid > 1) progressRef.current.batteryGrid = 0;
      }
      
      animationRef.current = requestAnimationFrame(animate);
    };
    
    animate();

    return () => {
      resizeObserver.disconnect();
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [solarToHome, solarToBattery, batteryToHome, gridToHome, gridToBattery, solarToGrid, batteryToGrid,
      solarToHomePower, solarToBatteryPower, solarToGridPower, gridToHomePower, gridToBatteryPower, batteryToHomePower, batteryToGridPower]);

  return <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full pointer-events-none" style={{ zIndex: 6 }} />;
};

// ============================================================
// 主组件 SolarHouseImage
// ============================================================
const SolarHouseImage = ({ 
  solar = 0, gridImport = 0, gridExport = 0,
  batteryCharge = 0, batteryDischarge = 0, load = 0, batteryPercent = 0,
  solarToHome = false, solarToBattery = false, batteryToHome = false,
  gridToHome = false, gridToBattery = false, solarToGrid = false, batteryToGrid = false,
  solarToHomePower = 0, solarToBatteryPower = 0, solarToGridPower = 0,
  gridToHomePower = 0, gridToBatteryPower = 0, batteryToHomePower = 0, batteryToGridPower = 0,
}) => {
  // for debug begin
  const [mouseCoords, setMouseCoords] = useState(null);

  const handleMouseMove = (e) => {
    if (!DEBUG_SHOW_ALL_PATHS) return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 600;
    const y = ((e.clientY - rect.top) / rect.height) * 500;
    setMouseCoords({ x: Math.round(x), y: Math.round(y), clientX: e.clientX, clientY: e.clientY });
  };

  const handleMouseLeave = () => setMouseCoords(null);
  // for debug end

  const solarFormatted = formatPower(solar);
  const gridInFormatted = formatPower(gridImport);
  const gridOutFormatted = formatPower(gridExport);
  const chargeFormatted = formatPower(batteryCharge);
  const dischargeFormatted = formatPower(batteryDischarge);
  const loadFormatted = formatPower(load);

  return (
    <div className="relative w-full h-full min-h-[280px]" style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)' }}>

      {/* SVG - 包含房屋图片和能量流线条 */}
      <svg 
        className="absolute top-0 left-0 w-full h-full" 
        style={{ zIndex: 5, pointerEvents: DEBUG_SHOW_ALL_PATHS ? 'auto' : 'none' }} 
        viewBox="0 0 600 500" 
        preserveAspectRatio="xMidYMid meet"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}>
        
        {/* 房屋图片 - 放在SVG内部，使用相同坐标系 */}
        <image 
          href="/solar_house_no_poles.png" 
          x="140" 
          y="20" 
          width="420" 
          height="400"
          preserveAspectRatio="xMidYMid meet"
          style={{ filter: 'drop-shadow(0 4px 20px rgba(0,0,0,0.4))' }}
        />

        
        {/* 电池电量指示器 - 不规则四边形，可单独调整每个角 */}
        {(() => {
          // 电池面板四个角坐标（左下开始，顺时针）
          // 用 DEBUG 模式找到精确位置后调整这些值
          const corners = {
            bottomLeft:  { x: 287, y: 314 },   // 左下角
            bottomRight: { x: 308, y: 319 },   // 右下角
            topRight:    { x: 308, y: 247 },   // 右上角
            topLeft:     { x: 287, y: 245 },   // 左上角
          };
          
          // 四边形轮廓
          const outlinePoints = `${corners.bottomLeft.x},${corners.bottomLeft.y} ${corners.bottomRight.x},${corners.bottomRight.y} ${corners.topRight.x},${corners.topRight.y} ${corners.topLeft.x},${corners.topLeft.y}`;
          
          // 计算填充（从底部往上，根据百分比插值）
          const percent = batteryPercent / 100;
          const fillTopLeft = {
            x: corners.bottomLeft.x + (corners.topLeft.x - corners.bottomLeft.x) * percent,
            y: corners.bottomLeft.y + (corners.topLeft.y - corners.bottomLeft.y) * percent,
          };
          const fillTopRight = {
            x: corners.bottomRight.x + (corners.topRight.x - corners.bottomRight.x) * percent,
            y: corners.bottomRight.y + (corners.topRight.y - corners.bottomRight.y) * percent,
          };
          const fillPoints = `${corners.bottomLeft.x},${corners.bottomLeft.y} ${corners.bottomRight.x},${corners.bottomRight.y} ${fillTopRight.x},${fillTopRight.y} ${fillTopLeft.x},${fillTopLeft.y}`;
          
          // 根据电量选择颜色
          const getFillColor = (p) => {
            if (p <= 10) return '#ef4444';  // 红色
            if (p <= 30) return '#f59e0b';  // 橙色
            return '#00e8bb';  // 绿色
          };
          
          // 文字位置（四边形中心）
          const centerX = (corners.bottomLeft.x + corners.bottomRight.x + corners.topRight.x + corners.topLeft.x) / 4;
          const centerY = (corners.bottomLeft.y + corners.bottomRight.y + corners.topRight.y + corners.topLeft.y) / 4;
          
          return (
            <>
              {/* 电池背景（深色） */}
              <polygon 
                points={outlinePoints} 
                fill="rgb(104, 107, 115)" 
                stroke="rgba(150,150,150,0.5)"
                strokeWidth="1"
              />
              {/* 电池填充（根据电量） */}
              {batteryPercent > 0 && (
                <polygon 
                  points={fillPoints} 
                  fill={getFillColor(batteryPercent)}
                  opacity="0.8"
                />
              )}
              {/* 电量百分比文字
              <text
                x={centerX}
                y={centerY}
                fill="white"
                fontSize="12"
                fontWeight="bold"
                textAnchor="middle"
                dominantBaseline="middle"
                style={{ textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
              >
                {Math.round(batteryPercent)}%
              </text> */}
            </>
          );
        })()}

        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        <style>{`
          .conn-line { stroke: rgba(255,255,255,0.15); stroke-width: 2; fill: none; stroke-linecap: round; stroke-linejoin: round; }
          .conn-line-active { stroke: rgba(255,255,255,0.25); stroke-width: 2.5; }
        `}</style>

        {/* 调试模式：显示所有路径 */}
        {DEBUG_SHOW_ALL_PATHS && (
          <>
            {/* 箭头标记定义 */}
            <defs>
              <marker id="arrow-yellow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 L1,3 Z" fill="#fbbf24" />
              </marker>
              <marker id="arrow-blue" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 L1,3 Z" fill="#60a5fa" />
              </marker>
              <marker id="arrow-cyan" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 L1,3 Z" fill="#00e8bb" />
              </marker>
            </defs>
            
            <path d={ENERGY_FLOW_PATHS.solarGrid} stroke="#fbbf24" strokeWidth="2" fill="none" strokeDasharray="5,5" markerMid="url(#arrow-yellow)" markerEnd="url(#arrow-yellow)" />
            <path d={ENERGY_FLOW_PATHS.solarHome} stroke="#fbbf24" strokeWidth="2" fill="none" strokeDasharray="5,5" markerMid="url(#arrow-yellow)" markerEnd="url(#arrow-yellow)" />
            <path d={ENERGY_FLOW_PATHS.solarBattery} stroke="#fbbf24" strokeWidth="2" fill="none" strokeDasharray="5,5" markerMid="url(#arrow-yellow)" markerEnd="url(#arrow-yellow)" />
            <path d={ENERGY_FLOW_PATHS.gridHome} stroke="#60a5fa" strokeWidth="2" fill="none" strokeDasharray="5,5" markerMid="url(#arrow-blue)" markerEnd="url(#arrow-blue)" />
            <path d={ENERGY_FLOW_PATHS.gridToBattery} stroke="#60a5fa" strokeWidth="2" fill="none" strokeDasharray="5,5" markerMid="url(#arrow-blue)" markerEnd="url(#arrow-blue)" />
            <path d={ENERGY_FLOW_PATHS.batteryHome} stroke="#00e8bb" strokeWidth="2" fill="none" strokeDasharray="5,5" markerMid="url(#arrow-cyan)" markerEnd="url(#arrow-cyan)" />
            <path d={ENERGY_FLOW_PATHS.batteryGrid} stroke="#00e8bb" strokeWidth="2" fill="none" strokeDasharray="5,5" markerMid="url(#arrow-cyan)" markerEnd="url(#arrow-cyan)" />
          </>
        )}
        
        {/* 正常模式：根据条件显示 */}
        {!DEBUG_SHOW_ALL_PATHS && (
          <>
            {solarToGrid && <path d={ENERGY_FLOW_PATHS.solarGrid} className="conn-line conn-line-active" filter="url(#glow)" />}
            {solarToHome && <path d={ENERGY_FLOW_PATHS.solarHome} className="conn-line conn-line-active" filter="url(#glow)" />}
            {solarToBattery && <path d={ENERGY_FLOW_PATHS.solarBattery} className="conn-line conn-line-active" filter="url(#glow)" />}
            {gridToHome && <path d={ENERGY_FLOW_PATHS.gridHome} className="conn-line conn-line-active" filter="url(#glow)" />}
            {gridToBattery && <path d={ENERGY_FLOW_PATHS.gridToBattery} className="conn-line conn-line-active" filter="url(#glow)" />}
            {batteryToHome && <path d={ENERGY_FLOW_PATHS.batteryHome} className="conn-line conn-line-active" filter="url(#glow)" />}
            {batteryToGrid && <path d={ENERGY_FLOW_PATHS.batteryGrid} className="conn-line conn-line-active" filter="url(#glow)" />}
          </>
        )}

        {/* Grid 标签 - 与地基平行 */}
        {/* 右侧: from grid - 只在 gridToHome 或 gridToBattery 有值时显示 */}
        {((gridToHome || gridToBattery)||DEBUG_SHOW_ALL_PATHS) && (
          <text 
            x="400" 
            y="345" 
            fill="#60a5fa" 
            fontSize="14" 
            fontWeight="600"
            transform="rotate(-15, 480, 410)"
            style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}
          >
            from grid ⚡ 
          </text>
        )}
        
        {/* 左侧: to grid (绿色) - 只在 batteryToGrid 或solarToGrid 有值时显示 */}
        {((batteryToGrid || solarToGrid) || DEBUG_SHOW_ALL_PATHS) && (
          <text 
            x="165" 
            y="330" 
            fill="#34d399" 
            fontSize="14" 
            fontWeight="600"
            transform="rotate(15, 145, 410)"
            style={{ textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}
          >
            ⚡ to grid
          </text>
        )}

        

      </svg>

      {/* 调试模式：鼠标坐标提示 */}
      {DEBUG_SHOW_ALL_PATHS && mouseCoords && (
        <div 
          className="fixed bg-black/80 text-white text-xs px-2 py-1 rounded pointer-events-none z-50"
          style={{ left: mouseCoords.clientX + 15, top: mouseCoords.clientY + 15 }}
        >
          ({mouseCoords.x}, {mouseCoords.y})
        </div>
      )}

      {/* Canvas Energy Flow with Comets - 调试时关闭 */}
      {!DEBUG_SHOW_ALL_PATHS && (
        <EnergyFlowCanvas
          solarToHome={solarToHome} solarToBattery={solarToBattery} batteryToHome={batteryToHome}
          gridToHome={gridToHome} gridToBattery={gridToBattery} solarToGrid={solarToGrid} batteryToGrid={batteryToGrid}
          solarToHomePower={solarToHomePower} solarToBatteryPower={solarToBatteryPower} solarToGridPower={solarToGridPower}
          gridToHomePower={gridToHomePower} gridToBatteryPower={gridToBatteryPower}
          batteryToHomePower={batteryToHomePower} batteryToGridPower={batteryToGridPower}
        />
      )}
      
      {/* Power Labels - 左上角 */}
      <div className="absolute top-[10px] left-[10px] flex flex-col gap-2 z-10">
        {solar > 0.01 && (
          <div className="text-white">
            <div className="text-[10px] text-white/50">Solar</div>
            <div className="text-[14px] font-semibold text-yellow-400">
              {solarFormatted.value} <span className="text-[10px] font-normal opacity-85">{solarFormatted.unit}</span>
            </div>
          </div>
        )}
        {batteryCharge > 0.01 && (
          <div className="text-white">
            <div className="text-[10px] text-white/50">Battery Charge</div>
            <div className="text-[14px] font-semibold text-cyan-400">
              {chargeFormatted.value} <span className="text-[10px] font-normal opacity-85">{chargeFormatted.unit}</span>
            </div>
          </div>
        )}
        {batteryDischarge > 0.01 && (
          <div className="text-white">
            <div className="text-[10px] text-white/50">Battery Discharge</div>
            <div className="text-[14px] font-semibold text-cyan-400">
              {dischargeFormatted.value} <span className="text-[10px] font-normal opacity-85">{dischargeFormatted.unit}</span>
            </div>
          </div>
        )}
        {load > 0.01 && (
          <div className="text-white">
            <div className="text-[10px] text-white/50">Load</div>
            <div className="text-[14px] font-semibold text-purple-400">
              {loadFormatted.value} <span className="text-[10px] font-normal opacity-85">{loadFormatted.unit}</span>
            </div>
          </div>
        )}
        {gridImport > 0.01 && (
          <div className="text-white">
            <div className="text-[10px] text-white/50">Grid In</div>
            <div className="text-[14px] font-semibold text-blue-400">
              {gridInFormatted.value} <span className="text-[10px] font-normal opacity-85">{gridInFormatted.unit}</span>
            </div>
          </div>
        )}
        {gridExport > 0.01 && (
          <div className="text-white">
            <div className="text-[10px] text-white/50">Grid Out</div>
            <div className="text-[14px] font-semibold text-green-400">
              {gridOutFormatted.value} <span className="text-[10px] font-normal opacity-85">{gridOutFormatted.unit}</span>
            </div>
          </div>
        )}
        {/* {batteryPercent > 0 && (
          <div className="text-white">
            <div className="text-[10px] text-white/50">Battery</div>
            <div className="text-[14px] font-semibold text-emerald-400">
              {batteryPercent.toFixed(0)} <span className="text-[10px] font-normal opacity-85">%</span>
            </div>
          </div>
        )} */}
      </div>

     
    </div>
  );
};

export default SolarHouseImage;
