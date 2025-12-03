import React, { useState, useEffect, useRef, useCallback } from 'react';

/**
 * DailyEarnings Component
 * 
 * 显示今日ZeroHero VPP预估收益，带财神爷动画效果
 * 
 * 智能刷新策略：
 * - 活跃时段（6am-8pm 或 有export）：每60秒刷新
 * - 非活跃时段：每小时刷新
 * 
 * 动画：财神爷持续跳动，金币持续下落（纯CSS动画，无需用户交互）
 * 
 * Props:
 * - apiBase: API服务器地址
 */
const DailyEarnings = ({ apiBase }) => {
  const [earnings, setEarnings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const containerRef = useRef(null);
  const prevEarningsRef = useRef(0);
  const intervalRef = useRef(null);

  // 判断是否在活跃时段
  const isActiveHours = useCallback(() => {
    const hour = new Date().getHours();
    // 6am - 8pm 是活跃时段（太阳能发电 + ZEROHERO窗口）
    return hour >= 6 && hour < 20;
  }, []);

  // 获取当前应该使用的刷新间隔
  const getRefreshInterval = useCallback(() => {
    if (isActiveHours()) {
      return 60 * 1000;  // 活跃时段：1分钟
    }
    return 60 * 60 * 1000;  // 非活跃时段：1小时
  }, [isActiveHours]);

  // 获取收益数据
  const fetchEarnings = useCallback(async () => {
    try {
      const response = await fetch(`${apiBase}/api/earnings/today`);
      if (!response.ok) throw new Error('获取收益数据失败');
      const data = await response.json();
      
      prevEarningsRef.current = data.total_earnings;
      
      setEarnings(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  // 设置智能刷新定时器
  const setupInterval = useCallback(() => {
    // 清除旧的定时器
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    
    const interval = getRefreshInterval();
    intervalRef.current = setInterval(() => {
      fetchEarnings();
      // 每次刷新后重新评估间隔（处理跨时段情况）
      setupInterval();
    }, interval);
  }, [fetchEarnings, getRefreshInterval]);

  // 初始加载和定时刷新
  useEffect(() => {
    fetchEarnings();
    setupInterval();
    
    // 每小时检查一次是否需要切换刷新频率
    const hourlyCheck = setInterval(() => {
      setupInterval();
    }, 60 * 60 * 1000);
    
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      clearInterval(hourlyCheck);
    };
  }, [fetchEarnings, setupInterval]);

  // 格式化金额显示
  const formatCurrency = (value) => {
    if (value === null || value === undefined) return '$0.00';
    return `$${value.toFixed(2)}`;
  };

  // ZEROHERO Day状态显示
  const renderZeroHeroStatus = () => {
    if (!earnings?.zerohero_day) return null;
    
    const { status, credit } = earnings.zerohero_day;
    
    if (status === 'pending') {
      return (
        <div className="flex items-center gap-1 text-yellow-400 text-xs">
          <span className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse"></span>
          <span>ZeroHero待定</span>
        </div>
      );
    } else if (status === 'qualified') {
      return (
        <div className="flex items-center gap-1 text-green-400 text-xs">
          <span>✓</span>
          <span>ZeroHero +${credit.toFixed(2)}</span>
        </div>
      );
    } else {
      return (
        <div className="flex items-center gap-1 text-red-400 text-xs">
          <span>✗</span>
          <span>ZeroHero未达标</span>
        </div>
      );
    }
  };

  // 生成持续下落的金币（使用CSS动画循环）
  const renderCoins = () => {
    const coins = [];
    const emojis = ['🪙', '💰', '✨', '🧧', '💵'];
    
    // 生成8个金币，错开时间循环下落
    for (let i = 0; i < 8; i++) {
      const emoji = emojis[i % emojis.length];
      const left = 10 + (i * 11) % 80;  // 分散位置
      const delay = i * 0.4;  // 错开启动时间
      const duration = 2.5 + (i % 3) * 0.5;  // 不同速度
      
      coins.push(
        <span
          key={i}
          className="coin-continuous"
          style={{
            left: `${left}%`,
            animationDelay: `${delay}s`,
            animationDuration: `${duration}s`,
          }}
        >
          {emoji}
        </span>
      );
    }
    return coins;
  };

  return (
    <div 
      ref={containerRef}
      className="relative h-full flex flex-col items-center justify-center overflow-hidden"
      style={{
        background: 'linear-gradient(180deg, rgba(139,0,0,0.3) 0%, rgba(45,24,16,0.5) 50%, rgba(26,5,5,0.4) 100%)',
      }}
    >
      {/* CSS动画样式 */}
      <style>{`
        @keyframes bounce-continuous {
          0%, 100% { transform: translateY(0) rotate(-2deg); }
          50% { transform: translateY(-6px) rotate(2deg); }
        }
        
        @keyframes glow-pulse {
          0%, 100% { filter: drop-shadow(0 0 8px rgba(255, 215, 0, 0.4)); }
          50% { filter: drop-shadow(0 0 20px rgba(255, 215, 0, 0.7)); }
        }
        
        @keyframes coin-fall-continuous {
          0% { 
            opacity: 0; 
            transform: translateY(-20px) rotate(0deg); 
          }
          10% {
            opacity: 1;
          }
          90% {
            opacity: 1;
          }
          100% { 
            opacity: 0; 
            transform: translateY(250px) rotate(360deg); 
          }
        }
        
        @keyframes shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        
        .coin-continuous {
          position: absolute;
          top: 0;
          font-size: 16px;
          animation: coin-fall-continuous ease-in-out infinite;
          pointer-events: none;
          z-index: 10;
        }
        
        .caishen-animated {
          animation: bounce-continuous 1.2s ease-in-out infinite, 
                     glow-pulse 2s ease-in-out infinite;
        }
        
        .shimmer-text {
          background: linear-gradient(
            90deg, 
            #ffd700 0%, 
            #fff 25%, 
            #ffd700 50%, 
            #fff 75%, 
            #ffd700 100%
          );
          background-size: 200% auto;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: shimmer 3s linear infinite;
        }
      `}</style>
      
      {/* 持续下落的金币 */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {renderCoins()}
      </div>
      
      {/* 标题 */}
      <div className="text-center mb-1 z-20">
        <span className="text-xs text-yellow-500/80 tracking-wider">今日预估收益</span>
      </div>
      
      {/* 财神爷图片 - 持续动画 */}
      <div className="relative z-10 caishen-animated">
        <img 
          src="/caishen2_transparent.png" 
          alt="财神爷"
          className="w-24 h-auto"
        />
      </div>
      
      {/* 收益金额 */}
      <div className="text-center mt-2 z-20">
        {loading ? (
          <div className="text-2xl text-yellow-400">...</div>
        ) : error ? (
          <div className="text-sm text-red-400">{error}</div>
        ) : (
          <>
            <div className={`text-3xl font-bold ${earnings?.total_earnings > 0 ? 'shimmer-text' : 'text-yellow-400'}`}>
              {formatCurrency(earnings?.total_earnings)}
            </div>
            
            {/* ZEROHERO状态 */}
            <div className="mt-1">
              {renderZeroHeroStatus()}
            </div>
            
            {/* Export信息 */}
            <div className="text-xs text-gray-400 mt-1">
              Export: {earnings?.total_export_kwh?.toFixed(2) || 0} kWh
            </div>
          </>
        )}
      </div>
      
      {/* 免责声明 */}
      <div className="absolute bottom-1 left-0 right-0 text-center z-20">
        <p className="text-[9px] text-gray-500 px-2">
          💡 预估收益仅供参考，以电力公司账单为准
        </p>
      </div>
    </div>
  );
};

export default DailyEarnings;
