namespace GrowattMonitor.Models
{
    public class LoginRequest
    {
        public string Username { get; set; } = string.Empty;
        public string Password { get; set; } = string.Empty;
        public bool RememberMe { get; set; }
    }

    public class CurrentData
    {
        public DateTime? Timestamp { get; set; }
        public double Solar { get; set; }
        public double BatteryDischarge { get; set; }
        public double GridImport { get; set; }
        public double BatteryCharge { get; set; }
        public double Load { get; set; }
        public double GridExport { get; set; }
        public double BatteryNet { get; set; }
        public double SocInv { get; set; }
        public double SocBms { get; set; }
        public bool Connected { get; set; }
    }

    public class HistoricalDataPoint
    {
        public string Timestamp { get; set; } = string.Empty;
        public double Solar { get; set; }
        public double Load { get; set; }
        public double GridExport { get; set; }
        public double GridImport { get; set; }
        public double BatteryCharge { get; set; }
        public double BatteryDischarge { get; set; }
        public double BatteryNet { get; set; }
        public double SocInv { get; set; }
        public double SocBms { get; set; }
    }

    public class DailyData
    {
        public string Date { get; set; } = string.Empty;
        public double SolarKwh { get; set; }
        public double LoadKwh { get; set; }
        public double GridExportKwh { get; set; }
        public double GridImportKwh { get; set; }
        public double BatteryChargeKwh { get; set; }
        public double BatteryDischargeKwh { get; set; }
        public int Count { get; set; }
    }

    public class ApiResponse<T>
    {
        public T? Data { get; set; }
        public int Count { get; set; }
        public string? Message { get; set; }
    }
}
