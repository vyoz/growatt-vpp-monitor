import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

// ============================================================
// 能量流动路径定义 - 只需要在这里修改一次
// ============================================================
const ENERGY_FLOW_PATHS = {
  solarGrid: 'M270,90 L270,70 L155,70',
  solarHome: 'M280,140 L280,180 L270,180',
  solarBattery: 'M250,130 L203,130 L203,165',
  gridHome: 'M150,160 L150,210 L265,210 L265,192',
  gridBattery: 'M155,100 L195,100 L195,160',
  batteryHome: 'M210,190 L253,190',
  batteryGrid: 'M195,160 L195,100 L155,100',
};

// ============================================================
// 调试模式 - 设为 true 显示所有路径和坐标
// ============================================================
const DEBUG_SHOW_ALL_PATHS = false;  // 调试完成后改回 false

// ============================================================
// 工具函数
// ============================================================

const formatPower = (value) => {
  if (value === undefined || value === null) return { value: '0.00', unit: 'kW' };
  return { value: value.toFixed(2), unit: 'kW' };
};

const getFlowSpeed = (power) => {
  const absPower = Math.abs(power);
  if (absPower <= 0.01) return 20;
  const maxPower = 6;
  const minSpeed = 20;
  const maxSpeed = 80;
  const ratio = Math.min(absPower / maxPower, 1);
  return minSpeed + ratio * (maxSpeed - minSpeed);
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
      segments.push({ x1: currentX, y1: currentY, x2: coords[0], y2: coords[1] });
      currentX = coords[0];
      currentY = coords[1];
    }
  });
  
  const lengths = segments.map(seg => Math.sqrt((seg.x2 - seg.x1) ** 2 + (seg.y2 - seg.y1) ** 2));
  const totalLength = lengths.reduce((a, b) => a + b, 0);
  
  for (let i = 0; i <= numPoints; i++) {
    const targetDist = (i / numPoints) * totalLength;
    let accumulatedDist = 0;
    for (let j = 0; j < segments.length; j++) {
      if (accumulatedDist + lengths[j] >= targetDist) {
        const t = (targetDist - accumulatedDist) / lengths[j];
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
    gridHome: 0, gridBattery: 0, batteryHome: 0, batteryGrid: 0,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const viewBoxWidth = 400;
    const viewBoxHeight = 320;
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

    // 使用共享的路径定义
    const pathLengths = {};
    const paths = {};
    Object.keys(ENERGY_FLOW_PATHS).forEach(key => {
      pathLengths[key] = getPathLength(ENERGY_FLOW_PATHS[key]);
      paths[key] = pathToPoints(ENERGY_FLOW_PATHS[key]);
    });

    const cometLength = 15;
    const cometWidth = 3;

    const drawComet = (points, progress, color) => {
      if (!points || points.length === 0) return;
      const currentIndex = Math.floor(progress * (points.length - 1));
      const startIndex = Math.max(0, currentIndex - cometLength);
      
      for (let i = startIndex; i <= currentIndex; i++) {
        const point = points[i];
        const distanceFromHead = currentIndex - i;
        const opacity = 1 - (distanceFromHead / cometLength);
        const width = cometWidth * opacity;
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`;
        ctx.lineWidth = width * scale;
        ctx.lineCap = 'round';
        ctx.shadowBlur = 8 * opacity * scale;
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
      
      // Solar flows (yellow)
      if (solarToGrid) {
        drawComet(paths.solarGrid, progressRef.current.solarGrid, '#fbbf24');
        progressRef.current.solarGrid += getFlowSpeed(solarToGridPower) / frameRate / pathLengths.solarGrid;
        if (progressRef.current.solarGrid > 1) progressRef.current.solarGrid = 0;
      }
      if (solarToHome) {
        drawComet(paths.solarHome, progressRef.current.solarHome, '#fbbf24');
        progressRef.current.solarHome += getFlowSpeed(solarToHomePower) / frameRate / pathLengths.solarHome;
        if (progressRef.current.solarHome > 1) progressRef.current.solarHome = 0;
      }
      if (solarToBattery) {
        drawComet(paths.solarBattery, progressRef.current.solarBattery, '#fbbf24');
        progressRef.current.solarBattery += getFlowSpeed(solarToBatteryPower) / frameRate / pathLengths.solarBattery;
        if (progressRef.current.solarBattery > 1) progressRef.current.solarBattery = 0;
      }
      
      // Grid flows (blue)
      if (gridToHome) {
        drawComet(paths.gridHome, progressRef.current.gridHome, '#60a5fa');
        progressRef.current.gridHome += getFlowSpeed(gridToHomePower) / frameRate / pathLengths.gridHome;
        if (progressRef.current.gridHome > 1) progressRef.current.gridHome = 0;
      }
      if (gridToBattery) {
        drawComet(paths.gridBattery, progressRef.current.gridBattery, '#60a5fa');
        progressRef.current.gridBattery += getFlowSpeed(gridToBatteryPower) / frameRate / pathLengths.gridBattery;
        if (progressRef.current.gridBattery > 1) progressRef.current.gridBattery = 0;
      }
      
      // Battery flows (cyan)
      if (batteryToHome) {
        drawComet(paths.batteryHome, progressRef.current.batteryHome, '#00e8bb');
        progressRef.current.batteryHome += getFlowSpeed(batteryToHomePower) / frameRate / pathLengths.batteryHome;
        if (progressRef.current.batteryHome > 1) progressRef.current.batteryHome = 0;
      }
      if (batteryToGrid) {
        drawComet(paths.batteryGrid, progressRef.current.batteryGrid, '#00e8bb');
        progressRef.current.batteryGrid += getFlowSpeed(batteryToGridPower) / frameRate / pathLengths.batteryGrid;
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
// 主组件 SolarHouse3D
// ============================================================
const SolarHouse3D = ({ 
  solar = 0, gridImport = 0, gridExport = 0,
  batteryCharge = 0, batteryDischarge = 0, load = 0, batteryPercent = 0,
  solarToHome = false, solarToBattery = false, batteryToHome = false,
  gridToHome = false, gridToBattery = false, solarToGrid = false, batteryToGrid = false,
  solarToHomePower = 0, solarToBatteryPower = 0, solarToGridPower = 0,
  gridToHomePower = 0, gridToBatteryPower = 0, batteryToHomePower = 0, batteryToGridPower = 0,
}) => {
  const [mouseCoords, setMouseCoords] = useState(null);

  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const batteryGlowMeshRef = useRef(null);
  const animationIdRef = useRef(null);
  const [renderError, setRenderError] = useState(false);

  const solarFormatted = formatPower(solar);
  const gridInFormatted = formatPower(gridImport);
  const gridOutFormatted = formatPower(gridExport);
  const chargeFormatted = formatPower(batteryCharge);
  const dischargeFormatted = formatPower(batteryDischarge);
  const loadFormatted = formatPower(load);

  useEffect(() => {
    if (!containerRef.current) {
      setRenderError(true);
      return;
    }

    const container = containerRef.current;
    let initialized = false;
    let resizeObserver = null;

    const initScene = () => {
      if (initialized) return;
      
      const width = container.clientWidth || container.offsetWidth;
      const height = container.clientHeight || container.offsetHeight;

      if (width < 10 || height < 10) return;

      setRenderError(false);
      initialized = true;

      try {
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x2d323d);
        sceneRef.current = scene;

        const aspect = width / height;
        const viewSize = 6.5;
        const camera = new THREE.OrthographicCamera(
          -viewSize * aspect, viewSize * aspect, viewSize, -viewSize, 0.1, 1000
        );
        camera.position.set(10, 7, 10);
        camera.lookAt(-2, 0, 0);
        cameraRef.current = camera;

        let renderer;
        try {
          renderer = new THREE.WebGLRenderer({ antialias: true });
          renderer.setSize(width, height);
          renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
          renderer.shadowMap.enabled = true;
          renderer.shadowMap.type = THREE.PCFSoftShadowMap;
          container.appendChild(renderer.domElement);
          rendererRef.current = renderer;
        } catch (error) {
          setRenderError(true);
          return;
        }

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
        scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(10, 20, 10);
        directionalLight.castShadow = true;
        scene.add(directionalLight);

        const fillLight = new THREE.DirectionalLight(0x8899bb, 0.4);
        fillLight.position.set(-10, 5, -10);
        scene.add(fillLight);

        try {
          createScene(scene, batteryPercent);
        } catch (error) {
          setRenderError(true);
          return;
        }

        const animate = () => {
          try {
            animationIdRef.current = requestAnimationFrame(animate);
            renderer.render(scene, camera);
          } catch (error) {
            cancelAnimationFrame(animationIdRef.current);
          }
        };
        animate();

      } catch (error) {
        setRenderError(true);
      }
    };

    resizeObserver = new ResizeObserver(() => {
      if (!initialized) initScene();
    });
    resizeObserver.observe(container);
    initScene();

    const handleResize = () => {
      if (!initialized || !cameraRef.current || !rendererRef.current) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      const viewSize = 6.5;
      const aspect = width / height;
      cameraRef.current.left = -viewSize * aspect;
      cameraRef.current.right = viewSize * aspect;
      cameraRef.current.top = viewSize;
      cameraRef.current.bottom = -viewSize;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(width, height);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      if (animationIdRef.current) cancelAnimationFrame(animationIdRef.current);
      if (rendererRef.current) {
        try {
          if (container && container.contains(rendererRef.current.domElement)) {
            container.removeChild(rendererRef.current.domElement);
          }
          rendererRef.current.dispose();
        } catch (error) {}
      }
    };
  }, []);

  useEffect(() => {
    if (batteryGlowMeshRef.current) {
      const maxGlowH = 0.9;
      const newH = (batteryPercent / 100) * maxGlowH;
      batteryGlowMeshRef.current.scale.y = newH / 0.9 || 0.01;
      batteryGlowMeshRef.current.position.y = 0.35 + newH / 2;
    }
  }, [batteryPercent]);

  const createScene = (scene, initialBatteryPercent) => {
    // Materials
    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x6e7580, roughness: 0.85 });
    const wallSideMaterial = new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.85 });
    const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.7 });
    const solarPanelMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x1a3050, roughness: 0.15, metalness: 0.7
    });
    const solarGridMaterial = new THREE.LineBasicMaterial({ color: 0x3a5575 });
    const solarFrameMaterial = new THREE.LineBasicMaterial({ color: 0x6090b0 });
    const windowMaterial = new THREE.MeshStandardMaterial({ 
      color: 0xffdd44, emissive: 0xffcc00, emissiveIntensity: 0.9, roughness: 0.1
    });
    const batteryMaterial = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.3 });
    const batteryGlowMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x00e8bb, emissive: 0x00e8bb, emissiveIntensity: 0.8
    });
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x454b55, roughness: 0.9 });
    const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x7a8088, roughness: 0.6 });
    const inverterMaterial = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.4 });

    // Ground
    const ground = new THREE.Mesh(new THREE.BoxGeometry(10, 0.25, 7.5), groundMaterial);
    ground.position.set(1, -0.125, 0);
    ground.receiveShadow = true;
    scene.add(ground);

    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(10.3, 0.1, 7.8),
      new THREE.MeshStandardMaterial({ color: 0x35393f })
    );
    edge.position.set(1, -0.3, 0);
    scene.add(edge);

    // House parameters
    const wallHeight = 2.8;
    const wallWidth = 4.2;
    const wallDepth = 3.9;
    const roofHeight = 1.6;
    const eaveOverhang = 0.35;
    const roofAngle = Math.atan2(roofHeight, wallWidth / 2);

    const houseGroup = new THREE.Group();

    // Front wall
    const frontWall = new THREE.Mesh(new THREE.BoxGeometry(wallWidth, wallHeight, 0.15), wallMaterial);
    frontWall.position.set(0, wallHeight / 2, wallDepth / 2);
    frontWall.castShadow = true;
    houseGroup.add(frontWall);

    // Back wall
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(wallWidth, wallHeight, 0.15), wallSideMaterial);
    backWall.position.set(0, wallHeight / 2, -wallDepth / 2);
    houseGroup.add(backWall);

    // Left wall
    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.15, wallHeight, wallDepth), wallSideMaterial);
    leftWall.position.set(-wallWidth / 2, wallHeight / 2, 0);
    houseGroup.add(leftWall);

    // Right wall
    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.15, wallHeight, wallDepth), wallMaterial);
    rightWall.position.set(wallWidth / 2, wallHeight / 2, 0);
    houseGroup.add(rightWall);

    // Roof
    const roofLength = Math.sqrt(roofHeight * roofHeight + (wallWidth / 2) * (wallWidth / 2)) + eaveOverhang;
    const roofDepth = wallDepth + eaveOverhang * 2;

    const leftRoof = new THREE.Mesh(new THREE.BoxGeometry(roofLength, 0.12, roofDepth), roofMaterial);
    leftRoof.position.set(-wallWidth / 4 - eaveOverhang * 0.2, wallHeight + roofHeight / 2, 0);
    leftRoof.rotation.z = roofAngle;
    leftRoof.castShadow = true;
    houseGroup.add(leftRoof);

    const rightRoof = new THREE.Mesh(new THREE.BoxGeometry(roofLength, 0.12, roofDepth), roofMaterial);
    rightRoof.position.set(wallWidth / 4 + eaveOverhang * 0.2, wallHeight + roofHeight / 2, 0);
    rightRoof.rotation.z = -roofAngle;
    rightRoof.castShadow = true;
    houseGroup.add(rightRoof);

    const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, roofDepth), roofMaterial);
    ridge.position.set(0, wallHeight + roofHeight + 0.1, 0);
    houseGroup.add(ridge);

    // Roof triangles
    const triShape = new THREE.Shape();
    triShape.moveTo(-wallWidth / 2, 0);
    triShape.lineTo(0, roofHeight);
    triShape.lineTo(wallWidth / 2, 0);
    triShape.lineTo(-wallWidth / 2, 0);
    const triGeo = new THREE.ShapeGeometry(triShape);

    const frontTri = new THREE.Mesh(triGeo, wallMaterial);
    frontTri.position.set(0, wallHeight, wallDepth / 2 + 0.08);
    houseGroup.add(frontTri);

    const backTri = new THREE.Mesh(triGeo, wallSideMaterial);
    backTri.position.set(0, wallHeight, -wallDepth / 2 - 0.08);
    backTri.rotation.y = Math.PI;
    houseGroup.add(backTri);

    // Solar panels
    const panelRows = 5;
    const panelCols = 4;
    const panelWidth = 0.5;
    const panelH = 0.6;
    const gap = 0.08;

    const solarGroup = new THREE.Group();
    const totalW = panelCols * panelWidth + (panelCols - 1) * gap;
    const totalH = panelRows * panelH + (panelRows - 1) * gap;

    for (let row = 0; row < panelRows; row++) {
      for (let col = 0; col < panelCols; col++) {
        const localX = -totalW / 2 + panelWidth / 2 + col * (panelWidth + gap);
        const localZ = -totalH / 2 + panelH / 2 + row * (panelH + gap);

        const panelGeo = new THREE.BoxGeometry(panelWidth, 0.04, panelH);
        const panel = new THREE.Mesh(panelGeo, solarPanelMaterial);
        panel.position.set(localX, 0.02, localZ);
        solarGroup.add(panel);

        const edgesGeo = new THREE.EdgesGeometry(panelGeo);
        const edges = new THREE.LineSegments(edgesGeo, solarFrameMaterial);
        edges.position.set(localX, 0.02, localZ);
        solarGroup.add(edges);

        for (let i = 1; i <= 2; i++) {
          const lineZ = localZ - panelH / 2 + i * panelH / 3;
          const pts = [
            new THREE.Vector3(localX - panelWidth / 2 + 0.02, 0.04, lineZ),
            new THREE.Vector3(localX + panelWidth / 2 - 0.02, 0.04, lineZ)
          ];
          const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
          solarGroup.add(new THREE.Line(lineGeo, solarGridMaterial));
        }

        const vPts = [
          new THREE.Vector3(localX, 0.04, localZ - panelH / 2 + 0.02),
          new THREE.Vector3(localX, 0.04, localZ + panelH / 2 - 0.02)
        ];
        const vLineGeo = new THREE.BufferGeometry().setFromPoints(vPts);
        solarGroup.add(new THREE.Line(vLineGeo, solarGridMaterial));
      }
    }

    solarGroup.rotation.z = -roofAngle;
    solarGroup.position.set(wallWidth / 4 + 0.3, wallHeight + roofHeight / 2 + 0.15, 0);
    houseGroup.add(solarGroup);

    // Window - on right wall facing carport
    const windowGroup = new THREE.Group();
    const winBg = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 1.4, 1.1),
      new THREE.MeshStandardMaterial({ color: 0x2a2f38 })
    );
    windowGroup.add(winBg);

    const glassGeo = new THREE.BoxGeometry(0.08, 0.55, 0.45);
    [[-0.32, 0.26], [-0.32, -0.26], [0.32, 0.26], [0.32, -0.26]].forEach(([y, z]) => {
      const glass = new THREE.Mesh(glassGeo, windowMaterial);
      glass.position.set(0.05, y, z);
      windowGroup.add(glass);
    });

    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a4048 });
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 1.05), frameMat);
    crossH.position.x = 0.06;
    windowGroup.add(crossH);
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.35, 0.08), frameMat);
    crossV.position.x = 0.06;
    windowGroup.add(crossV);

    windowGroup.position.set(wallWidth / 2 + 0.08, 1.5, 1.5);
    houseGroup.add(windowGroup);

    houseGroup.position.set(1.5, 0, 0);
    scene.add(houseGroup);

    // Battery
    const batteryGroup = new THREE.Group();
    const batt = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.5, 0.45), batteryMaterial);
    batt.position.y = 0.75;
    batt.castShadow = true;
    batteryGroup.add(batt);

    const display = new THREE.Mesh(
      new THREE.BoxGeometry(0.65, 1.0, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
    );
    display.position.set(0, 0.8, 0.24);
    batteryGroup.add(display);

    const maxGlowH = 0.9;
    const glowH = (initialBatteryPercent / 100) * maxGlowH;
    const batteryGlowMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.58, glowH, 0.03),
      batteryGlowMaterial
    );
    batteryGlowMesh.position.set(0, 0.35 + glowH / 2, 0.25);
    batteryGroup.add(batteryGlowMesh);
    batteryGlowMeshRef.current = batteryGlowMesh;

    const led = new THREE.Mesh(
      new THREE.CircleGeometry(0.04, 16),
      new THREE.MeshBasicMaterial({ color: 0x00ff88 })
    );
    led.position.set(0, 1.35, 0.24);
    batteryGroup.add(led);

    batteryGroup.position.set(0.8, 0, 2.4);
    scene.add(batteryGroup);

    // Inverter
    const inverterGroup = new THREE.Group();
    const inv = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.55, 0.15), inverterMaterial);
    inverterGroup.add(inv);

    const screen = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.18, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x111111 })
    );
    screen.position.set(0, 0.08, 0.09);
    inverterGroup.add(screen);

    const invLed = new THREE.Mesh(
      new THREE.CircleGeometry(0.025, 16),
      new THREE.MeshBasicMaterial({ color: 0x22cc55 })
    );
    invLed.position.set(0, -0.12, 0.09);
    inverterGroup.add(invLed);

    inverterGroup.position.set(2.2, 1.3, 2.3);
    scene.add(inverterGroup);

    // Power pole
    const poleGroup = new THREE.Group();
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.07, 4.5, 8),
      poleMaterial
    );
    pole.position.y = 2.25;
    pole.castShadow = true;
    poleGroup.add(pole);

    const beamGeo = new THREE.BoxGeometry(1.0, 0.06, 0.06);
    const beam1 = new THREE.Mesh(beamGeo, poleMaterial);
    beam1.position.set(0, 4.3, 0);
    poleGroup.add(beam1);

    const beam2 = new THREE.Mesh(beamGeo, poleMaterial);
    beam2.position.set(0, 3.9, 0);
    poleGroup.add(beam2);

    const insGeo = new THREE.CylinderGeometry(0.025, 0.035, 0.1, 8);
    const insMat = new THREE.MeshStandardMaterial({ color: 0x99aabb });
    [-0.35, 0, 0.35].forEach(x => {
      const ins = new THREE.Mesh(insGeo, insMat);
      ins.position.set(x, 4.4, 0);
      poleGroup.add(ins);
    });

    poleGroup.position.set(-3.5, 0, 1.5);
    scene.add(poleGroup);

    // Carport
    const carportGroup = new THREE.Group();
    const pillarGeo = new THREE.BoxGeometry(0.08, 1.9, 0.08);
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x5a6068 });
    [[0.9, 0.7], [0.9, -0.7], [-0.9, 0.7], [-0.9, -0.7]].forEach(([x, z]) => {
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(x, 0.95, z);
      pillar.castShadow = true;
      carportGroup.add(pillar);
    });

    const cpRoof = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 1.8), roofMaterial);
    cpRoof.position.y = 1.95;
    cpRoof.castShadow = true;
    carportGroup.add(cpRoof);

    carportGroup.position.set(5.0, 0, -0.6);
    scene.add(carportGroup);

    // Car
    const carGroup = new THREE.Group();
    const carMat = new THREE.MeshStandardMaterial({ color: 0x4a5058, metalness: 0.5, roughness: 0.4 });

    const carBody = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.4, 0.75), carMat);
    carBody.position.y = 0.28;
    carBody.castShadow = true;
    carGroup.add(carBody);

    const carTop = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.32, 0.68), carMat);
    carTop.position.set(-0.08, 0.58, 0);
    carGroup.add(carTop);

    const cwMat = new THREE.MeshStandardMaterial({ color: 0x88ccff, metalness: 0.3, roughness: 0.1 });
    const cwGeo = new THREE.BoxGeometry(0.75, 0.28, 0.04);
    const cw1 = new THREE.Mesh(cwGeo, cwMat);
    cw1.position.set(-0.08, 0.58, 0.36);
    carGroup.add(cw1);
    const cw2 = new THREE.Mesh(cwGeo, cwMat);
    cw2.position.set(-0.08, 0.58, -0.36);
    carGroup.add(cw2);

    const wheelGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.08, 16);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });
    [[-0.45, 0.42], [0.45, 0.42], [-0.45, -0.42], [0.45, -0.42]].forEach(([x, z]) => {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.position.set(x, 0.13, z);
      wheel.rotation.x = Math.PI / 2;
      carGroup.add(wheel);
    });

    carGroup.position.set(5.0, 0, -0.5);
    carGroup.rotation.y = -0.25;
    scene.add(carGroup);
  };

  return (
    <div className="relative w-full h-full min-h-[280px]" style={{ background: '#2d323d' }}>
      {renderError && (
        <div className="absolute inset-0 flex items-center justify-center z-20">
          <div className="text-center text-gray-400">
            <div className="text-4xl mb-2">🏠</div>
            <div className="text-sm">3D 模型加载中...</div>
            <div className="text-xs mt-1 opacity-50">如持续显示此消息，请刷新页面</div>
          </div>
        </div>
      )}
      
      {/* Labels */}
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
      </div>

     {/* SVG Connection Lines - 使用共享的路径定义 */}
      <svg 
        className="absolute top-0 left-0 w-full h-full z-[5]" 
        style={{ pointerEvents: DEBUG_SHOW_ALL_PATHS ? 'auto' : 'none' }}
        viewBox="0 0 400 320" 
        preserveAspectRatio="xMidYMid meet"
        onMouseMove={(e) => {
          if (!DEBUG_SHOW_ALL_PATHS) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * 400;
          const y = ((e.clientY - rect.top) / rect.height) * 320;
          setMouseCoords({ x: Math.round(x), y: Math.round(y), clientX: e.clientX, clientY: e.clientY });
        }}
        onMouseLeave={() => setMouseCoords(null)}
      >
        <style>{`
          .conn-line { stroke: rgba(255,255,255,0.2); stroke-width: 1; fill: none; }
        `}</style>
        
        {/* 调试模式：显示所有路径 */}
        {DEBUG_SHOW_ALL_PATHS && (
          <>
            <path d={ENERGY_FLOW_PATHS.solarGrid} stroke="#fbbf24" strokeWidth="2" fill="none" strokeDasharray="5,5" />
            <path d={ENERGY_FLOW_PATHS.solarHome} stroke="#fbbf24" strokeWidth="2" fill="none" strokeDasharray="5,5" />
            <path d={ENERGY_FLOW_PATHS.solarBattery} stroke="#fbbf24" strokeWidth="2" fill="none" strokeDasharray="5,5" />
            <path d={ENERGY_FLOW_PATHS.gridHome} stroke="#60a5fa" strokeWidth="2" fill="none" strokeDasharray="5,5" />
            <path d={ENERGY_FLOW_PATHS.gridBattery} stroke="#60a5fa" strokeWidth="2" fill="none" strokeDasharray="5,5" />
            <path d={ENERGY_FLOW_PATHS.batteryHome} stroke="#00e8bb" strokeWidth="2" fill="none" strokeDasharray="5,5" />
            <path d={ENERGY_FLOW_PATHS.batteryGrid} stroke="#00e8bb" strokeWidth="2" fill="none" strokeDasharray="5,5" />
          </>
        )}
        
        {/* 正常模式 */}
        {!DEBUG_SHOW_ALL_PATHS && (
          <>
            {solarToGrid && <path d={ENERGY_FLOW_PATHS.solarGrid} className="conn-line" />}
            {solarToHome && <path d={ENERGY_FLOW_PATHS.solarHome} className="conn-line" />}
            {solarToBattery && <path d={ENERGY_FLOW_PATHS.solarBattery} className="conn-line" />}
            {gridToHome && <path d={ENERGY_FLOW_PATHS.gridHome} className="conn-line" />}
            {gridToBattery && <path d={ENERGY_FLOW_PATHS.gridBattery} className="conn-line" />}
            {batteryToHome && <path d={ENERGY_FLOW_PATHS.batteryHome} className="conn-line" />}
            {batteryToGrid && <path d={ENERGY_FLOW_PATHS.batteryGrid} className="conn-line" />}
          </>
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

      {/* Canvas Energy Flow with Comets */}
      <EnergyFlowCanvas
        solarToHome={solarToHome} solarToBattery={solarToBattery} batteryToHome={batteryToHome}
        gridToHome={gridToHome} gridToBattery={gridToBattery} solarToGrid={solarToGrid} batteryToGrid={batteryToGrid}
        solarToHomePower={solarToHomePower} solarToBatteryPower={solarToBatteryPower} solarToGridPower={solarToGridPower}
        gridToHomePower={gridToHomePower} gridToBatteryPower={gridToBatteryPower}
        batteryToHomePower={batteryToHomePower} batteryToGridPower={batteryToGridPower}
      />

      {/* Three.js Canvas Container */}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
};

export default SolarHouse3D;
