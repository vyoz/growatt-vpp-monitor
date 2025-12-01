// API 基础地址 - 使用相对路径，自动适配部署环境
const API_BASE = '';

// ============================================================
// React 组件开始
// ============================================================
const { useState, useEffect, useCallback, useRef } = React;
const { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } = Recharts;

// 工具函数
const formatDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getToday = () => formatDate(new Date());

// 小卡片组件
const MiniStatCard = ({ title, value, icon, color, unit = "kW" }) => {
  const colors = {
    yellow: '#FCD34D',
    purple: '#A78BFA',
    cyan: '#22D3EE',
    blue: '#60A5FA',
    green: '#34D399',
  };
  
  const c = colors[color] || colors.blue;

  return React.createElement('div', {
    className: "rounded-lg px-2 py-1.5",
    style: { backgroundColor: `${c}33`, color: c }
  },
    React.createElement('p', { className: "text-xs opacity-80 leading-tight" }, `${icon} ${title}`),
    React.createElement('p', { className: "text-white text-base font-bold leading-tight" },
      typeof value === 'number' ? value.toFixed(2) : value,
      React.createElement('span', { className: "text-xs ml-1 opacity-70" }, unit)
    )
  );
};

// 电池卡片
const BatteryCard = ({ title, value }) => {
  const percentage = typeof value === 'number' ? value : 0;
  
  const getColor = (pct) => {
    if (pct >= 30) return '#34D399';
    if (pct >= 10) return '#F59E0B';
    return '#EF4444';
  };
  
  const color = getColor(percentage);
  const fillWidth = Math.max(0, Math.min(100, percentage));

  return React.createElement('div', { className: "bg-gray-800/50 rounded-lg px-3 py-2 flex items-center gap-3" },
    React.createElement('svg', { width: 48, height: 24, viewBox: "0 0 48 24" },
      React.createElement('rect', { x: 1, y: 3, width: 40, height: 18, rx: 3, ry: 3, fill: "none", stroke: "#6B7280", strokeWidth: 2 }),
      React.createElement('rect', { x: 41, y: 8, width: 5, height: 8, rx: 1, ry: 1, fill: "#6B7280" }),
      React.createElement('rect', { x: 3, y: 5, width: fillWidth * 0.36, height: 14, rx: 2, ry: 2, fill: color })
    ),
    React.createElement('div', {},
      React.createElement('p', { className: "text-gray-400 text-xs" }, title),
      React.createElement('p', { className: "text-white text-lg font-bold" },
        percentage.toFixed(0),
        React.createElement('span', { className: "text-sm ml-0.5" }, '%')
      )
    )
  );
};

// 主应用组件
function App() {
  const [currentData, setCurrentData] = useState({
    solar: 0, battery_discharge: 0, grid_import: 0, battery_charge: 0,
    load: 0, grid_export: 0, battery_net: 0, soc_inv: 0, soc_bms: 0,
    timestamp: null, connected: false
  });

  const [error, setError] = useState(null);

  // 实时数据轮询
  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/current`);
        if (!response.ok) throw new Error('API 请求失败');
        const data = await response.json();
        setCurrentData(data);
        setError(null);
      } catch (err) {
        setError(`连接失败: ${err.message}`);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  return React.createElement('div', { className: "min-h-screen bg-gray-950 text-white p-4 md:p-6" },
    // 头部
    React.createElement('div', { className: "max-w-7xl mx-auto mb-6" },
      React.createElement('div', { className: "flex items-center justify-between flex-wrap gap-4" },
        React.createElement('h1', { className: "text-3xl font-bold bg-gradient-to-r from-yellow-400 to-orange-500 bg-clip-text text-transparent" },
          '☀️ Growatt Solar Dashboard (.NET)'
        ),
        React.createElement('div', { className: "flex items-center gap-4" },
          React.createElement('span', {
            className: `px-3 py-1 rounded-full text-sm ${
              currentData.connected && !error 
                ? 'bg-green-500/20 text-green-400' 
                : 'bg-red-500/20 text-red-400'
            }`
          }, currentData.connected && !error ? '● 已连接' : '○ 未连接')
        )
      )
    ),

    // 主内容区域
    React.createElement('div', { className: "max-w-7xl mx-auto space-y-6" },
      // 实时监控卡片
      React.createElement('div', { className: "bg-gray-900/50 rounded-2xl p-4 border border-gray-800" },
        React.createElement('div', { className: "mb-3" },
          React.createElement('h2', { className: "text-lg font-bold text-white flex items-center gap-2" },
            React.createElement('span', { className: "text-xl" }, '⚡'),
            React.createElement('span', {}, '实时监控')
          ),
          currentData.timestamp && React.createElement('p', { className: "text-gray-400 text-xs" },
            `最后更新: ${new Date(currentData.timestamp).toLocaleTimeString('zh-CN')}`
          )
        ),

        error && React.createElement('div', { 
          className: "mb-3 px-3 py-1.5 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm" 
        }, `⚠️ ${error}`),

        React.createElement('div', { className: "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2" },
          React.createElement(MiniStatCard, { title: "Solar", value: currentData.solar, icon: "☀️", color: "yellow" }),
          React.createElement(MiniStatCard, { title: "Load", value: currentData.load, icon: "🏠", color: "purple" }),
          React.createElement(MiniStatCard, { title: "Batt In", value: currentData.battery_charge, icon: "🔋↓", color: "cyan" }),
          React.createElement(MiniStatCard, { title: "Batt Out", value: currentData.battery_discharge, icon: "🔋↑", color: "cyan" }),
          React.createElement(MiniStatCard, { title: "Grid In", value: currentData.grid_import, icon: "⬇️", color: "blue" }),
          React.createElement(MiniStatCard, { title: "Grid Out", value: currentData.grid_export, icon: "⬆️", color: "green" })
        ),

        React.createElement('div', { className: "mt-4 grid grid-cols-2 gap-2 max-w-md" },
          React.createElement(BatteryCard, { title: "SOC INV", value: currentData.soc_inv }),
          React.createElement(BatteryCard, { title: "SOC BMS", value: currentData.soc_bms })
        )
      ),

      // 底部信息
      React.createElement('div', { className: "text-center text-gray-500 text-sm" },
        'Growatt Solar Monitor - ASP.NET Core'
      )
    )
  );
}

// 渲染应用
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(App));
