using FluentModbus;
using System.Net.Sockets;
using Microsoft.Extensions.Options;
using GrowattMonitor.Models;

namespace GrowattMonitor.Services
{
    public interface IModbusService
    {
        Task<ushort?> ReadU16Async(ushort address);
        Task<uint?> ReadU32Async(ushort address);
        Task<int?> ReadS32Async(ushort address);
    }

    public class ModbusService : IModbusService, IDisposable
    {
        private readonly ModbusSettings _settings;
        private readonly int _retryTimeout;
        private readonly double _retryDelay;
        private readonly ILogger<ModbusService> _logger;
        private ModbusTcpClient? _modbusClient;
        private readonly SemaphoreSlim _semaphore = new(1, 1);

        public ModbusService(IOptions<GrowattSettings> options, ILogger<ModbusService> logger)
        {
            var settings = options.Value;
            _settings = settings.Modbus;
            _retryTimeout = settings.RetryTimeout;
            _retryDelay = settings.RetryDelay;
            _logger = logger;
        }

        private async Task<bool> EnsureConnectedAsync()
        {
            if (_modbusClient != null && _modbusClient.IsConnected)
            {
                return true;
            }

            try
            {
                _modbusClient?.Disconnect();
                _modbusClient = new ModbusTcpClient();
                
                // Connect with IP:Port format and timeout
                var endpoint = $"{_settings.IpAddress}:{_settings.Port}";
                await Task.Run(() => _modbusClient.Connect(endpoint, ModbusEndianness.BigEndian));
                
                _logger.LogInformation("Connected to Modbus at {IpAddress}:{Port}", _settings.IpAddress, _settings.Port);
                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to connect to Modbus at {IpAddress}:{Port}", _settings.IpAddress, _settings.Port);
                return false;
            }
        }

        private async Task<ushort[]?> ReadInputRegistersWithRetryAsync(ushort address, ushort count)
        {
            var startTime = DateTime.UtcNow;
            var timeout = TimeSpan.FromSeconds(_retryTimeout);
            var delay = TimeSpan.FromSeconds(_retryDelay);

            while (DateTime.UtcNow - startTime < timeout)
            {
                if (!await EnsureConnectedAsync())
                {
                    await Task.Delay(delay);
                    continue;
                }

                try
                {
                    if (_modbusClient != null)
                    {
                        // Try Input Registers first (Modbus function code 04)
                        try
                        {
                            var result = _modbusClient.ReadInputRegisters<ushort>(_settings.UnitId, address, count);
                            return result.ToArray();
                        }
                        catch
                        {
                            // If Input Registers fail, try Holding Registers (Modbus function code 03)
                            var result = _modbusClient.ReadHoldingRegisters<ushort>(_settings.UnitId, address, count);
                            return result.ToArray();
                        }
                    }
                }
                catch (OperationCanceledException)
                {
                    _logger.LogWarning("Modbus read operation cancelled for address {Address}, retrying...", address);
                    _modbusClient?.Disconnect();
                    _modbusClient = null;
                }
                catch (Exception ex)
                {
                    _logger.LogDebug(ex, "Modbus read failed for address {Address}, retrying...", address);
                    _modbusClient?.Disconnect();
                    _modbusClient = null;
                }

                await Task.Delay(delay);
            }

            _logger.LogWarning("Modbus read timeout for address {Address}", address);
            return null;
        }

        public async Task<ushort?> ReadU16Async(ushort address)
        {
            await _semaphore.WaitAsync();
            try
            {
                var registers = await ReadInputRegistersWithRetryAsync(address, 1);
                if (registers == null) return null;
                return registers[0];
            }
            finally
            {
                _semaphore.Release();
            }
        }

        public async Task<uint?> ReadU32Async(ushort address)
        {
            await _semaphore.WaitAsync();
            try
            {
                var registers = await ReadInputRegistersWithRetryAsync(address, 2);
                if (registers == null) return null;

                uint hi = registers[0];
                uint lo = registers[1];
                return (hi << 16) | lo;
            }
            finally
            {
                _semaphore.Release();
            }
        }

        public async Task<int?> ReadS32Async(ushort address)
        {
            var value = await ReadU32Async(address);
            if (value == null) return null;

            uint uintValue = value.Value;
            if ((uintValue & 0x80000000) != 0)
            {
                return (int)(uintValue - 0x100000000);
            }

            return (int)uintValue;
        }

        public void Dispose()
        {
            _modbusClient?.Disconnect();
            _modbusClient?.Dispose();
            _semaphore.Dispose();
        }
    }
}
