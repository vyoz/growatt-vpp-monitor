using GrowattMonitor.Models;
using Microsoft.Extensions.Options;
using System.Collections.Concurrent;
using System.Globalization;
using CsvHelper;
using CsvHelper.Configuration;

namespace GrowattMonitor.Services
{
    public interface IDataService
    {
        CurrentData GetCurrentData();
        void UpdateCurrentData(CurrentData data);
        List<HistoricalDataPoint> GetHistoricalData(int limit = 100, int? minutes = null);
        Task<List<HistoricalDataPoint>> GetHistoryRangeAsync(DateTime startDate, DateTime endDate, int limit = 500);
        Task<DailyData> GetDailyDataAsync(DateTime date);
        Task<List<DailyData>> GetDailyRangeAsync(DateTime startDate, DateTime endDate);
        Task<WebApiTotalData?> GetTotalDataAsync(DateTime? date = null);
        Task<WebApiEnergyDayChart?> GetEnergyDayChartAsync(DateTime? date = null);
        Task<bool> SaveHistoricalDayDataAsync(DateTime date, WebApiEnergyDayChart chartData);
        Task<bool> HasCachedDataForDateAsync(DateTime date);
    }

    public class DataService : IDataService
    {
        private readonly GrowattSettings _settings;
        private readonly ILogger<DataService> _logger;
        private readonly IGrowattWebService? _webService;
        private readonly ConcurrentQueue<HistoricalDataPoint> _historicalData = new();
        private CurrentData _currentData = new CurrentData { Connected = false };
        private readonly object _dataLock = new();

        public DataService(IOptions<GrowattSettings> options, ILogger<DataService> logger, IGrowattWebService? webService = null)
        {
            _settings = options.Value;
            _logger = logger;
            _webService = webService;

            // Ensure log directory exists
            if (!Directory.Exists(_settings.LogDirectory))
            {
                Directory.CreateDirectory(_settings.LogDirectory);
            }
        }

        public CurrentData GetCurrentData()
        {
            lock (_dataLock)
            {
                return _currentData;
            }
        }

        public void UpdateCurrentData(CurrentData data)
        {
            lock (_dataLock)
            {
                _currentData = data;

                // Add to historical data
                var historicalPoint = new HistoricalDataPoint
                {
                    Timestamp = data.Timestamp?.ToString("o") ?? DateTime.Now.ToString("o"),
                    Solar = data.Solar,
                    Load = data.Load,
                    GridExport = data.GridExport,
                    GridImport = data.GridImport,
                    BatteryCharge = data.BatteryCharge,
                    BatteryDischarge = data.BatteryDischarge,
                    BatteryNet = data.BatteryNet,
                    SocInv = data.SocInv,
                    SocBms = data.SocBms
                };

                _historicalData.Enqueue(historicalPoint);

                // Keep only recent history
                while (_historicalData.Count > _settings.HistorySize)
                {
                    _historicalData.TryDequeue(out _);
                }

                // Log to CSV
                _ = Task.Run(() => LogToCsvAsync(historicalPoint));
            }
        }

        public List<HistoricalDataPoint> GetHistoricalData(int limit = 100, int? minutes = null)
        {
            var data = _historicalData.ToList();

            if (minutes.HasValue)
            {
                var cutoff = DateTime.Now.AddMinutes(-minutes.Value);
                data = data.Where(d => DateTime.Parse(d.Timestamp) >= cutoff).ToList();
            }

            if (limit > 0 && data.Count > limit)
            {
                int step = data.Count / limit;
                data = data.Where((x, i) => i % step == 0).ToList();
            }

            return data;
        }

        private string GetMonthlyLogFile(DateTime? date = null)
        {
            var dt = date ?? DateTime.Now;
            var monthStr = dt.ToString("yyyy-MM");
            return Path.Combine(_settings.LogDirectory, $"growatt_log_{monthStr}.csv");
        }

        private async Task LogToCsvAsync(HistoricalDataPoint data)
        {
            try
            {
                var filepath = GetMonthlyLogFile();
                var fileExists = File.Exists(filepath) && new FileInfo(filepath).Length > 0;

                var config = new CsvConfiguration(CultureInfo.InvariantCulture)
                {
                    HasHeaderRecord = !fileExists,
                };

                await using var stream = new FileStream(filepath, FileMode.Append, FileAccess.Write, FileShare.Read);
                await using var writer = new StreamWriter(stream);
                await using var csv = new CsvWriter(writer, config);

                if (!fileExists)
                {
                    csv.WriteHeader<HistoricalDataPoint>();
                    await csv.NextRecordAsync();
                }

                csv.WriteRecord(data);
                await csv.NextRecordAsync();
                await csv.FlushAsync();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to write to CSV");
            }
        }

        public async Task<List<HistoricalDataPoint>> GetHistoryRangeAsync(DateTime startDate, DateTime endDate, int limit = 500)
        {
            var files = GetLogFilesForDateRange(startDate, endDate);
            var allData = new List<HistoricalDataPoint>();

            foreach (var file in files)
            {
                var data = await ReadCsvDataAsync(file, startDate, endDate);
                allData.AddRange(data);
            }

            // Fallback to in-memory data if no CSV files
            if (allData.Count == 0)
            {
                allData = _historicalData
                    .Where(d => DateTime.Parse(d.Timestamp).Date >= startDate.Date && DateTime.Parse(d.Timestamp).Date <= endDate.Date)
                    .ToList();
            }

            allData = allData.OrderBy(d => d.Timestamp).ToList();

            // Downsample if needed
            if (limit > 0 && allData.Count > limit)
            {
                int step = allData.Count / limit;
                allData = allData.Where((x, i) => i % step == 0).ToList();
            }

            return allData;
        }

        private List<string> GetLogFilesForDateRange(DateTime startDate, DateTime endDate)
        {
            var files = new List<string>();
            var current = new DateTime(startDate.Year, startDate.Month, 1);
            var endMonth = new DateTime(endDate.Year, endDate.Month, 1);

            while (current <= endMonth)
            {
                var filepath = GetMonthlyLogFile(current);
                if (File.Exists(filepath))
                {
                    files.Add(filepath);
                }

                current = current.AddMonths(1);
            }

            return files;
        }

        private async Task<List<HistoricalDataPoint>> ReadCsvDataAsync(string filepath, DateTime? startDate = null, DateTime? endDate = null)
        {
            var data = new List<HistoricalDataPoint>();

            try
            {
                using var reader = new StreamReader(filepath);
                using var csv = new CsvReader(reader, CultureInfo.InvariantCulture);

                await foreach (var record in csv.GetRecordsAsync<HistoricalDataPoint>())
                {
                    var ts = DateTime.Parse(record.Timestamp);

                    if (startDate.HasValue && ts.Date < startDate.Value.Date)
                        continue;
                    if (endDate.HasValue && ts.Date > endDate.Value.Date)
                        continue;

                    data.Add(record);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to read CSV file {FilePath}", filepath);
            }

            return data;
        }

        public async Task<DailyData> GetDailyDataAsync(DateTime date)
        {
            var result = await GetDailyRangeAsync(date, date);
            return result.FirstOrDefault() ?? new DailyData { Date = date.ToString("yyyy-MM-dd") };
        }

        public async Task<List<DailyData>> GetDailyRangeAsync(DateTime startDate, DateTime endDate)
        {
            var results = new List<DailyData>();
            var current = startDate.Date;

            while (current <= endDate.Date)
            {
                var dailyData = await CalculateDailyTotalsAsync(current);
                results.Add(dailyData);
                current = current.AddDays(1);
            }

            return results;
        }

        private async Task<DailyData> CalculateDailyTotalsAsync(DateTime date)
        {
            var totals = new DailyData
            {
                Date = date.ToString("yyyy-MM-dd"),
                SolarKwh = 0,
                LoadKwh = 0,
                GridExportKwh = 0,
                GridImportKwh = 0,
                BatteryChargeKwh = 0,
                BatteryDischargeKwh = 0,
                Count = 0
            };

            var files = GetLogFilesForDateRange(date, date);
            var allData = new List<HistoricalDataPoint>();

            foreach (var file in files)
            {
                var data = await ReadCsvDataAsync(file, date, date);
                allData.AddRange(data);
            }

            // Fallback to in-memory data
            if (allData.Count == 0)
            {
                allData = _historicalData
                    .Where(d => DateTime.Parse(d.Timestamp).Date == date.Date)
                    .ToList();
            }

            if (allData.Count == 0)
            {
                return totals;
            }

            // Detect time interval between data points
            // If data is from Web API (hourly), interval is ~1 hour
            // If data is from real-time polling, interval is PollingInterval seconds
            double intervalHours;
            if (allData.Count >= 2)
            {
                var timestamps = allData.Select(d => DateTime.Parse(d.Timestamp)).OrderBy(t => t).ToList();
                var avgIntervalMinutes = 0.0;
                for (int i = 1; i < Math.Min(5, timestamps.Count); i++)
                {
                    avgIntervalMinutes += (timestamps[i] - timestamps[i - 1]).TotalMinutes;
                }
                avgIntervalMinutes /= Math.Min(4, timestamps.Count - 1);

                // If average interval is > 30 minutes, assume hourly data (from Web API)
                // Otherwise use configured polling interval
                if (avgIntervalMinutes > 30)
                {
                    intervalHours = 1.0; // Hourly data from Web API
                    _logger.LogDebug("Detected hourly data for {Date}, using 1 hour interval", date.ToString("yyyy-MM-dd"));
                }
                else
                {
                    intervalHours = _settings.PollingInterval / 3600.0; // Real-time polling data
                    _logger.LogDebug("Detected polling data for {Date}, using {Interval}s interval", date.ToString("yyyy-MM-dd"), _settings.PollingInterval);
                }
            }
            else
            {
                intervalHours = _settings.PollingInterval / 3600.0;
            }

            foreach (var row in allData)
            {
                totals.SolarKwh += row.Solar * intervalHours;
                totals.LoadKwh += row.Load * intervalHours;
                totals.GridExportKwh += row.GridExport * intervalHours;
                totals.GridImportKwh += row.GridImport * intervalHours;
                totals.BatteryChargeKwh += row.BatteryCharge * intervalHours;
                totals.BatteryDischargeKwh += row.BatteryDischarge * intervalHours;
                totals.Count++;
            }

            return totals;
        }

        public async Task<WebApiTotalData?> GetTotalDataAsync(DateTime? date = null)
        {
            if (_webService == null)
            {
                _logger.LogWarning("Web service not available for total data");
                return null;
            }

            return await _webService.GetTotalDataAsync(date);
        }

        public async Task<WebApiEnergyDayChart?> GetEnergyDayChartAsync(DateTime? date = null)
        {
            if (_webService == null)
            {
                _logger.LogWarning("Web service not available for energy day chart");
                return null;
            }

            return await _webService.GetEnergyDayChartAsync(date);
        }

        /// <summary>
        /// Check if we have any cached CSV data for a specific date
        /// Historical data, even if incomplete, won't change so we use it if available
        /// </summary>
        public async Task<bool> HasCachedDataForDateAsync(DateTime date)
        {
            // For today or future dates, never use cache
            if (date.Date >= DateTime.Now.Date)
            {
                return false;
            }

            var files = GetLogFilesForDateRange(date, date);
            var allData = new List<HistoricalDataPoint>();

            foreach (var file in files)
            {
                var data = await ReadCsvDataAsync(file, date, date);
                allData.AddRange(data);
            }

            // Return true if we have any data for this date
            return allData.Count > 0;
        }

        /// <summary>
        /// Save historical day data from Web API to CSV file
        /// Converts 288 5-minute data points to hourly averages
        /// </summary>
        public async Task<bool> SaveHistoricalDayDataAsync(DateTime date, WebApiEnergyDayChart chartData)
        {
            try
            {
                var dateStr = date.ToString("yyyy-MM");
                var logFile = Path.Combine(_settings.LogDirectory, $"growatt_log_{dateStr}.csv");

                _logger.LogInformation("Saving historical data for {Date} to {File}", date.ToString("yyyy-MM-dd"), logFile);

                // Convert 288 5-minute data points to 24 hourly data points
                var hourlyData = new List<HistoricalDataPoint>();
                
                for (int hour = 0; hour < 24; hour++)
                {
                    // Each hour has 12 5-minute intervals (60/5)
                    int startIdx = hour * 12;
                    int endIdx = Math.Min(startIdx + 12, chartData.Solar?.Count ?? 0);
                    
                    if (startIdx >= (chartData.Solar?.Count ?? 0)) break;

                    // Calculate average for this hour
                    var timestamp = new DateTime(date.Year, date.Month, date.Day, hour, 0, 0);
                    
                    var point = new HistoricalDataPoint
                    {
                        Timestamp = timestamp.ToString("yyyy-MM-dd HH:mm:ss"),
                        Solar = CalculateAverage(chartData.Solar, startIdx, endIdx),
                        Load = CalculateAverage(chartData.Load, startIdx, endIdx),
                        GridExport = CalculateAverage(chartData.GridExport, startIdx, endIdx),
                        GridImport = CalculateAverage(chartData.GridImport, startIdx, endIdx),
                        BatteryCharge = CalculateAverage(chartData.BatteryCharge, startIdx, endIdx),
                        BatteryDischarge = CalculateAverage(chartData.BatteryDischarge, startIdx, endIdx),
                        BatteryNet = 0, // Calculated field, not used
                        SocInv = 0, // Not available in historical data
                        SocBms = 0
                    };

                    hourlyData.Add(point);
                }

                // Read existing data from file
                var existingData = new List<HistoricalDataPoint>();
                if (File.Exists(logFile))
                {
                    existingData = (await ReadCsvDataAsync(logFile, DateTime.MinValue, DateTime.MaxValue)).ToList();
                    // Remove existing data for this date
                    existingData.RemoveAll(d => DateTime.Parse(d.Timestamp).Date == date.Date);
                }

                // Merge and sort
                existingData.AddRange(hourlyData);
                existingData = existingData.OrderBy(d => d.Timestamp).ToList();

                // Write to CSV
                var config = new CsvConfiguration(CultureInfo.InvariantCulture)
                {
                    HasHeaderRecord = true,
                };

                using (var writer = new StreamWriter(logFile))
                using (var csv = new CsvWriter(writer, config))
                {
                    await csv.WriteRecordsAsync(existingData);
                }

                _logger.LogInformation("Saved {Count} hourly data points for {Date}", hourlyData.Count, date.ToString("yyyy-MM-dd"));
                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to save historical data for {Date}", date.ToString("yyyy-MM-dd"));
                return false;
            }
        }

        private double CalculateAverage(List<double?>? values, int startIdx, int endIdx)
        {
            if (values == null || startIdx >= values.Count) return 0;

            var slice = values.Skip(startIdx).Take(endIdx - startIdx).Where(v => v.HasValue).Select(v => v!.Value).ToList();
            return slice.Any() ? slice.Average() : 0;
        }
    }
}
