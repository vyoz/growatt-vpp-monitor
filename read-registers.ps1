# Read Growatt Modbus Registers for debugging
# This script uses the compiled GrowattMonitor.dll to read registers

$dllPath = "C:\growatt\GrowattMonitor.NET\bin\Release\net8.0\GrowattMonitor.dll"
$ip = "192.168.0.156"
$port = 502
$unitId = 1

Write-Host "=== Growatt Modbus Register Reader ===" -ForegroundColor Cyan
Write-Host "IP: $ip, Port: $port, Unit ID: $unitId" -ForegroundColor Gray
Write-Host ""

# Use a simple Python script instead (if Python is available)
$pythonScript = @"
import socket
import struct
import time

def read_modbus_register(ip, port, unit_id, address, count, function_code=4):
    try:
        # Connect to Modbus TCP
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(5)
        sock.connect((ip, port))
        
        # Build Modbus TCP frame
        transaction_id = 1
        protocol_id = 0
        length = 6
        
        # Modbus PDU
        pdu = struct.pack('>BBHH', function_code, unit_id, address, count)
        
        # MBAP Header
        mbap = struct.pack('>HHHB', transaction_id, protocol_id, len(pdu) + 1, unit_id)
        
        # Send request
        request = mbap + pdu[1:]  # Remove duplicate unit_id
        sock.send(request)
        
        # Receive response
        response = sock.recv(1024)
        sock.close()
        
        # Parse response
        if len(response) >= 9:
            byte_count = response[8]
            data = response[9:9+byte_count]
            values = []
            for i in range(0, len(data), 2):
                value = struct.unpack('>H', data[i:i+2])[0]
                values.append(value)
            return values
        return None
    except Exception as e:
        print(f"Error: {e}")
        return None

# Read key registers
print("Reading registers...")
print("")

# PV Power (1-2): U32, 0.1W
pv_regs = read_modbus_register('$ip', $port, $unitId, 1, 2)
if pv_regs:
    pv_raw = (pv_regs[0] << 16) | pv_regs[1]
    pv_kw = pv_raw / 10.0 / 1000.0
    print(f"PV Power (1-2):        {pv_raw:10d} (0.1W) = {pv_kw:8.3f} kW")

time.sleep(0.1)

# Grid Power (1029-1030): S32, 0.1W
grid_regs = read_modbus_register('$ip', $port, $unitId, 1029, 2)
if grid_regs:
    grid_raw = (grid_regs[0] << 16) | grid_regs[1]
    # Handle signed 32-bit
    if grid_raw & 0x80000000:
        grid_raw = grid_raw - 0x100000000
    grid_kw = grid_raw / 10.0 / 1000.0
    print(f"Grid Power (1029-1030): {grid_raw:10d} (0.1W) = {grid_kw:8.3f} kW  {'(Import)' if grid_raw > 0 else '(Export)' if grid_raw < 0 else '(Zero)'}")

time.sleep(0.1)

# Load Power (1037-1038): S32, 0.1W  
load_regs = read_modbus_register('$ip', $port, $unitId, 1037, 2)
if load_regs:
    load_raw = (load_regs[0] << 16) | load_regs[1]
    if load_raw & 0x80000000:
        load_raw = load_raw - 0x100000000
    load_kw = load_raw / 10.0 / 1000.0
    print(f"Load Power (1037-1038): {load_raw:10d} (0.1W) = {load_kw:8.3f} kW")

time.sleep(0.1)

# Battery Power (1021-1022): S32, 0.1W
batt_regs = read_modbus_register('$ip', $port, $unitId, 1021, 2)
if batt_regs:
    batt_raw = (batt_regs[0] << 16) | batt_regs[1]
    if batt_raw & 0x80000000:
        batt_raw = batt_raw - 0x100000000
    batt_kw = batt_raw / 10.0 / 1000.0
    print(f"Battery Power (1021-1022): {batt_raw:10d} (0.1W) = {batt_kw:8.3f} kW  {'(Charging)' if batt_raw > 0 else '(Discharging)' if batt_raw < 0 else '(Idle)'}")

print("")
print("=== Energy Balance Check ===")
if pv_regs and grid_regs and load_regs:
    print(f"PV ({pv_kw:.3f}) + Grid ({grid_kw:.3f}) = Load ({load_kw:.3f}) + Battery ({batt_kw:.3f})")
    left = pv_kw + grid_kw
    right = load_kw + batt_kw
    balance = abs(left - right)
    print(f"Left side: {left:.3f} kW")
    print(f"Right side: {right:.3f} kW")
    print(f"Difference: {balance:.3f} kW  {'✓ Balanced' if balance < 0.1 else '✗ Imbalanced'}")
"@

# Write Python script to temp file
$pythonScriptPath = Join-Path $env:TEMP "read_modbus.py"
$pythonScript | Out-File -FilePath $pythonScriptPath -Encoding UTF8

# Try to run Python script
try {
    python $pythonScriptPath
} catch {
    Write-Host "Python not found or error occurred" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please manually check these registers in your Growatt monitoring:" -ForegroundColor Yellow
    Write-Host "  Register 1-2:     PV Power (U32, 0.1W)" -ForegroundColor Gray
    Write-Host "  Register 1021-1022: Battery Power (S32, 0.1W, +charge/-discharge)" -ForegroundColor Gray
    Write-Host "  Register 1029-1030: Grid Power (S32, 0.1W, +import/-export)" -ForegroundColor Gray
    Write-Host "  Register 1037-1038: Load Power (S32, 0.1W)" -ForegroundColor Gray
}

# Cleanup
Remove-Item $pythonScriptPath -ErrorAction SilentlyContinue
