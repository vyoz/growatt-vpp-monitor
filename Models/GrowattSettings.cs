namespace GrowattMonitor.Models
{
    public class GrowattSettings
    {
        public ModbusSettings Modbus { get; set; } = new();
        public GrowattWebSettings Web { get; set; } = new();
        public string DataSource { get; set; } = "modbus"; // "modbus" or "web"
        public int PollingInterval { get; set; } = 5;
        public int HistorySize { get; set; } = 1000;
        public string LogDirectory { get; set; } = "./logs";
        public int RetryTimeout { get; set; } = 10;
        public double RetryDelay { get; set; } = 0.5;
    }

    public class ModbusSettings
    {
        public string IpAddress { get; set; } = "192.168.1.50";
        public int Port { get; set; } = 502;
        public byte UnitId { get; set; } = 1;
    }

    public class GrowattWebSettings
    {
        public string Username { get; set; } = "";
        public string Password { get; set; } = "";
        public string PlantId { get; set; } = "";
        public string SerialNumber { get; set; } = "";
    }
}
