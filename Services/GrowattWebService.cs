using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using GrowattMonitor.Models;

namespace GrowattMonitor.Services
{
    public interface IGrowattWebService
    {
        Task<bool> LoginAsync();
        Task<bool> LoginAsync(string username, string password);
        void Logout();
        bool IsLoggedIn();
        Task<WebApiData?> GetRealtimeDataAsync();
        Task<WebApiDailyData?> GetDailyDataAsync(DateTime date);
        Task<WebApiTotalData?> GetTotalDataAsync(DateTime? date = null);
        Task<WebApiEnergyDayChart?> GetEnergyDayChartAsync(DateTime? date = null);
    }

    public partial class GrowattWebService : IGrowattWebService, IDisposable
    {
        private readonly HttpClient _httpClient;
        private readonly CookieContainer _cookieContainer;
        private readonly GrowattWebSettings _settings;
        private readonly ILogger<GrowattWebService> _logger;
        private DateTime _lastLoginTime = DateTime.MinValue;
        private string? _sessionUsername;
        private string? _sessionPassword;

        public GrowattWebService(IOptions<GrowattSettings> options, ILogger<GrowattWebService> logger)
        {
            _settings = options.Value.Web;
            _logger = logger;
            
            _cookieContainer = new CookieContainer();
            var handler = new HttpClientHandler
            {
                UseCookies = true,
                CookieContainer = _cookieContainer,
                AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate,
                AllowAutoRedirect = false // Important for session handling
            };
            
            _httpClient = new HttpClient(handler)
            {
                BaseAddress = new Uri("https://server.growatt.com/"),
                Timeout = TimeSpan.FromSeconds(30)
            };
            
            _httpClient.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
        }

        public async Task<bool> LoginAsync()
        {
            // Use session credentials if available, otherwise fall back to settings
            var username = _sessionUsername ?? _settings.Username;
            var password = _sessionPassword ?? _settings.Password;
            
            if (string.IsNullOrEmpty(username) || string.IsNullOrEmpty(password))
            {
                _logger.LogWarning("No credentials available for login");
                return false;
            }
            
            return await LoginAsync(username, password);
        }

        public async Task<bool> LoginAsync(string username, string password)
        {
            try
            {
                // Check if we have valid cookies (session expires after 2 hours)
                var cookies = _cookieContainer.GetCookies(new Uri("https://server.growatt.com/"));
                if (cookies.Count > 0 && (DateTime.Now - _lastLoginTime).TotalHours < 2 && _sessionUsername == username)
                {
                    _logger.LogDebug("Using existing session");
                    return true;
                }

                _logger.LogInformation("Logging in to Growatt server as {Username}...", username);

                var loginData = new Dictionary<string, string>
                {
                    { "account", username },
                    { "password", password },
                    { "validateCode", "" }
                };

                var content = new FormUrlEncodedContent(loginData);
                var response = await _httpClient.PostAsync("login", content);
                var result = await response.Content.ReadAsStringAsync();

                _logger.LogDebug("Login response status: {Status}, Body: {Body}", response.StatusCode, result);

                // Check if login successful
                if (result.Contains("\"result\":1") || result.Contains("\"success\":true"))
                {
                    _lastLoginTime = DateTime.Now;
                    _sessionUsername = username;
                    _sessionPassword = password;
                    var cookieCount = _cookieContainer.GetCookies(new Uri("https://server.growatt.com/")).Count;
                    _logger.LogInformation("Successfully logged in to Growatt server. Cookies: {Count}", cookieCount);
                    return true;
                }

                _logger.LogError("Failed to login to Growatt server. Response: {Response}", result);
                return false;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during Growatt login");
                return false;
            }
        }

        public async Task<WebApiData?> GetRealtimeDataAsync()
        {
            try
            {
                if (!await LoginAsync())
                {
                    _logger.LogWarning("Not logged in, skipping data fetch");
                    return null;
                }

                // Use the MIX status endpoint for Growatt MIX inverters
                // Important: plantId in URL query string, mixSn in POST body
                var dataUrl = $"panel/mix/getMIXStatusData?plantId={_settings.PlantId}";
                _logger.LogInformation("Fetching MIX status data from: {Url}", dataUrl);

                // POST with mixSn in body
                var formData = new FormUrlEncodedContent(new Dictionary<string, string>
                {
                    { "mixSn", _settings.SerialNumber }
                });
                var dataResponse = await _httpClient.PostAsync(dataUrl, formData);
                var jsonData = await dataResponse.Content.ReadAsStringAsync();
                
                _logger.LogDebug("MIX status response: Status={Status}, Body={Body}", 
                    dataResponse.StatusCode, jsonData);

                if (!dataResponse.IsSuccessStatusCode)
                {
                    _logger.LogWarning("Failed to get MIX status data. Status: {Status}", dataResponse.StatusCode);
                    return null;
                }

                // Parse JSON response - handle duplicate keys by reading raw string
                JsonDocument doc;
                try
                {
                    // Use case-insensitive parsing to handle vAc1/vac1 duplicates
                    doc = JsonDocument.Parse(jsonData, new JsonDocumentOptions { AllowTrailingCommas = true });
                }
                catch (JsonException ex)
                {
                    _logger.LogError(ex, "Failed to parse JSON response: {Json}", jsonData);
                    return null;
                }
                
                using (doc)
                {
                    var root = doc.RootElement;

                    // Check result
                    if (!root.TryGetProperty("result", out var resultProp) || resultProp.GetInt32() != 1)
                    {
                        _logger.LogWarning("API returned non-success result");
                        return null;
                    }

                    // Get obj data
                    if (!root.TryGetProperty("obj", out var data))
                    {
                        _logger.LogWarning("Could not find obj in response");
                        return null;
                    }

                    var result = new WebApiData
                    {
                        Timestamp = DateTime.Now,
                        Connected = true
                    };

                    // Parse MIX inverter data
                    // ppv or storagePpv: Total PV power (kW)
                    if (TryGetDouble(data, new[] { "ppv", "storagePpv" }, out var solar))
                    {
                        result.Solar = solar;
                    }

                    // pactogrid: Power to grid (kW, positive = export, negative = import)
                    if (TryGetDouble(data, new[] { "pactogrid" }, out var gridPower))
                    {
                        result.GridExport = Math.Max(0, gridPower);
                        result.GridImport = Math.Max(0, -gridPower);
                    }

                    // pLocalLoad: Local load power (kW)
                    if (TryGetDouble(data, new[] { "pLocalLoad", "pactouser" }, out var load))
                    {
                        result.Load = load;
                    }

                    // chargePower: Battery charging power (kW)
                    if (TryGetDouble(data, new[] { "chargePower" }, out var charge))
                    {
                        result.BatteryCharge = charge;
                    }

                    // pdisCharge1: Battery discharge power (kW)
                    if (TryGetDouble(data, new[] { "pdisCharge1", "pDischarge" }, out var discharge))
                    {
                        result.BatteryDischarge = discharge;
                    }

                    // SOC: Battery state of charge (%)
                    if (TryGetDouble(data, new[] { "SOC", "soc" }, out var soc))
                    {
                        result.SocBms = soc;
                    }

                    _logger.LogInformation("Retrieved MIX data: Solar={Solar}kW, Load={Load}kW, BattCharge={Charge}kW, BattDischarge={Discharge}kW, GridPower={Grid}kW, SOC={SOC}%", 
                        result.Solar, result.Load, result.BatteryCharge, result.BatteryDischarge, gridPower, result.SocBms);

                    return result;
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching realtime data from Growatt API");
                return null;
            }
        }

        // Helper method to try multiple property names
        private bool TryGetDouble(JsonElement element, string[] propertyNames, out double value)
        {
            foreach (var name in propertyNames)
            {
                if (element.TryGetProperty(name, out var prop))
                {
                    if (prop.ValueKind == JsonValueKind.Number)
                    {
                        value = prop.GetDouble();
                        return true;
                    }
                    else if (prop.ValueKind == JsonValueKind.String && double.TryParse(prop.GetString(), out var parsed))
                    {
                        value = parsed;
                        return true;
                    }
                }
            }
            value = 0;
            return false;
        }

        public async Task<WebApiDailyData?> GetDailyDataAsync(DateTime date)
        {
            try
            {
                if (!await LoginAsync())
                {
                    return null;
                }

                var dateStr = date.ToString("yyyy-MM-dd");
                var response = await _httpClient.GetAsync(
                    $"panel/inv/getInverterEnergyDay?sn={_settings.SerialNumber}&date={dateStr}");

                if (!response.IsSuccessStatusCode)
                {
                    return null;
                }

                var jsonData = await response.Content.ReadAsStringAsync();
                using var doc = JsonDocument.Parse(jsonData);
                var root = doc.RootElement;

                if (!root.TryGetProperty("data", out var data))
                {
                    return null;
                }

                var result = new WebApiDailyData
                {
                    Date = dateStr
                };

                if (data.TryGetProperty("eCharge", out var eCharge))
                {
                    result.BatteryChargeKwh = eCharge.GetDouble();
                }

                if (data.TryGetProperty("eDischarge", out var eDischarge))
                {
                    result.BatteryDischargeKwh = eDischarge.GetDouble();
                }

                if (data.TryGetProperty("etouser", out var etouser))
                {
                    result.LoadKwh = etouser.GetDouble();
                }

                if (data.TryGetProperty("etogrid", out var etogrid))
                {
                    result.GridExportKwh = etogrid.GetDouble();
                }

                if (data.TryGetProperty("eacTotal", out var eacTotal))
                {
                    result.SolarKwh = eacTotal.GetDouble();
                }

                return result;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching daily data from Growatt API");
                return null;
            }
        }

        public async Task<WebApiTotalData?> GetTotalDataAsync(DateTime? date = null)
        {
            try
            {
                if (!await LoginAsync())
                {
                    _logger.LogWarning("Not logged in, skipping total data fetch");
                    return null;
                }
                
                var targetDate = (date ?? DateTime.Now).ToString("yyyy-MM-dd");

                // Fetch both getMIXTotalData and getMIXBatChart for complete data
                var dataUrl = $"panel/mix/getMIXTotalData?plantId={_settings.PlantId}";
                var batUrl = $"panel/mix/getMIXBatChart?plantId={_settings.PlantId}";
                
                _logger.LogDebug("Fetching MIX total data from: {Url} for date: {Date}", dataUrl, targetDate);

                var formData = new FormUrlEncodedContent(new Dictionary<string, string>
                {
                    { "mixSn", _settings.SerialNumber },
                    { "date", targetDate }
                });
                
                var dataResponse = await _httpClient.PostAsync(dataUrl, formData);
                var jsonData = await dataResponse.Content.ReadAsStringAsync();

                // Fetch battery chart data for charge info with date parameter
                var batFormData = new FormUrlEncodedContent(new Dictionary<string, string>
                {
                    { "mixSn", _settings.SerialNumber },
                    { "date", targetDate }
                });
                var batResponse = await _httpClient.PostAsync(batUrl, batFormData);
                var batJsonData = await batResponse.Content.ReadAsStringAsync();

                if (!dataResponse.IsSuccessStatusCode)
                {
                    _logger.LogWarning("Failed to get MIX total data. Status: {Status}", dataResponse.StatusCode);
                    return null;
                }

                JsonDocument doc;
                JsonDocument? batDoc = null;
                try
                {
                    doc = JsonDocument.Parse(jsonData);
                    if (batResponse.IsSuccessStatusCode)
                    {
                        batDoc = JsonDocument.Parse(batJsonData);
                    }
                }
                catch (JsonException ex)
                {
                    _logger.LogError(ex, "Failed to parse total data JSON: {Json}", jsonData);
                    return null;
                }

                using (doc)
                using (batDoc)
                {
                    var root = doc.RootElement;

                    if (!root.TryGetProperty("result", out var resultProp) || resultProp.GetInt32() != 1)
                    {
                        _logger.LogWarning("Total data API returned non-success result");
                        return null;
                    }

                    if (!root.TryGetProperty("obj", out var data))
                    {
                        _logger.LogWarning("Could not find obj in total data response");
                        return null;
                    }

                    var result = new WebApiTotalData();

                    // Today's energy data from getMIXTotalData
                    if (TryGetDouble(data, new[] { "epvToday" }, out var solarToday))
                        result.SolarTodayKwh = solarToday;
                    if (TryGetDouble(data, new[] { "elocalLoadToday" }, out var loadToday))
                        result.LoadTodayKwh = loadToday;
                    if (TryGetDouble(data, new[] { "etoGridToday" }, out var gridOutToday))
                        result.GridExportTodayKwh = gridOutToday;
                    if (TryGetDouble(data, new[] { "gridPowerToday" }, out var gridInToday))
                        result.GridImportTodayKwh = gridInToday;
                    if (TryGetDouble(data, new[] { "edischarge1Today" }, out var battOutToday))
                        result.BatteryDischargeTodayKwh = battOutToday;
                    if (TryGetDouble(data, new[] { "eselfToday" }, out var selfToday))
                        result.SelfUseTodayKwh = selfToday;

                    // Get battery charge from getMIXBatChart
                    if (batDoc != null)
                    {
                        var batRoot = batDoc.RootElement;
                        if (batRoot.TryGetProperty("result", out var batResult) && batResult.GetInt32() == 1 &&
                            batRoot.TryGetProperty("obj", out var batObj) &&
                            batObj.TryGetProperty("cdsData", out var cdsData) &&
                            cdsData.TryGetProperty("cd_charge", out var cdCharge) &&
                            cdCharge.GetArrayLength() > 0)
                        {
                            // Get the last element (today's charge)
                            var todayCharge = cdCharge[cdCharge.GetArrayLength() - 1];
                            if (todayCharge.ValueKind == JsonValueKind.Number)
                            {
                                result.BatteryChargeTodayKwh = todayCharge.GetDouble();
                                _logger.LogDebug("Got battery charge from batChart: {Charge}kWh", result.BatteryChargeTodayKwh);
                            }
                        }
                    }

                    // Total energy data
                    if (TryGetDouble(data, new[] { "epvTotal" }, out var solarTotal))
                        result.SolarTotalKwh = solarTotal;
                    if (TryGetDouble(data, new[] { "elocalLoadTotal" }, out var loadTotal))
                        result.LoadTotalKwh = loadTotal;
                    if (TryGetDouble(data, new[] { "etogridTotal" }, out var gridOutTotal))
                        result.GridExportTotalKwh = gridOutTotal;
                    if (TryGetDouble(data, new[] { "gridPowerTotal" }, out var gridInTotal))
                        result.GridImportTotalKwh = gridInTotal;
                    if (TryGetDouble(data, new[] { "edischarge1Total" }, out var battOutTotal))
                        result.BatteryDischargeTotalKwh = battOutTotal;
                    if (TryGetDouble(data, new[] { "eselfTotal" }, out var selfTotal))
                        result.SelfUseTotalKwh = selfTotal;

                    _logger.LogInformation("Retrieved MIX total data: Today - Solar={Solar}kWh, Load={Load}kWh, GridOut={GridOut}kWh, GridIn={GridIn}kWh, BattOut={BattOut}kWh, BattIn={BattIn}kWh",
                        result.SolarTodayKwh, result.LoadTodayKwh, result.GridExportTodayKwh, result.GridImportTodayKwh, result.BatteryDischargeTodayKwh, result.BatteryChargeTodayKwh);

                    return result;
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching total data from Growatt API");
                return null;
            }
        }

        public async Task<WebApiEnergyDayChart?> GetEnergyDayChartAsync(DateTime? date = null)
        {
            try
            {
                if (!await LoginAsync())
                {
                    _logger.LogWarning("Not logged in, skipping energy day chart fetch");
                    return null;
                }

                var url = $"panel/mix/getMIXEnergyDayChart?plantId={_settings.PlantId}";
                var targetDate = (date ?? DateTime.Now).ToString("yyyy-MM-dd");
                var content = new FormUrlEncodedContent(new[]
                {
                    new KeyValuePair<string, string>("mixSn", _settings.SerialNumber),
                    new KeyValuePair<string, string>("date", targetDate)
                });

                var response = await _httpClient.PostAsync(url, content);
                response.EnsureSuccessStatusCode();

                var json = await response.Content.ReadAsStringAsync();
                _logger.LogDebug("Energy day chart response: {Json}", json.Length > 200 ? json.Substring(0, 200) + "..." : json);

                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;

                if (root.TryGetProperty("result", out var result) && result.GetInt32() == 1 &&
                    root.TryGetProperty("obj", out var obj) &&
                    obj.TryGetProperty("charts", out var charts))
                {
                    var chartData = new WebApiEnergyDayChart();

                    // Extract all chart arrays
                    if (charts.TryGetProperty("ppv", out var ppv))
                        chartData.Solar = ParseDoubleArray(ppv);
                    if (charts.TryGetProperty("pcharge", out var pcharge))
                        chartData.BatteryCharge = ParseDoubleArray(pcharge);
                    if (charts.TryGetProperty("pdischarge", out var pdischarge))
                        chartData.BatteryDischarge = ParseDoubleArray(pdischarge);
                    if (charts.TryGetProperty("elocalLoad", out var load))
                        chartData.Load = ParseDoubleArray(load);
                    if (charts.TryGetProperty("pacToGrid", out var toGrid))
                        chartData.GridExport = ParseDoubleArray(toGrid);
                    if (charts.TryGetProperty("pacToUser", out var toUser))
                        chartData.GridImport = ParseDoubleArray(toUser);
                    if (charts.TryGetProperty("pself", out var pself))
                        chartData.SelfUse = ParseDoubleArray(pself);

                    _logger.LogInformation("Retrieved energy day chart with {Count} data points", chartData.Solar?.Count ?? 0);
                    return chartData;
                }

                _logger.LogWarning("Invalid energy day chart response format");
                return null;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching energy day chart from Growatt API");
                return null;
            }
        }

        private List<double?> ParseDoubleArray(JsonElement arrayElement)
        {
            var result = new List<double?>();
            if (arrayElement.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in arrayElement.EnumerateArray())
                {
                    if (item.ValueKind == JsonValueKind.Number)
                        result.Add(item.GetDouble());
                    else if (item.ValueKind == JsonValueKind.Null)
                        result.Add(null);
                    else
                        result.Add(0);
                }
            }
            return result;
        }

        public void Dispose()
        {
            _httpClient?.Dispose();
        }
    }

    public class WebApiData
    {
        public DateTime Timestamp { get; set; }
        public bool Connected { get; set; }
        public double Solar { get; set; }
        public double Load { get; set; }
        public double GridExport { get; set; }
        public double GridImport { get; set; }
        public double BatteryCharge { get; set; }
        public double BatteryDischarge { get; set; }
        public double SocBms { get; set; }
    }

    public class WebApiDailyData
    {
        public string Date { get; set; } = "";
        public double SolarKwh { get; set; }
        public double LoadKwh { get; set; }
        public double GridExportKwh { get; set; }
        public double GridImportKwh { get; set; }
        public double BatteryChargeKwh { get; set; }
        public double BatteryDischargeKwh { get; set; }
    }

    public class WebApiTotalData
    {
        // Today's totals
        public double SolarTodayKwh { get; set; }
        public double LoadTodayKwh { get; set; }
        public double GridExportTodayKwh { get; set; }
        public double GridImportTodayKwh { get; set; }
        public double BatteryChargeTodayKwh { get; set; }
        public double BatteryDischargeTodayKwh { get; set; }
        public double SelfUseTodayKwh { get; set; }

        // Lifetime totals
        public double SolarTotalKwh { get; set; }
        public double LoadTotalKwh { get; set; }
        public double GridExportTotalKwh { get; set; }
        public double GridImportTotalKwh { get; set; }
        public double BatteryDischargeTotalKwh { get; set; }
        public double SelfUseTotalKwh { get; set; }
    }

    public class WebApiEnergyDayChart
    {
        public List<double?> Solar { get; set; } = new();
        public List<double?> BatteryCharge { get; set; } = new();
        public List<double?> BatteryDischarge { get; set; } = new();
        public List<double?> Load { get; set; } = new();
        public List<double?> GridExport { get; set; } = new();
        public List<double?> GridImport { get; set; } = new();
        public List<double?> SelfUse { get; set; } = new();
    }

    public partial class GrowattWebService
    {
        public void Logout()
        {
            ClearSession();
        }

        public bool IsLoggedIn()
        {
            return HasValidSession();
        }

        public void ClearSession()
        {
            _sessionUsername = null;
            _sessionPassword = null;
            _lastLoginTime = DateTime.MinValue;
            _cookieContainer.GetCookies(new Uri("https://server.growatt.com/"))
                .Cast<Cookie>()
                .ToList()
                .ForEach(c => c.Expired = true);
            _logger.LogInformation("Session cleared");
        }

        public bool HasValidSession()
        {
            var cookies = _cookieContainer.GetCookies(new Uri("https://server.growatt.com/"));
            return cookies.Count > 0 && 
                   (DateTime.Now - _lastLoginTime).TotalHours < 2 && 
                   !string.IsNullOrEmpty(_sessionUsername);
        }
    }
}
