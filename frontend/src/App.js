import React, { useState, useEffect, useCallback, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from 'recharts';
import SolarHouse3D from './SolarHouse3D';
import WeatherDisplay from './WeatherDisplay';
import SankeyFlow from './SankeyFlow';
import DailyEarnings from './DailyEarnings';
import PowerChart from './PowerChart';
import BatterySOCChart from './BatterySOCChart';
import StatisticsSection from './StatisticsSection';

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
            <span>实时监控 Realtime</span>
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
        <div className="lg:col-span-1 bg-gray-800/50 rounded-xl overflow-hidden h-[220px] lg:h-[260px] relative">
          {/* 天气显示 */}
          <WeatherDisplay latitude={-37.8136} longitude={144.9631} />
          
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
        <div className="lg:col-span-1 bg-gray-800/50 rounded-xl p-3 overflow-hidden">
          <h3 className="text-gray-400 text-xs font-medium mb-1">能量流向 <span className="text-gray-500">(kW)</span></h3>
          <SankeyFlow data={data} height={220} instanceId="realtime" />
        </div>

        {/* 右侧：每日收益组件 - 占1列 */}
        <div className="lg:col-span-1 bg-gray-800/50 rounded-xl overflow-hidden h-[220px] lg:h-[260px]">
          <DailyEarnings apiBase={API_BASE} />
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
  //const [error, setError] = useState(null);
  const [realtimeError, setRealtimeError] = useState(null); 
  
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

  // 初始加载 - 默认使用过去7天
  useEffect(() => {
    const today = getToday();
    const now = new Date();
    const weekAgo = formatDate(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
    setStartDate(weekAgo);
    setEndDate(today);
    fetchDailyRange(weekAgo, today);
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
        <PowerChart apiBase={API_BASE} />

        {/* 模块四：电池电量曲线 */}
        <BatterySOCChart apiBase={API_BASE} />
      </div>

      {/* 底部 */}
      <div className="max-w-7xl mx-auto mt-8 text-center text-gray-500 text-sm">
        Growatt Solar Monitor | API: {API_BASE}
      </div>
    </div>
  );
}

export default App;
