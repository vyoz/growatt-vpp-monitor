using GrowattMonitor.Models;
using Microsoft.Extensions.Options;

namespace GrowattMonitor.Services
{
    public class DataPollingService : BackgroundService
    {
        private readonly IModbusService? _modbusService;
        private readonly IGrowattWebService? _webService;
        private readonly DataService _dataService;
        private readonly GrowattSettings _settings;
        private readonly ILogger<DataPollingService> _logger;

        public DataPollingService(
            IServiceProvider serviceProvider,
            DataService dataService,
            IOptions<GrowattSettings> options,
            ILogger<DataPollingService> logger)
        {
            _settings = options.Value;
            _dataService = dataService;
            _logger = logger;

            // Get the appropriate service based on configuration
            if (_settings.DataSource.ToLower() == "web")
            {
                _webService = serviceProvider.GetService<IGrowattWebService>();
                _logger.LogInformation("Using Growatt Web API as data source");
            }
            else
            {
                _modbusService = serviceProvider.GetService<IModbusService>();
                _logger.LogInformation("Using Modbus TCP as data source");
            }
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation("Data Polling Service started. Interval: {Interval} seconds, Source: {Source}", 
                _settings.PollingInterval, _settings.DataSource);

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    // Create a timeout for the entire poll operation
                    using var timeoutCts = new CancellationTokenSource();
                    timeoutCts.CancelAfter(TimeSpan.FromSeconds(_settings.PollingInterval - 10));
                    
                    var pollTask = Task.Run(async () => 
                    {
                        if (_settings.DataSource.ToLower() == "web")
                        {
                            await PollWebApiDataAsync();
                        }
                        else
                        {
                            await PollInverterDataAsync();
                        }
                    }, timeoutCts.Token);
                    
                    try
                    {
                        await pollTask;
                    }
                    catch (OperationCanceledException)
                    {
                        _logger.LogWarning("Data polling timed out, skipping to next cycle");
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error in polling loop");
                }

                try
                {
                    await Task.Delay(TimeSpan.FromSeconds(_settings.PollingInterval), stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    _logger.LogInformation("Data Polling Service stopping...");
                    break;
                }
            }
        }

        private async Task PollWebApiDataAsync()
        {
            try
            {
                if (_webService == null)
                {
                    _logger.LogError("Web service not available");
                    return;
                }

                _logger.LogInformation("Fetching data from Growatt Web API...");
                
                var webData = await _webService.GetRealtimeDataAsync();
                
                if (webData == null)
                {
                    _logger.LogWarning("Failed to get data from Growatt Web API");
                    
                    var errorData = new CurrentData
                    {
                        Timestamp = DateTime.Now,
                        Connected = false
                    };
                    _dataService.UpdateCurrentData(errorData);
                    return;
                }

                // Convert Web API data to CurrentData format
                var currentData = new CurrentData
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

                _dataService.UpdateCurrentData(currentData);

                _logger.LogInformation(
                    "[{Timestamp}] PV={PV}kW Load={Load}kW GridOut={GridOut}kW Batt={Batt}kW SOC={SOC}%",
                    currentData.Timestamp,
                    currentData.Solar,
                    currentData.Load,
                    currentData.GridExport,
                    currentData.BatteryNet,
                    currentData.SocBms
                );
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to poll Web API");
                
                var errorData = new CurrentData
                {
                    Timestamp = DateTime.Now,
                    Connected = false
                };
                _dataService.UpdateCurrentData(errorData);
            }
        }

        private async Task PollInverterDataAsync()
        {
            try
            {
                _logger.LogInformation("Starting data poll...");
                
                // Read PV power (register 1, U32, unit: 0.1W)
                var pvRaw = await _modbusService.ReadU32Async(1);
                var pv = pvRaw.HasValue ? pvRaw.Value / 10.0 / 1000.0 : 0; // Convert to kW
                _logger.LogDebug("PV Raw: {PvRaw}, PV: {Pv}kW", pvRaw, pv);

                // Read Grid power (register 1029, S32, unit: 0.1W)
                // Convention: POSITIVE = Export to grid, NEGATIVE = Import from grid
                var gridRaw = await _modbusService.ReadS32Async(1029);
                var grid = gridRaw.HasValue ? gridRaw.Value / 10.0 / 1000.0 : 0; // Convert to kW
                _logger.LogDebug("Grid Raw: {GridRaw}, Grid: {Grid}kW", gridRaw, grid);

                // Read Load power (register 1037, S32, unit: 0.1W)
                var loadRaw = await _modbusService.ReadS32Async(1037);
                var load = loadRaw.HasValue ? loadRaw.Value / 10.0 / 1000.0 : 0; // Convert to kW
                _logger.LogDebug("Load Raw: {LoadRaw}, Load: {Load}kW", loadRaw, load);

                // Read Battery power (register 1021, S32, unit: 0.1W)
                // Positive = Charging, Negative = Discharging
                var batteryRaw = await _modbusService.ReadS32Async(1021);
                var batteryPower = batteryRaw.HasValue ? batteryRaw.Value / 10.0 / 1000.0 : 0; // Convert to kW
                _logger.LogDebug("Battery Raw: {BatteryRaw}, Battery: {Battery}kW", batteryRaw, batteryPower);

                // Read SOC (inverter) (register 1014, U16)
                var socInv = await _modbusService.ReadU16Async(1014);

                // Read SOC (BMS) (register 1086, U16)
                var socBms = await _modbusService.ReadU16Async(1086);

                // Read BMS capacity info for accurate SOC calculation
                var bmsRemainingCapacity = await _modbusService.ReadU16Async(1091);
                var bmsFullCapacity = await _modbusService.ReadU16Async(1092);

                // Calculate accurate SOC from BMS capacity (0.1Ah units)
                double socCalculated = 0;
                if (bmsRemainingCapacity.HasValue && bmsFullCapacity.HasValue && bmsFullCapacity.Value > 0)
                {
                    socCalculated = Math.Round((double)bmsRemainingCapacity.Value / bmsFullCapacity.Value * 100, 2);
                }

                // Log SOC values
                _logger.LogInformation("SOC - Inv(1014): {SocInv}%, BMS(1086): {SocBms}%, Calculated: {SocCalc}% (Remaining: {Remaining}/Full: {Full})", 
                    socInv, socBms, socCalculated, bmsRemainingCapacity, bmsFullCapacity);

                // Check if we got valid data - at least one core reading should succeed
                bool isConnected = pvRaw.HasValue || loadRaw.HasValue || gridRaw.HasValue;

                // Calculate grid and battery values
                double batteryCharge = 0;
                double batteryDischarge = 0;
                double gridExport = 0;
                double gridImport = 0;

                if (pvRaw.HasValue && loadRaw.HasValue && batteryRaw.HasValue)
                {
                    // Battery convention: positive = charging, negative = discharging
                    batteryCharge = Math.Max(batteryPower, 0);
                    batteryDischarge = Math.Max(-batteryPower, 0);

                    // Try to use Grid register 1029 if available
                    if (gridRaw.HasValue && Math.Abs(grid) > 0.01)
                    {
                        // Grid convention: POSITIVE = export to grid, NEGATIVE = import from grid
                        gridExport = Math.Max(grid, 0);
                        gridImport = Math.Max(-grid, 0);
                        
                        _logger.LogDebug("Using Grid register 1029: {Grid}kW (Export:{Export}, Import:{Import})", 
                            grid, gridExport, gridImport);
                    }
                    else
                    {
                        // Grid register not available or zero, calculate from energy balance
                        // Energy balance: Solar + GridImport + BatteryDischarge = Load + GridExport + BatteryCharge
                        // Simplified: Solar + BatteryDischarge = Load + BatteryCharge + GridNet
                        // Where GridNet = GridExport - GridImport
                        double gridNet = pv + batteryDischarge - load - batteryCharge;
                        
                        if (gridNet > 0)
                        {
                            gridExport = gridNet;
                            gridImport = 0;
                        }
                        else
                        {
                            gridExport = 0;
                            gridImport = -gridNet;
                        }
                        
                        _logger.LogInformation("Grid register unavailable, calculated from energy balance: Export:{Export}kW, Import:{Import}kW", 
                            gridExport, gridImport);
                    }

                    // Log energy balance for debugging
                    var totalInput = pv + gridImport + batteryDischarge;
                    var totalOutput = load + gridExport + batteryCharge;
                    _logger.LogDebug("Energy balance: Input(PV:{PV}+GridIn:{GI}+BattOut:{BO})={TI:F3} vs Output(Load:{L}+GridOut:{GO}+BattIn:{BI})={TO:F3}",
                        pv, gridImport, batteryDischarge, totalInput,
                        load, gridExport, batteryCharge, totalOutput);
                }

                var currentData = new CurrentData
                {
                    Timestamp = DateTime.Now,
                    Solar = Math.Round(pv, 3),
                    BatteryDischarge = Math.Round(batteryDischarge, 3),
                    GridImport = Math.Round(gridImport, 3),
                    BatteryCharge = Math.Round(batteryCharge, 3),
                    Load = Math.Round(load, 3),
                    GridExport = Math.Round(gridExport, 3),
                    BatteryNet = Math.Round(batteryPower, 3),
                    SocInv = socInv ?? 0,
                    SocBms = socCalculated > 0 ? socCalculated : (socBms ?? 0), // Use calculated SOC if available
                    Connected = isConnected
                };

                _dataService.UpdateCurrentData(currentData);

                _logger.LogInformation(
                    "[{Timestamp}] Solar={Solar}kW Load={Load}kW Grid={Grid}kW(Import:{Import}/Export:{Export}) Battery={Batt}kW(Charge:{Charge}/Discharge:{Discharge}) SOC={SOC}%",
                    currentData.Timestamp?.ToString("HH:mm:ss"),
                    currentData.Solar,
                    currentData.Load,
                    grid,
                    gridImport,
                    gridExport,
                    batteryPower,
                    batteryCharge,
                    batteryDischarge,
                    currentData.SocBms
                );
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to poll inverter");
                
                var errorData = new CurrentData
                {
                    Timestamp = DateTime.Now,
                    Connected = false
                };
                _dataService.UpdateCurrentData(errorData);
            }
        }
    }
}
