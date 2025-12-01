using Microsoft.AspNetCore.Mvc;
using GrowattMonitor.Models;
using GrowattMonitor.Services;

namespace GrowattMonitor.Controllers
{
    [ApiController]
    [Route("api")]
    public class GrowattController : ControllerBase
    {
        private readonly IDataService _dataService;
        private readonly IGrowattWebService _webService;
        private readonly ILogger<GrowattController> _logger;

        public GrowattController(
            IDataService dataService, 
            IGrowattWebService webService,
            ILogger<GrowattController> logger)
        {
            _dataService = dataService;
            _webService = webService;
            _logger = logger;
        }

        /// <summary>
        /// Login with username and password
        /// </summary>
        [HttpPost("auth/login")]
        public async Task<IActionResult> Login([FromBody] LoginRequest request)
        {
            try
            {
                if (string.IsNullOrEmpty(request.Username) || string.IsNullOrEmpty(request.Password))
                {
                    return BadRequest(new { success = false, message = "用户名和密码不能为空" });
                }

                var success = await _webService.LoginAsync(request.Username, request.Password);
                
                if (success)
                {
                    // Store login state in session cookie
                    HttpContext.Session.SetString("LoggedIn", "true");
                    if (request.RememberMe)
                    {
                        HttpContext.Session.SetString("RememberMe", "true");
                    }
                    
                    return Ok(new { success = true, message = "登录成功" });
                }
                
                return Unauthorized(new { success = false, message = "用户名或密码错误" });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Login failed");
                return StatusCode(500, new { success = false, message = "登录失败: " + ex.Message });
            }
        }

        /// <summary>
        /// Logout
        /// </summary>
        [HttpPost("auth/logout")]
        public IActionResult Logout()
        {
            try
            {
                _webService.Logout();
                HttpContext.Session.Clear();
                return Ok(new { success = true, message = "已退出登录" });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Logout failed");
                return StatusCode(500, new { success = false, message = "退出登录失败: " + ex.Message });
            }
        }

        /// <summary>
        /// Check login status
        /// </summary>
        [HttpGet("auth/status")]
        public IActionResult GetAuthStatus()
        {
            var isLoggedIn = _webService.IsLoggedIn();
            return Ok(new { logged_in = isLoggedIn });
        }

        /// <summary>
        /// Get current system status
        /// </summary>
        [HttpGet("status")]
        public IActionResult GetStatus()
        {
            var currentData = _dataService.GetCurrentData();
            return Ok(new
            {
                connected = currentData.Connected,
                timestamp = currentData.Timestamp
            });
        }

        /// <summary>
        /// Get current real-time data
        /// </summary>
        [HttpGet("current")]
        public async Task<IActionResult> GetCurrent()
        {
            var data = _dataService.GetCurrentData();
            
            // If no data or data is too old (more than 5 minutes), fetch fresh data
            if (!data.Connected || data.Timestamp == null || 
                (DateTime.Now - data.Timestamp.Value).TotalMinutes > 5)
            {
                try
                {
                    var webData = await _webService.GetRealtimeDataAsync();
                    if (webData != null)
                    {
                        data = new CurrentData
                        {
                            Timestamp = webData.Timestamp,
                            Solar = webData.Solar,
                            Load = webData.Load,
                            GridExport = webData.GridExport,
                            GridImport = webData.GridImport,
                            BatteryCharge = webData.BatteryCharge,
                            BatteryDischarge = webData.BatteryDischarge,
                            BatteryNet = webData.BatteryCharge - webData.BatteryDischarge,
                            SocInv = (int)webData.SocBms,
                            SocBms = webData.SocBms,
                            Connected = webData.Connected
                        };
                        _dataService.UpdateCurrentData(data);
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to fetch fresh data");
                }
            }
            
            return Ok(new
            {
                timestamp = data.Timestamp?.ToString("o"),
                solar = data.Solar,
                battery_discharge = data.BatteryDischarge,
                grid_import = data.GridImport,
                battery_charge = data.BatteryCharge,
                load = data.Load,
                grid_export = data.GridExport,
                battery_net = data.BatteryNet,
                soc_inv = data.SocInv,
                soc_bms = data.SocBms,
                connected = data.Connected
            });
        }

        /// <summary>
        /// Get historical data with optional filtering
        /// </summary>
        [HttpGet("history")]
        public IActionResult GetHistory([FromQuery] int limit = 100, [FromQuery] int? minutes = null)
        {
            var data = _dataService.GetHistoricalData(limit, minutes);
            return Ok(new
            {
                count = data.Count,
                data = data.Select(d => new
                {
                    timestamp = d.Timestamp,
                    solar = d.Solar,
                    load = d.Load,
                    grid_export = d.GridExport,
                    grid_import = d.GridImport,
                    battery_charge = d.BatteryCharge,
                    battery_discharge = d.BatteryDischarge,
                    battery_net = d.BatteryNet,
                    soc_inv = d.SocInv,
                    soc_bms = d.SocBms
                })
            });
        }

        /// <summary>
        /// Get historical data for a date range from CSV logs
        /// </summary>
        [HttpGet("history/range")]
        public async Task<IActionResult> GetHistoryRange(
            [FromQuery] string start_date,
            [FromQuery] string? end_date = null,
            [FromQuery] int limit = 500)
        {
            if (string.IsNullOrEmpty(start_date))
            {
                return BadRequest(new { error = "start_date is required (yyyy-MM-dd)" });
            }

            if (!DateTime.TryParse(start_date, out var startDate))
            {
                return BadRequest(new { error = "Invalid date format. Use yyyy-MM-dd" });
            }

            var endDate = string.IsNullOrEmpty(end_date) ? startDate : DateTime.Parse(end_date);

            if (endDate < startDate)
            {
                return BadRequest(new { error = "end_date cannot be before start_date" });
            }

            var data = await _dataService.GetHistoryRangeAsync(startDate, endDate, limit);

            return Ok(new
            {
                start_date = startDate.ToString("yyyy-MM-dd"),
                end_date = endDate.ToString("yyyy-MM-dd"),
                count = data.Count,
                data = data.Select(d => new
                {
                    timestamp = d.Timestamp,
                    solar = d.Solar,
                    load = d.Load,
                    grid_export = d.GridExport,
                    grid_import = d.GridImport,
                    battery_charge = d.BatteryCharge,
                    battery_discharge = d.BatteryDischarge,
                    battery_net = d.BatteryNet,
                    soc_inv = d.SocInv,
                    soc_bms = d.SocBms
                }),
                source = "csv"
            });
        }

        /// <summary>
        /// Calculate daily totals from historical data
        /// </summary>
        [HttpGet("daily")]
        public async Task<IActionResult> GetDaily([FromQuery] string? date = null)
        {
            var targetDate = string.IsNullOrEmpty(date) ? DateTime.Today : DateTime.Parse(date);
            var dailyData = await _dataService.GetDailyDataAsync(targetDate);

            return Ok(new
            {
                date = dailyData.Date,
                solar_kwh = dailyData.SolarKwh,
                load_kwh = dailyData.LoadKwh,
                grid_export_kwh = dailyData.GridExportKwh,
                grid_import_kwh = dailyData.GridImportKwh,
                battery_charge_kwh = dailyData.BatteryChargeKwh,
                battery_discharge_kwh = dailyData.BatteryDischargeKwh,
                count = dailyData.Count
            });
        }

        /// <summary>
        /// Get daily totals for a date range
        /// </summary>
        [HttpGet("daily/range")]
        public async Task<IActionResult> GetDailyRange(
            [FromQuery] string start_date,
            [FromQuery] string? end_date = null)
        {
            if (string.IsNullOrEmpty(start_date))
            {
                return BadRequest(new { error = "start_date is required (yyyy-MM-dd)" });
            }

            if (!DateTime.TryParse(start_date, out var startDate))
            {
                return BadRequest(new { error = "Invalid date format. Use yyyy-MM-dd" });
            }

            var endDate = string.IsNullOrEmpty(end_date) ? DateTime.Today : DateTime.Parse(end_date);

            if (endDate < startDate)
            {
                return BadRequest(new { error = "end_date cannot be before start_date" });
            }

            if ((endDate - startDate).Days > 90)
            {
                return BadRequest(new { error = "Date range cannot exceed 90 days" });
            }

            var results = await _dataService.GetDailyRangeAsync(startDate, endDate);

            return Ok(new
            {
                start_date = startDate.ToString("yyyy-MM-dd"),
                end_date = endDate.ToString("yyyy-MM-dd"),
                count = results.Count,
                data = results.Select(d => new
                {
                    date = d.Date,
                    solar_kwh = d.SolarKwh,
                    load_kwh = d.LoadKwh,
                    grid_export_kwh = d.GridExportKwh,
                    grid_import_kwh = d.GridImportKwh,
                    battery_charge_kwh = d.BatteryChargeKwh,
                    battery_discharge_kwh = d.BatteryDischargeKwh,
                    count = d.Count
                })
            });
        }

        /// <summary>
        /// Get today's cumulative energy totals from Growatt Web API
        /// </summary>
        [HttpGet("totals")]
        public async Task<IActionResult> GetTotals([FromQuery] string? date = null)
        {
            DateTime? targetDate = null;
            if (!string.IsNullOrEmpty(date))
            {
                if (DateTime.TryParse(date, out var parsedDate))
                {
                    targetDate = parsedDate;
                }
                else
                {
                    return BadRequest(new { error = "Invalid date format. Use yyyy-MM-dd" });
                }
            }

            // For historical dates, check if we have cached data first
            if (targetDate.HasValue && targetDate.Value.Date != DateTime.Now.Date)
            {
                bool hasCachedData = await _dataService.HasCachedDataForDateAsync(targetDate.Value);
                
                if (hasCachedData)
                {
                    // Use cached CSV data
                    _logger.LogInformation("Using cached data for {Date}", targetDate.Value.ToString("yyyy-MM-dd"));
                    var cachedDaily = await _dataService.GetDailyDataAsync(targetDate.Value);
                    
                    // Get data quality info
                    var historyData = await _dataService.GetHistoryRangeAsync(targetDate.Value, targetDate.Value, 500);
                    var hoursCovered = historyData.Select(d => DateTime.Parse(d.Timestamp).Hour).Distinct().Count();
                    var dataPoints = historyData.Count;
                    var isComplete = hoursCovered >= 20; // Consider complete if covers at least 20 hours
                    
                    return Ok(new
                    {
                        date = targetDate.Value.ToString("yyyy-MM-dd"),
                        source = "cache",
                        cache_info = new
                        {
                            data_points = dataPoints,
                            hours_covered = hoursCovered,
                            is_complete = isComplete,
                            message = isComplete ? "Complete daily data" : $"Partial data ({hoursCovered}/24 hours)"
                        },
                        today = new
                        {
                            solar_kwh = Math.Round(cachedDaily.SolarKwh, 1),
                            load_kwh = Math.Round(cachedDaily.LoadKwh, 1),
                            grid_export_kwh = Math.Round(cachedDaily.GridExportKwh, 1),
                            grid_import_kwh = Math.Round(cachedDaily.GridImportKwh, 1),
                            battery_charge_kwh = Math.Round(cachedDaily.BatteryChargeKwh, 1),
                            battery_discharge_kwh = Math.Round(cachedDaily.BatteryDischargeKwh, 1),
                            self_use_kwh = 0.0
                        },
                        lifetime = new
                        {
                            solar_kwh = 0.0,
                            load_kwh = 0.0,
                            grid_export_kwh = 0.0,
                            grid_import_kwh = 0.0,
                            battery_discharge_kwh = 0.0,
                            self_use_kwh = 0.0
                        }
                    });
                }

                // No cached data, fetch from Web API and save
                _logger.LogInformation("Fetching data from Web API for {Date}", targetDate.Value.ToString("yyyy-MM-dd"));
                var chartData = await _dataService.GetEnergyDayChartAsync(targetDate);
                var batData = await _dataService.GetTotalDataAsync(targetDate);

                if (chartData == null)
                {
                    return StatusCode(503, new { error = "Unable to fetch energy day chart from Growatt API" });
                }

                // Save to cache for future use
                await _dataService.SaveHistoricalDayDataAsync(targetDate.Value, chartData);

                // Calculate totals by summing the 288 5-minute data points
                // Each data point represents instantaneous power in kW
                // Sum and multiply by (5/60) hours to get kWh
                var timeInterval = 5.0 / 60.0; // 5 minutes in hours

                double solarKwh = (chartData.Solar?.Where(v => v.HasValue).Sum(v => v.Value) ?? 0) * timeInterval;
                double loadKwh = (chartData.Load?.Where(v => v.HasValue).Sum(v => v.Value) ?? 0) * timeInterval;
                double gridExportKwh = (chartData.GridExport?.Where(v => v.HasValue).Sum(v => v.Value) ?? 0) * timeInterval;
                double gridImportKwh = (chartData.GridImport?.Where(v => v.HasValue).Sum(v => v.Value) ?? 0) * timeInterval;
                double battChargeKwh = (chartData.BatteryCharge?.Where(v => v.HasValue).Sum(v => v.Value) ?? 0) * timeInterval;
                double battDischargeKwh = (chartData.BatteryDischarge?.Where(v => v.HasValue).Sum(v => v.Value) ?? 0) * timeInterval;
                double selfUseKwh = (chartData.SelfUse?.Where(v => v.HasValue).Sum(v => v.Value) ?? 0) * timeInterval;

                return Ok(new
                {
                    date = targetDate.Value.ToString("yyyy-MM-dd"),
                    source = "api",
                    today = new
                    {
                        solar_kwh = Math.Round(solarKwh, 1),
                        load_kwh = Math.Round(loadKwh, 1),
                        grid_export_kwh = Math.Round(gridExportKwh, 1),
                        grid_import_kwh = Math.Round(gridImportKwh, 1),
                        battery_charge_kwh = Math.Round(battChargeKwh, 1),
                        battery_discharge_kwh = Math.Round(battDischargeKwh, 1),
                        self_use_kwh = Math.Round(selfUseKwh, 1)
                    },
                    lifetime = new
                    {
                        solar_kwh = 0.0,
                        load_kwh = 0.0,
                        grid_export_kwh = 0.0,
                        grid_import_kwh = 0.0,
                        battery_discharge_kwh = 0.0,
                        self_use_kwh = 0.0
                    }
                });
            }

            // For today, use getMIXTotalData
            var totals = await _dataService.GetTotalDataAsync(targetDate);

            if (totals == null)
            {
                return StatusCode(503, new { error = "Unable to fetch totals from Growatt API" });
            }

            return Ok(new
            {
                date = (targetDate ?? DateTime.Now).ToString("yyyy-MM-dd"),
                source = "api",
                today = new
                {
                    solar_kwh = totals.SolarTodayKwh,
                    load_kwh = totals.LoadTodayKwh,
                    grid_export_kwh = totals.GridExportTodayKwh,
                    grid_import_kwh = totals.GridImportTodayKwh,
                    battery_charge_kwh = totals.BatteryChargeTodayKwh,
                    battery_discharge_kwh = totals.BatteryDischargeTodayKwh,
                    self_use_kwh = totals.SelfUseTodayKwh
                },
                lifetime = new
                {
                    solar_kwh = totals.SolarTotalKwh,
                    load_kwh = totals.LoadTotalKwh,
                    grid_export_kwh = totals.GridExportTotalKwh,
                    grid_import_kwh = totals.GridImportTotalKwh,
                    battery_discharge_kwh = totals.BatteryDischargeTotalKwh,
                    self_use_kwh = totals.SelfUseTotalKwh
                }
            });
        }

        /// <summary>
        /// Get hourly power chart data for today
        /// </summary>
        [HttpGet("chart/hourly")]
        public async Task<IActionResult> GetHourlyChart([FromQuery] string? date = null)
        {
            DateTime? targetDate = null;
            if (!string.IsNullOrEmpty(date))
            {
                if (DateTime.TryParse(date, out var parsedDate))
                {
                    targetDate = parsedDate;
                }
                else
                {
                    return BadRequest(new { error = "Invalid date format. Use yyyy-MM-dd" });
                }
            }

            // For historical dates, check cache first (it will fetch from API if not cached)
            // This ensures consistency with /api/totals endpoint
            if (targetDate.HasValue && targetDate.Value.Date != DateTime.Now.Date)
            {
                bool hasCachedData = await _dataService.HasCachedDataForDateAsync(targetDate.Value);
                if (!hasCachedData)
                {
                    // Fetch from API and cache (this will be done by the first call)
                    var fetchData = await _dataService.GetEnergyDayChartAsync(targetDate);
                    if (fetchData != null)
                    {
                        await _dataService.SaveHistoricalDayDataAsync(targetDate.Value, fetchData);
                    }
                }
            }

            var chartData = await _dataService.GetEnergyDayChartAsync(targetDate);

            if (chartData == null)
            {
                return StatusCode(503, new { error = "Unable to fetch chart data from Growatt API" });
            }

            // Aggregate 5-minute data into hourly averages (288 points -> 24 hours)
            var hours = new List<object>();
            var pointsPerHour = 12; // 5 minutes * 12 = 60 minutes

            for (int h = 0; h < 24; h++)
            {
                var startIdx = h * pointsPerHour;
                var endIdx = Math.Min(startIdx + pointsPerHour, 288);

                var hourData = new
                {
                    hour = h,
                    solar = AverageNonNull(chartData.Solar, startIdx, endIdx),
                    battery_charge = AverageNonNull(chartData.BatteryCharge, startIdx, endIdx),
                    battery_discharge = AverageNonNull(chartData.BatteryDischarge, startIdx, endIdx),
                    load = AverageNonNull(chartData.Load, startIdx, endIdx),
                    grid_export = AverageNonNull(chartData.GridExport, startIdx, endIdx),
                    grid_import = AverageNonNull(chartData.GridImport, startIdx, endIdx),
                    self_use = AverageNonNull(chartData.SelfUse, startIdx, endIdx)
                };

                hours.Add(hourData);
            }

            return Ok(new
            {
                date = (targetDate ?? DateTime.Now).ToString("yyyy-MM-dd"),
                hours = hours,
                data_points = 288,
                interval_minutes = 5
            });
        }

        private double AverageNonNull(List<double?> data, int startIdx, int endIdx)
        {
            var values = new List<double>();
            for (int i = startIdx; i < endIdx && i < data.Count; i++)
            {
                if (data[i].HasValue)
                    values.Add(data[i].Value);
            }
            return values.Any() ? values.Average() : 0;
        }

        /// <summary>
        /// Force refresh data from Growatt API (bypass cache)
        /// </summary>
        [HttpPost("totals/refresh")]
        public async Task<IActionResult> RefreshHistoricalData([FromQuery] string date)
        {
            if (string.IsNullOrEmpty(date))
            {
                return BadRequest(new { error = "Date parameter required. Use yyyy-MM-dd format" });
            }

            if (!DateTime.TryParse(date, out var targetDate))
            {
                return BadRequest(new { error = "Invalid date format. Use yyyy-MM-dd" });
            }

            if (targetDate.Date > DateTime.Now.Date)
            {
                return BadRequest(new { error = "Cannot refresh future dates" });
            }

            _logger.LogInformation("Force refreshing data for {Date}", targetDate.ToString("yyyy-MM-dd"));

            // Fetch from Web API
            var chartData = await _dataService.GetEnergyDayChartAsync(targetDate);
            var batData = await _dataService.GetTotalDataAsync(targetDate);

            if (chartData == null)
            {
                return StatusCode(503, new { error = "Unable to fetch energy day chart from Growatt API" });
            }

            // Save to cache (will overwrite existing data)
            var saved = await _dataService.SaveHistoricalDayDataAsync(targetDate, chartData);

            // Calculate totals
            var timeInterval = 5.0 / 60.0;
            double solarKwh = (chartData.Solar?.Where(v => v.HasValue).Sum(v => v.Value) ?? 0) * timeInterval;
            double loadKwh = (chartData.Load?.Where(v => v.HasValue).Sum(v => v.Value) ?? 0) * timeInterval;
            double gridExportKwh = (chartData.GridExport?.Where(v => v.HasValue).Sum(v => v.Value) ?? 0) * timeInterval;
            double gridImportKwh = (chartData.GridImport?.Where(v => v.HasValue).Sum(v => v.Value) ?? 0) * timeInterval;
            double battChargeKwh = (chartData.BatteryCharge?.Where(v => v.HasValue).Sum(v => v.Value) ?? 0) * timeInterval;
            double battDischargeKwh = (chartData.BatteryDischarge?.Where(v => v.HasValue).Sum(v => v.Value) ?? 0) * timeInterval;
            double selfUseKwh = (chartData.SelfUse?.Where(v => v.HasValue).Sum(v => v.Value) ?? 0) * timeInterval;

            return Ok(new
            {
                date = targetDate.ToString("yyyy-MM-dd"),
                source = "api",
                cache_saved = saved,
                message = saved ? "Data refreshed and saved to cache" : "Data refreshed but failed to save to cache",
                today = new
                {
                    solar_kwh = Math.Round(solarKwh, 1),
                    load_kwh = Math.Round(loadKwh, 1),
                    grid_export_kwh = Math.Round(gridExportKwh, 1),
                    grid_import_kwh = Math.Round(gridImportKwh, 1),
                    battery_charge_kwh = Math.Round(battChargeKwh, 1),
                    battery_discharge_kwh = Math.Round(battDischargeKwh, 1),
                    self_use_kwh = Math.Round(selfUseKwh, 1)
                }
            });
        }
    }
}
