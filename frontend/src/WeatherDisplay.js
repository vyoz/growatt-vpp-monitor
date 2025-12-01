import React, { useState, useEffect } from 'react';

const WeatherDisplay = ({ latitude: propLat, longitude: propLon }) => {
  const [weather, setWeather] = useState(null);
  const [loading, setLoading] = useState(true);
  const [coords, setCoords] = useState({ lat: propLat, lon: propLon });

  // 获取用户位置
  useEffect(() => {
    if (propLat && propLon) {
      setCoords({ lat: propLat, lon: propLon });
      return;
    }

    const cachedLat = localStorage.getItem('userLatitude');
    const cachedLon = localStorage.getItem('userLongitude');
    
    if (cachedLat && cachedLon) {
      console.log('Using cached location');
      setCoords({ lat: parseFloat(cachedLat), lon: parseFloat(cachedLon) });
      return;
    }

    if (navigator.geolocation) {
      console.log('Requesting user location...');
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lon = position.coords.longitude;
          console.log('Location obtained:', { lat, lon });
          
          setCoords({ lat, lon });
          localStorage.setItem('userLatitude', lat.toString());
          localStorage.setItem('userLongitude', lon.toString());
        },
        (error) => {
          console.warn('Geolocation error, weather display disabled:', error);
          setLoading(false);
        }
      );
    } else {
      console.warn('Geolocation not supported, weather display disabled');
      setLoading(false);
    }
  }, [propLat, propLon]);

  const fetchWeather = async () => {
    if (!coords.lat || !coords.lon) {
      return;
    }

    try {
      const cached = localStorage.getItem('weatherData');
      const cacheTime = localStorage.getItem('weatherCacheTime');
      
      const now = Date.now();
      const CACHE_DURATION = 60 * 60 * 1000; // 1小时

      if (cached && cacheTime && (now - parseInt(cacheTime)) < CACHE_DURATION) {
        const cachedData = JSON.parse(cached);
        const source = cachedData.source === 'weatherapi' ? 'WeatherAPI.com' : 'Open-Meteo';
        console.log(`Using cached weather data (source: ${source})`);
        setWeather(cachedData);
        setLoading(false);
        return;
      }

      const apiKey = process.env.REACT_APP_WEATHER_API_KEY;
      
      console.log('=== Weather API Debug ===');
      console.log('API Key configured:', apiKey ? `Yes (${apiKey.substring(0, 8)}...)` : 'No');
      console.log('Will use:', apiKey ? 'WeatherAPI.com' : 'Open-Meteo (fallback)');
      console.log('========================');
      
      let weatherData;
      
      if (apiKey) {
        console.log('Fetching weather from WeatherAPI.com for:', coords);
        const response = await fetch(
          `https://api.weatherapi.com/v1/current.json?key=${apiKey}&q=${coords.lat},${coords.lon}&aqi=no`
        );
        
        if (!response.ok) {
          throw new Error('WeatherAPI request failed');
        }

        const data = await response.json();
        
        weatherData = {
          temperature: Math.round(data.current.temp_c),
          weatherCode: data.current.condition.code,
          weatherText: data.current.condition.text,
          source: 'weatherapi',
          timestamp: now
        };
      } else {
        console.log('Fetching weather from Open-Meteo (fallback) for:', coords);
        const response = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,weather_code&timezone=auto`
        );
        
        if (!response.ok) {
          throw new Error('Open-Meteo API request failed');
        }

        const data = await response.json();
        
        weatherData = {
          temperature: Math.round(data.current.temperature_2m),
          weatherCode: data.current.weather_code,
          source: 'openmeteo',
          timestamp: now
        };
      }

      localStorage.setItem('weatherData', JSON.stringify(weatherData));
      localStorage.setItem('weatherCacheTime', now.toString());

      setWeather(weatherData);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching weather:', error);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWeather();
    const interval = setInterval(() => {
      fetchWeather();
    }, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [coords]);

  if (loading) {
    return null;
  }

  if (!weather || !coords.lat || !coords.lon) {
    return null;
  }

  const getWeatherEmoji = () => {
    const code = weather.weatherCode;
    const source = weather.source;
    
    if (source === 'weatherapi') {
      if (code === 1000) return '☀️';
      if ([1003, 1006, 1009].includes(code)) return '☁️';
      if ([1030, 1135, 1147].includes(code)) return '🌫️';
      if ([1063, 1150, 1153, 1168, 1171, 1180, 1183, 1198, 1240].includes(code)) return '🌦️';
      if ([1186, 1189, 1192, 1195, 1201, 1243, 1246].includes(code)) return '🌧️';
      if ([1066, 1069, 1072, 1114, 1117, 1204, 1207, 1210, 1213, 1216, 1219, 1222, 1225, 1237, 1249, 1252, 1255, 1258, 1261, 1264].includes(code)) return '❄️';
      if ([1087, 1273, 1276, 1279, 1282].includes(code)) return '⛈️';
    } else {
      if (code === 0 || code === 1) return '☀️';
      if (code >= 2 && code <= 3) return '☁️';
      if (code >= 45 && code <= 48) return '🌫️';
      if (code >= 51 && code <= 55) return '🌦️';
      if (code >= 61 && code <= 82) return '🌧️';
      if (code >= 71 && code <= 86) return '❄️';
      if (code >= 95) return '⛈️';
    }
    
    return '☁️';
  };

  const getWeatherDesc = () => {
    const code = weather.weatherCode;
    const source = weather.source;
    
    if (source === 'weatherapi') {
      if (code === 1000) return '晴';
      if ([1003, 1006, 1009].includes(code)) return '云';
      if ([1030, 1135, 1147].includes(code)) return '雾';
      if ([1063, 1150, 1153, 1168, 1171, 1180, 1183, 1198, 1240].includes(code)) return '小雨';
      if ([1186, 1189, 1192, 1195, 1201, 1243, 1246].includes(code)) return '雨';
      if ([1066, 1069, 1072, 1114, 1117, 1204, 1207, 1210, 1213, 1216, 1219, 1222, 1225, 1237, 1249, 1252, 1255, 1258, 1261, 1264].includes(code)) return '雪';
      if ([1087, 1273, 1276, 1279, 1282].includes(code)) return '雷暴';
    } else {
      if (code === 0 || code === 1) return '晴';
      if (code >= 2 && code <= 3) return '云';
      if (code >= 45 && code <= 48) return '雾';
      if (code >= 51 && code <= 55) return '小雨';
      if (code >= 61 && code <= 65) return '雨';
      if (code >= 71 && code <= 77) return '雪';
      if (code >= 80 && code <= 82) return '阵雨';
      if (code >= 85 && code <= 86) return '阵雪';
      if (code >= 95) return '雷暴';
    }
    
    return '云';
  };

  return (
    <div 
      className="absolute top-2 right-2 rounded-lg px-2.5 py-1.5" 
      style={{ zIndex: 10 }}
    >
      <div className="flex items-center gap-2">
        {/* Emoji 天气图标 */}
        <div className="text-2xl">
          {getWeatherEmoji()}
        </div>

        {/* 天气信息 */}
        <div className="flex flex-col">
          <div className="text-base font-bold text-white leading-tight">
            {weather.temperature}°C
          </div>
          <div className="text-xs text-gray-400 leading-tight">
            {getWeatherDesc()}
          </div>
        </div>
      </div>
    </div>
  );
};

export default WeatherDisplay;
