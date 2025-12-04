import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';

// ============================================================
// 模块容器组件
// ============================================================
const SectionContainer = ({ children, className = "" }) => (
  <div className={`bg-gray-900/50 rounded-2xl p-4 border border-gray-800 ${className}`}>
    {children}
  </div>
);

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
// 工具函数
// ============================================================
const formatDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// 时间段选项（小时）
const TIME_RANGES = [
  { value: 1, label: '1小时' },
  { value: 3, label: '3小时' },
  { value: 6, label: '6小时' },
  { value: 12, label: '12小时' },
  { value: 24, label: '24小时' },
];

// 采样间隔选项（分钟）
const SAMPLE_INTERVALS = [
  { value: 1, label: '1分钟' },
  { value: 2, label: '2分钟' },
  { value: 5, label: '5分钟' },
  { value: 10, label: '10分钟' },
];

// ============================================================
// 模块三：功率曲线（自动获取最近24小时数据，可选采样间隔）
// ============================================================
const PowerChart = ({ apiBase }) => {
  // 原始数据
  const [rawData, setRawData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);
  
  // 采样间隔（分钟）
  const [sampleInterval, setSampleInterval] = useState(5);
  
  // 显示时间范围（小时）
  const [timeRange, setTimeRange] = useState(1);
  
  // 动态计算显示的数据点数：时间范围(小时) * 60 / 采样间隔(分钟)
  const visiblePoints = Math.floor(timeRange * 60 / sampleInterval);
  
  // 动态计算 MAX_POINTS：24小时 = 1440分钟
  const MAX_POINTS = Math.floor(1440 / sampleInterval);
  const MIN_POINTS = 20;
  
  // 滚动相关
  const SCROLL_THRESHOLD = 50; // 超过50个点启用滚动
  const scrollContainerRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  
  // 鼠标/触摸拖动处理
  const handleMouseDown = (e) => {
    if (!scrollContainerRef.current) return;
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

  // 获取最近24小时的数据
  const fetchData = useCallback(async () => {
    try {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const todayStr = formatDate(now);
      const yesterdayStr = formatDate(yesterday);
      
      const response = await fetch(`${apiBase}/api/history/range?start_date=${yesterdayStr}&end_date=${todayStr}&limit=5000`);
      if (!response.ok) throw new Error('获取数据失败');
      const result = await response.json();
      
      if (result.data && result.data.length > 0) {
        // 只保留最近24小时的数据
        const cutoffTime = now.getTime() - 24 * 60 * 60 * 1000;
        const recentData = result.data.filter(d => new Date(d.timestamp).getTime() >= cutoffTime);
        setRawData(recentData);
        setLastUpdate(now);
      }
    } catch (err) {
      console.error('Failed to fetch power chart data:', err);
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  // 初始加载 + 每5分钟刷新
  useEffect(() => {
    fetchData();
    
    // 计算到下一个采样间隔整点的时间
    const now = new Date();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    const msToNextInterval = ((sampleInterval - (minutes % sampleInterval)) * 60 - seconds) * 1000;
    
    // 先等到下一个整点，然后按采样间隔刷新
    const timeout = setTimeout(() => {
      fetchData();
      const interval = setInterval(fetchData, sampleInterval * 60 * 1000);
      return () => clearInterval(interval);
    }, msToNextInterval);
    
    return () => clearTimeout(timeout);
  }, [fetchData, sampleInterval]);

  // 按选定间隔采样处理
  const sampledData = useMemo(() => {
    if (!rawData || rawData.length === 0) return [];
    
    // 按N分钟时间桶聚合
    const buckets = new Map();
    
    rawData.forEach(d => {
      const date = new Date(d.timestamp);
      const hour = date.getHours();
      const minute = date.getMinutes();
      
      // 向下取整到采样间隔
      const roundedMinute = Math.floor(minute / sampleInterval) * sampleInterval;
      
      // 生成桶的key：包含日期和时间
      const bucketKey = `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(roundedMinute).padStart(2, '0')}`;
      
      // 每个时间桶只取第一个数据点
      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, {
          time: bucketKey,
          timestamp: date.getTime(),
          solar: d.solar,
          load: d.load,
          battery: d.battery_net,
          grid: d.grid_export - d.grid_import  // 正值=卖电，负值=买电
        });
      }
    });
    
    // 转换为数组并按时间排序
    const result = Array.from(buckets.values());
    result.sort((a, b) => a.timestamp - b.timestamp);
    return result;
  }, [rawData, sampleInterval]);

  // 根据缩放级别显示的数据（从最新数据往前取）
  const displayData = useMemo(() => {
    if (sampledData.length === 0) return [];
    if (sampledData.length <= visiblePoints) {
      return sampledData;
    }
    // 显示最新的 N 个数据点
    return sampledData.slice(-visiblePoints);
  }, [sampledData, visiblePoints]);

  // 是否启用滚动模式：实际显示的数据点超过50个
  const needsScroll = displayData.length > SCROLL_THRESHOLD;
  
  // 滚动模式下的图表宽度：根据数据点数量动态调整
  // 点少时宽松，点多时紧凑
  const getChartWidth = () => {
    const points = displayData.length;
    if (points <= 100) return points * 12;      // 少量点：12px/点
    if (points <= 200) return points * 8;       // 中等：8px/点
    if (points <= 400) return points * 5;       // 较多：5px/点
    return points * 3;                          // 大量：3px/点
  };
  const chartWidth = needsScroll ? Math.max(getChartWidth(), 800) : null;
  
  // 数据变化时滚动到最右端（最新数据）
  useEffect(() => {
    if (needsScroll && scrollContainerRef.current) {
      setTimeout(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollLeft = scrollContainerRef.current.scrollWidth;
        }
      }, 100);
    }
  }, [displayData, needsScroll]);

  // 计算当前显示的时间范围
  const getTimeRangeText = () => {
    if (displayData.length === 0) return '';
    const firstTime = displayData[0]?.time || '';
    const lastTime = displayData[displayData.length - 1]?.time || '';
    // 只取时间部分
    const firstHM = firstTime.split(' ')[1] || firstTime;
    const lastHM = lastTime.split(' ')[1] || lastTime;
    return `${firstHM} - ${lastHM}`;
  };

  return (
    <SectionContainer>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span className="text-xl">📈</span>
            <span>功率曲线</span>
          </h2>
          <p className="text-gray-400 text-xs">
            {getTimeRangeText()}
            {lastUpdate ? ` | 更新: ${lastUpdate.toLocaleTimeString('zh-CN')}` : ''}
          </p>
        </div>
        
        {/* 采样间隔选择器 */}
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-xs">采样:</span>
          <select
            value={sampleInterval}
            onChange={(e) => setSampleInterval(Number(e.target.value))}
            className="bg-gray-700 text-white text-xs px-2 py-1 rounded border border-gray-600 focus:border-blue-500 focus:outline-none cursor-pointer"
          >
            {SAMPLE_INTERVALS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="text-gray-400 text-center py-12">加载中...</div>
      ) : sampledData.length === 0 ? (
        <div className="text-gray-400 text-center py-12">暂无数据</div>
      ) : (
        <div className="bg-gray-800/50 rounded-xl p-4">
          {/* 时间范围按钮 */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="text-gray-400 text-xs">时间范围:</span>
            {TIME_RANGES.map(opt => (
              <button
                key={opt.value}
                onClick={() => setTimeRange(opt.value)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  timeRange === opt.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {opt.label}
              </button>
            ))}
            <span className="text-gray-500 text-xs ml-2">
              ({displayData.length} 点)
            </span>
          </div>
          
          {/* 滚动提示 */}
          {needsScroll && (
            <div className="text-gray-400 text-xs mb-2 flex items-center gap-1">
              <span>👆</span>
              <span>左右拖动查看更多数据</span>
            </div>
          )}
          
          {/* 图表容器 */}
          {needsScroll ? (
            // 滚动模式：可拖动查看
            <div 
              ref={scrollContainerRef}
              className="overflow-x-auto cursor-grab active:cursor-grabbing"
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
              <LineChart 
                data={displayData} 
                width={chartWidth} 
                height={350}
                margin={{ top: 10, right: 30, left: 40, bottom: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <ReferenceLine y={0} stroke="#9CA3AF" strokeWidth={1} />
                <XAxis 
                  dataKey="time" 
                  stroke="#9CA3AF" 
                  fontSize={10}
                  interval={Math.floor(displayData.length / 20)}
                  tickFormatter={(value) => {
                    const match = value.match(/(\d{1,2}:\d{2})/);
                    return match ? match[1] : value;
                  }}
                />
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
            </div>
          ) : (
            // 正常模式：响应式宽度
            <ResponsiveContainer width="100%" height={350}>
              <LineChart data={displayData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <ReferenceLine y={0} stroke="#9CA3AF" strokeWidth={1} />
                <XAxis 
                  dataKey="time" 
                  stroke="#9CA3AF" 
                  fontSize={10}
                  interval="preserveStartEnd"
                  tickFormatter={(value) => {
                    const match = value.match(/(\d{1,2}:\d{2})/);
                    return match ? match[1] : value;
                  }}
                />
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
          )}
        </div>
      )}
    </SectionContainer>
  );
};

export default PowerChart;
