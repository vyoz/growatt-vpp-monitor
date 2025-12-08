#!/usr/bin/env python3
"""
Flask API server for Growatt Solar Monitor
Provides REST endpoints for real-time and historical data

Features:
- Monthly CSV archiving (persistent storage)
- Automatic multi-file query support
- Real-time Modbus polling
- Accurate kWh calculation using actual time intervals
- ZeroHero VPP earnings calculation
"""

import os
import json
import time
import csv
import glob
from datetime import datetime, timedelta
from threading import Thread, Lock
from collections import defaultdict
from flask import Flask, jsonify, request
from flask_cors import CORS
from pymodbus.client import ModbusTcpClient
from pymodbus.exceptions import ModbusIOException, ConnectionException


app = Flask(__name__)
CORS(app)  # Enable CORS for frontend access

# ---------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------
CONFIG_FILE = os.getenv('GROWATT_CONFIG', './config.json')
DEFAULT_CONFIG = {
    "modbus": {
        "ip": "192.168.9.242",
        "port": 502,
        "unit_id": 1
    },
    "polling_interval": 5,
    "history_size": 1000,
    "log_dir": "./logs",  # Directory for monthly CSV files
    "log_file": "growatt_log.csv"  # Legacy single file (optional fallback)
}

config = DEFAULT_CONFIG.copy()
if os.path.exists(CONFIG_FILE):
    with open(CONFIG_FILE, 'r') as f:
        user_config = json.load(f)
        config.update(user_config)

# Ensure log directory exists
log_dir = config.get("log_dir", "./logs")
os.makedirs(log_dir, exist_ok=True)

# Global state
current_data = {
    "timestamp": None,
    "solar": 0,
    "battery_discharge": 0,
    "grid_import": 0,
    "battery_charge": 0,
    "load": 0,
    "grid_export": 0,
    "battery_net": 0,
    "soc_inv": 0,
    "soc_bms": 0,
    "connected": False
}

historical_data = []
data_lock = Lock()

RETRY_TIMEOUT_SEC = 10
RETRY_DELAY_SEC = 0.5


# ---------------------------------------------------------------------
# ZeroHero VPP Tariff Configuration
# ---------------------------------------------------------------------
ZEROHERO_CONFIG = {
    # ZEROHERO Day Credit
    "zerohero_day_credit": 1.00,          # $/day reward
    "zerohero_window_start": 18,           # 6pm
    "zerohero_window_end": 20,             # 8pm (exclusive)
    "zerohero_import_threshold": 0.03,     # kWh/hour max import
    
    # Super Export (during 6pm-8pm only)
    "super_export_rate": 0.15,             # $/kWh (inclusive)
    "super_export_limit": 10.0,            # kWh/day max
    
    # Regular Feed-in Tariff (outside Super Export window)
    "fit_rates": {
        "peak": 0.03,        # 4pm-6pm, 8pm-9pm
        "shoulder": 0.003,   # 9pm-10am, 2pm-4pm
        "offpeak": 0.00,     # 10am-2pm
    },
}


# ---------------------------------------------------------------------
# CSV File Management (Monthly Archives)
# ---------------------------------------------------------------------
def get_monthly_log_file(dt=None):
    """Get the CSV file path for a given month (YYYY-MM format)"""
    if dt is None:
        dt = datetime.now()
    month_str = dt.strftime('%Y-%m')
    return os.path.join(log_dir, f"growatt_log_{month_str}.csv")


def get_log_files_for_date_range(start_date, end_date):
    """Get all CSV files that may contain data for the given date range"""
    files = []
    
    # Generate all months in range
    current = start_date.replace(day=1)
    end_month = end_date.replace(day=1)
    
    while current <= end_month:
        filepath = get_monthly_log_file(current)
        if os.path.exists(filepath):
            files.append(filepath)
        # Move to next month
        if current.month == 12:
            current = current.replace(year=current.year + 1, month=1)
        else:
            current = current.replace(month=current.month + 1)
    
    # Also check legacy single file
    legacy_file = config.get("log_file")
    if legacy_file and os.path.exists(legacy_file) and legacy_file not in files:
        files.append(legacy_file)
    
    return files


def get_all_log_files():
    """Get all available log files for archive listing"""
    pattern = os.path.join(log_dir, "growatt_log_*.csv")
    files = glob.glob(pattern)
    
    # Extract month info
    result = []
    for f in sorted(files):
        basename = os.path.basename(f)
        try:
            # Parse growatt_log_YYYY-MM.csv
            month_str = basename.replace("growatt_log_", "").replace(".csv", "")
            size = os.path.getsize(f)
            result.append({
                "filename": basename,
                "path": f,
                "month": month_str,
                "size_mb": round(size / (1024 * 1024), 2)
            })
        except:
            continue
    
    return result


# ---------------------------------------------------------------------
# Modbus helpers
# ---------------------------------------------------------------------
def robust_read_input_registers(client, addr, count, unit_id):
    """Read input registers with retry mechanism"""
    start = time.time()
    while True:
        if not client.connected:
            try:
                client.connect()
            except Exception:
                pass

        try:
            rr = client.read_input_registers(address=addr, count=count, unit=unit_id)
            if (not isinstance(rr, ModbusIOException)) and (not rr.isError()):
                return rr.registers
        except (ConnectionException, OSError, Exception):
            pass

        if time.time() - start > RETRY_TIMEOUT_SEC:
            return None

        time.sleep(RETRY_DELAY_SEC)


def read_u16(client, addr, unit_id):
    regs = robust_read_input_registers(client, addr, 1, unit_id)
    return None if regs is None else regs[0]


def read_u32(client, addr, unit_id):
    regs = robust_read_input_registers(client, addr, 2, unit_id)
    if regs is None:
        return None
    hi, lo = regs
    return (hi << 16) | lo


def read_s32(client, addr, unit_id):
    val = read_u32(client, addr, unit_id)
    if val is None:
        return None
    if val & 0x80000000:
        val -= 0x100000000
    return val


# ---------------------------------------------------------------------
# Data polling thread
# ---------------------------------------------------------------------
def poll_inverter():
    """Background thread to continuously poll inverter data"""
    global current_data, historical_data
    
    ip = config["modbus"]["ip"]
    port = config["modbus"]["port"]
    unit_id = config["modbus"]["unit_id"]
    interval = config["polling_interval"]
    
    client = ModbusTcpClient(ip, port=port)
    
    print(f"🔌 Starting Growatt polling: {ip}:{port}, interval={interval}s")
    
    while True:
        try:
            # Read all registers
            pv_raw = read_u32(client, 1, unit_id)
            grid_import_raw = read_u32(client, 1021, unit_id)  # Grid import from Datalogger CT
            grid_export_raw = read_u32(client, 1029, unit_id)  # Grid export from Datalogger CT
            load_raw = read_s32(client, 1037, unit_id)
            soc_inv = read_u16(client, 1014, unit_id)
            soc_bms = read_u16(client, 1086, unit_id)
            
            # Convert to kW (raw value is in 0.1W)
            pv = (pv_raw / 10.0 / 1000.0) if pv_raw is not None else 0
            grid_import = (grid_import_raw / 10.0 / 1000.0) if grid_import_raw is not None else 0
            grid_export = (grid_export_raw / 10.0 / 1000.0) if grid_export_raw is not None else 0
            load_val = (load_raw / 10.0 / 1000.0) if load_raw is not None else 0
            
            # Calculate battery power using energy balance
            # battery_net = solar + grid_import - grid_export - load
            # positive = charging, negative = discharging
            if pv is not None and load_val is not None:
                battery_net = pv + grid_import - grid_export - load_val
                battery_charge = max(battery_net, 0)
                battery_discharge = max(-battery_net, 0)
            else:
                battery_net = battery_charge = battery_discharge = 0
            
            timestamp = datetime.now().isoformat()
            
            # Update global state
            with data_lock:
                current_data.update({
                    "timestamp": timestamp,
                    "solar": round(pv, 3),
                    "battery_discharge": round(battery_discharge, 3),
                    "grid_import": round(grid_import, 3),
                    "battery_charge": round(battery_charge, 3),
                    "load": round(load_val, 3),
                    "grid_export": round(grid_export, 3),
                    "battery_net": round(battery_net, 3),
                    "soc_inv": soc_inv if soc_inv else 0,
                    "soc_bms": soc_bms if soc_bms else 0,
                    "connected": True
                })
                
                # Add to historical data
                historical_data.append(current_data.copy())
                
                # Keep only recent history
                max_history = config.get("history_size", 1000)
                if len(historical_data) > max_history:
                    historical_data.pop(0)
            
            # Log to monthly CSV file
            log_to_csv(current_data)
            
            print(f"📊 [{timestamp}] PV={pv:.2f}kW Load={load_val:.2f}kW Import={grid_import:.2f}kW Export={grid_export:.2f}kW Batt={battery_net:.2f}kW SOC={soc_bms}%")
            
        except Exception as e:
            print(f"❌ Error polling inverter: {e}")
            with data_lock:
                current_data["connected"] = False
        
        time.sleep(interval)


def log_to_csv(data):
    """Append data to monthly CSV log file"""
    filepath = get_monthly_log_file()
    file_exists = os.path.exists(filepath) and os.path.getsize(filepath) > 0
    
    with open(filepath, 'a', newline='') as f:
        fieldnames = ['timestamp', 'solar', 'load', 'grid_export', 'grid_import', 
                      'battery_charge', 'battery_discharge', 'battery_net', 
                      'soc_inv', 'soc_bms']
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        
        if not file_exists:
            writer.writeheader()
        
        writer.writerow({k: data.get(k, 0) for k in fieldnames})


def read_csv_data(filepath, start_date=None, end_date=None):
    """Read data from a CSV file with optional date filtering"""
    data = []
    try:
        with open(filepath, 'r') as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    ts = datetime.fromisoformat(row["timestamp"])
                    
                    # Apply date filter if provided
                    if start_date and ts.date() < start_date:
                        continue
                    if end_date and ts.date() > end_date:
                        continue
                    
                    data.append({
                        "timestamp": row["timestamp"],
                        "solar": float(row.get("solar", 0)),
                        "load": float(row.get("load", 0)),
                        "grid_export": float(row.get("grid_export", 0)),
                        "grid_import": float(row.get("grid_import", 0)),
                        "battery_charge": float(row.get("battery_charge", 0)),
                        "battery_discharge": float(row.get("battery_discharge", 0)),
                        "battery_net": float(row.get("battery_net", 0)),
                        "soc_inv": int(float(row.get("soc_inv", 0))),
                        "soc_bms": int(float(row.get("soc_bms", 0)))
                    })
                except (ValueError, KeyError):
                    continue
    except Exception as e:
        print(f"Error reading {filepath}: {e}")
    
    return data


# ---------------------------------------------------------------------
# ZeroHero Earnings Calculation
# ---------------------------------------------------------------------
def get_fit_period(hour):
    """
    Get Feed-in Tariff period and rate for hours OUTSIDE Super Export window.
    
    Time periods:
    - Peak: 16:00-18:00 (4pm-6pm), 20:00-21:00 (8pm-9pm)
    - Off-peak: 10:00-14:00 (10am-2pm)
    - Shoulder: All other times
    """
    rates = ZEROHERO_CONFIG["fit_rates"]
    
    if hour in [16, 17, 20]:  # 4pm-6pm, 8pm-9pm (excluding Super Export)
        return "peak", rates["peak"]
    elif 10 <= hour < 14:  # 10am-2pm
        return "offpeak", rates["offpeak"]
    else:
        return "shoulder", rates["shoulder"]


def calculate_today_earnings(target_date=None):
    """
    Calculate ZeroHero VPP earnings for a specific date (default: today).
    
    This calculates earnings from midnight to current time for today,
    or full day for past dates.
    
    Returns dict with:
    - date: Target date
    - total_export_kwh: Total energy exported
    - zerohero_day: ZEROHERO Day Credit status and amount
    - super_export: Super Export earnings (6pm-8pm)
    - regular_fit: Regular feed-in tariff earnings
    - total_earnings: Total earnings in AUD
    
    TODO: When Modbus cumulative energy registers are available,
    replace CSV calculation with direct register reads for accuracy.
    """
    if target_date is None:
        target_date = datetime.now().date()
    
    now = datetime.now()
    is_today = (target_date == now.date())
    current_hour = now.hour if is_today else 24
    
    cfg = ZEROHERO_CONFIG
    
    # Collect data points for target date
    data_points = []
    files = get_log_files_for_date_range(target_date, target_date)
    
    if files:
        for filepath in files:
            file_data = read_csv_data(filepath, target_date, target_date)
            data_points.extend(file_data)
    else:
        # Fallback to in-memory data
        with data_lock:
            for d in historical_data:
                if datetime.fromisoformat(d["timestamp"]).date() == target_date:
                    data_points.append(d.copy())
    
    # Sort by timestamp
    data_points.sort(key=lambda x: x["timestamp"])
    
    if len(data_points) < 2:
        return {
            "date": target_date.isoformat(),
            "total_export_kwh": 0,
            "zerohero_day": {
                "qualified": False,
                "credit": 0,
                "reason": "Insufficient data"
            },
            "super_export": {"export_kwh": 0, "earnings": 0},
            "regular_fit": {"export_kwh": 0, "earnings": 0},
            "total_earnings": 0,
            "data_points": len(data_points)
        }
    
    # Calculate hourly export and import
    hourly_export = defaultdict(float)
    hourly_import = defaultdict(float)
    
    for i in range(len(data_points) - 1):
        curr = data_points[i]
        next_p = data_points[i + 1]
        
        t1 = datetime.fromisoformat(curr["timestamp"])
        t2 = datetime.fromisoformat(next_p["timestamp"])
        
        # Skip if beyond current time (for today)
        if is_today and t1.hour >= current_hour:
            continue
        
        interval_sec = (t2 - t1).total_seconds()
        
        # Skip invalid intervals
        if interval_sec <= 0 or interval_sec > 600:
            continue
        
        interval_hours = interval_sec / 3600.0
        hour = t1.hour
        
        hourly_export[hour] += curr["grid_export"] * interval_hours
        hourly_import[hour] += abs(curr["grid_import"]) * interval_hours
    
    # ========== 1. ZEROHERO Day Credit Check ==========
    # For today: only show "qualified" after the entire 6pm-8pm window has passed
    zerohero_qualified = True
    zerohero_hourly_check = {}
    zerohero_window_complete = False  # True only when entire window (18,19) is done
    
    # Check if the entire zerohero window has completed
    if is_today:
        # Window is complete only after 8pm (hour >= 20)
        zerohero_window_complete = (current_hour >= cfg["zerohero_window_end"])
    else:
        # For past dates, window is always complete
        zerohero_window_complete = True
    
    # Check each hour in the window that has passed
    for hour in range(cfg["zerohero_window_start"], cfg["zerohero_window_end"]):
        if is_today and hour >= current_hour:
            # This hour hasn't completed yet
            continue
        
        import_kwh = hourly_import.get(hour, 0)
        passed = import_kwh <= cfg["zerohero_import_threshold"]
        zerohero_hourly_check[hour] = {
            "import_kwh": round(import_kwh, 4),
            "threshold": cfg["zerohero_import_threshold"],
            "passed": passed
        }
        if not passed:
            zerohero_qualified = False
    
    # Determine status
    if is_today and not zerohero_window_complete:
        # Window hasn't fully completed yet - status is pending
        zerohero_credit = 0
        zerohero_status = "pending"
    elif zerohero_qualified:
        # Window complete and all hours passed
        zerohero_credit = cfg["zerohero_day_credit"]
        zerohero_status = "qualified"
    else:
        # Window complete but failed qualification
        zerohero_credit = 0
        zerohero_status = "not_qualified"
    
    # ========== 2. Super Export (6pm-8pm only) ==========
    super_export_kwh = 0
    for hour in range(cfg["zerohero_window_start"], cfg["zerohero_window_end"]):
        if is_today and hour >= current_hour:
            continue
        super_export_kwh += hourly_export.get(hour, 0)
    
    super_export_credited = min(super_export_kwh, cfg["super_export_limit"])
    super_export_earnings = super_export_credited * cfg["super_export_rate"]
    
    # ========== 3. Regular Feed-in (outside 6pm-8pm) ==========
    regular_fit_kwh = 0
    regular_fit_earnings = 0
    
    for hour, kwh in hourly_export.items():
        # Skip Super Export window
        if cfg["zerohero_window_start"] <= hour < cfg["zerohero_window_end"]:
            continue
        # Skip future hours for today
        if is_today and hour >= current_hour:
            continue
        
        period, rate = get_fit_period(hour)
        regular_fit_kwh += kwh
        regular_fit_earnings += kwh * rate
    
    # ========== 4. Total ==========
    total_export = sum(hourly_export.values())
    total_earnings = zerohero_credit + super_export_earnings + regular_fit_earnings
    
    return {
        "date": target_date.isoformat(),
        "is_partial": is_today,
        "current_hour": current_hour if is_today else None,
        "total_export_kwh": round(total_export, 4),
        "zerohero_day": {
            "status": zerohero_status,
            "qualified": zerohero_status == "qualified",
            "credit": zerohero_credit,
            "window": "6pm-8pm",
            "hourly_check": zerohero_hourly_check
        },
        "super_export": {
            "window": "6pm-8pm",
            "export_kwh": round(super_export_kwh, 4),
            "credited_kwh": round(super_export_credited, 4),
            "rate": cfg["super_export_rate"],
            "earnings": round(super_export_earnings, 4)
        },
        "regular_fit": {
            "export_kwh": round(regular_fit_kwh, 4),
            "earnings": round(regular_fit_earnings, 4)
        },
        "total_earnings": round(total_earnings, 4),
        "data_points": len(data_points)
    }


# ---------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------
@app.route('/api/status', methods=['GET'])
def get_status():
    """Get current system status and connection state"""
    with data_lock:
        return jsonify({
            "connected": current_data["connected"],
            "timestamp": current_data["timestamp"],
            "config": {
                "ip": config["modbus"]["ip"],
                "port": config["modbus"]["port"],
                "interval": config["polling_interval"]
            }
        })


@app.route('/api/current', methods=['GET'])
def get_current():
    """Get current real-time data"""
    with data_lock:
        return jsonify(current_data)


@app.route('/api/history', methods=['GET'])
def get_history():
    """Get historical data with optional filtering"""
    limit = request.args.get('limit', type=int, default=100)
    minutes = request.args.get('minutes', type=int)
    
    with data_lock:
        data = historical_data.copy()
    
    # Filter by time range if specified
    if minutes:
        cutoff = datetime.now() - timedelta(minutes=minutes)
        data = [d for d in data if datetime.fromisoformat(d["timestamp"]) >= cutoff]
    
    # Limit number of results
    if limit and len(data) > limit:
        step = len(data) // limit
        data = data[::step]
    
    return jsonify({
        "count": len(data),
        "data": data
    })


@app.route('/api/history/range', methods=['GET'])
def get_history_range():
    """
    Get historical data for a date range from CSV logs.
    Automatically queries all relevant monthly archive files.
    
    Query parameters:
    - start_date: Start date in YYYY-MM-DD format (required)
    - end_date: End date in YYYY-MM-DD format (optional, defaults to start_date)
    - limit: Maximum number of data points to return (optional, default 500)
    
    Example: /api/history/range?start_date=2025-11-26&end_date=2025-11-26&limit=200
    """
    start_date_str = request.args.get('start_date')
    end_date_str = request.args.get('end_date', start_date_str)
    limit = request.args.get('limit', type=int, default=500)
    
    if not start_date_str:
        return jsonify({"error": "start_date is required (YYYY-MM-DD)"}), 400
    
    try:
        start_date = datetime.strptime(start_date_str, '%Y-%m-%d').date()
        end_date = datetime.strptime(end_date_str, '%Y-%m-%d').date()
    except ValueError:
        return jsonify({"error": "Invalid date format. Use YYYY-MM-DD"}), 400
    
    if end_date < start_date:
        return jsonify({"error": "end_date cannot be before start_date"}), 400
    
    # Get all relevant CSV files
    files = get_log_files_for_date_range(start_date, end_date)
    
    if not files:
        # Fallback to in-memory data
        with data_lock:
            data = [
                d for d in historical_data
                if start_date <= datetime.fromisoformat(d["timestamp"]).date() <= end_date
            ]
        return jsonify({
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "count": len(data),
            "data": data[:limit] if limit else data,
            "source": "memory"
        })
    
    # Read from all relevant CSV files
    all_data = []
    for filepath in files:
        all_data.extend(read_csv_data(filepath, start_date, end_date))
    
    # Sort by timestamp
    all_data.sort(key=lambda x: x["timestamp"])
    
    # Downsample if needed
    if limit and len(all_data) > limit:
        step = len(all_data) // limit
        all_data = all_data[::step]
    
    return jsonify({
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "count": len(all_data),
        "data": all_data,
        "source": "csv",
        "files_queried": len(files)
    })


@app.route('/api/daily', methods=['GET'])
def get_daily():
    """Calculate daily totals from historical data"""
    date_str = request.args.get('date', datetime.now().strftime('%Y-%m-%d'))
    
    try:
        target_date = datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError:
        return jsonify({"error": "Invalid date format. Use YYYY-MM-DD"}), 400
    
    daily_data = calculate_daily_totals(target_date)
    return jsonify(daily_data)


@app.route('/api/daily/range', methods=['GET'])
def get_daily_range():
    """
    Get daily totals for a date range.
    
    Query parameters:
    - start_date: Start date in YYYY-MM-DD format (required)
    - end_date: End date in YYYY-MM-DD format (optional, defaults to today)
    
    Example: /api/daily/range?start_date=2025-11-20&end_date=2025-11-26
    """
    start_date_str = request.args.get('start_date')
    end_date_str = request.args.get('end_date', datetime.now().strftime('%Y-%m-%d'))
    
    if not start_date_str:
        return jsonify({"error": "start_date is required (YYYY-MM-DD)"}), 400
    
    try:
        start_date = datetime.strptime(start_date_str, '%Y-%m-%d').date()
        end_date = datetime.strptime(end_date_str, '%Y-%m-%d').date()
    except ValueError:
        return jsonify({"error": "Invalid date format. Use YYYY-MM-DD"}), 400
    
    if end_date < start_date:
        return jsonify({"error": "end_date cannot be before start_date"}), 400
    
    # Limit to 90 days max
    if (end_date - start_date).days > 90:
        return jsonify({"error": "Date range cannot exceed 90 days"}), 400
    
    results = []
    current = start_date
    while current <= end_date:
        daily_data = calculate_daily_totals(current)
        results.append(daily_data)
        current += timedelta(days=1)
    
    return jsonify({
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "count": len(results),
        "data": results
    })


@app.route('/api/hourly', methods=['GET'])
def get_hourly():
    """
    Get hourly totals for a specific date.
    
    Query parameters:
    - date: Date in YYYY-MM-DD format (optional, defaults to today)
    
    Returns 24 data points (one per hour, 0-23) with energy totals for each hour.
    
    Example: /api/hourly?date=2025-12-08
    """
    date_str = request.args.get('date', datetime.now().strftime('%Y-%m-%d'))
    
    try:
        target_date = datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError:
        return jsonify({"error": "Invalid date format. Use YYYY-MM-DD"}), 400
    
    hourly_data = calculate_hourly_totals(target_date)
    return jsonify({
        "date": target_date.isoformat(),
        "count": len(hourly_data),
        "data": hourly_data
    })


def calculate_hourly_totals(target_date):
    """
    Calculate hourly totals for a specific date.
    
    Returns a list of 24 dictionaries (one per hour) with energy totals.
    Uses actual time intervals for accurate kWh calculation.
    """
    # Initialize hourly buckets (0-23)
    hourly = []
    for hour in range(24):
        hourly.append({
            "hour": hour,
            "hour_label": f"{hour:02d}:00",
            "solar_kwh": 0,
            "load_kwh": 0,
            "grid_export_kwh": 0,
            "grid_import_kwh": 0,
            "battery_charge_kwh": 0,
            "battery_discharge_kwh": 0,
            "count": 0
        })
    
    # Collect all data for the target date
    data_points = []
    files = get_log_files_for_date_range(target_date, target_date)
    
    if files:
        for filepath in files:
            file_data = read_csv_data(filepath, target_date, target_date)
            data_points.extend(file_data)
    else:
        # Fallback to in-memory data
        with data_lock:
            for d in historical_data:
                if datetime.fromisoformat(d["timestamp"]).date() == target_date:
                    data_points.append(d.copy())
    
    # Sort by timestamp
    data_points.sort(key=lambda x: x["timestamp"])
    
    if len(data_points) < 2:
        return hourly
    
    # Calculate using actual time intervals
    for i in range(len(data_points) - 1):
        current = data_points[i]
        next_point = data_points[i + 1]
        
        t1 = datetime.fromisoformat(current["timestamp"])
        t2 = datetime.fromisoformat(next_point["timestamp"])
        
        interval_sec = (t2 - t1).total_seconds()
        
        # Skip invalid intervals (> 10 minutes or negative)
        if interval_sec <= 0 or interval_sec > 600:
            continue
        
        interval_hours = interval_sec / 3600.0
        hour = t1.hour
        
        # Accumulate energy for this hour
        hourly[hour]["solar_kwh"] += current["solar"] * interval_hours
        hourly[hour]["load_kwh"] += current["load"] * interval_hours
        hourly[hour]["grid_export_kwh"] += current["grid_export"] * interval_hours
        hourly[hour]["grid_import_kwh"] += abs(current["grid_import"]) * interval_hours
        hourly[hour]["battery_charge_kwh"] += current["battery_charge"] * interval_hours
        hourly[hour]["battery_discharge_kwh"] += current["battery_discharge"] * interval_hours
        hourly[hour]["count"] += 1
    
    # Round all values
    for h in hourly:
        h["solar_kwh"] = round(h["solar_kwh"], 3)
        h["load_kwh"] = round(h["load_kwh"], 3)
        h["grid_export_kwh"] = round(h["grid_export_kwh"], 3)
        h["grid_import_kwh"] = round(h["grid_import_kwh"], 3)
        h["battery_charge_kwh"] = round(h["battery_charge_kwh"], 3)
        h["battery_discharge_kwh"] = round(h["battery_discharge_kwh"], 3)
    
    return hourly


def calculate_daily_totals(target_date):
    """
    Calculate daily totals from CSV files or memory.
    
    Uses ACTUAL time intervals between consecutive data points for accurate
    kWh calculation, instead of assuming a fixed polling interval.
    
    Energy (kWh) = Power (kW) × Time (hours)
    
    For each pair of consecutive readings, we use the first reading's power
    multiplied by the actual time elapsed until the next reading.
    """
    totals = {
        "date": target_date.isoformat(),
        "solar_kwh": 0,
        "load_kwh": 0,
        "grid_export_kwh": 0,
        "grid_import_kwh": 0,
        "battery_charge_kwh": 0,
        "battery_discharge_kwh": 0,
        "count": 0,
        "avg_interval_sec": 0  # For debugging
    }
    
    # Collect all data for the target date
    data_points = []
    
    # Get relevant CSV file(s)
    files = get_log_files_for_date_range(target_date, target_date)
    
    if files:
        for filepath in files:
            file_data = read_csv_data(filepath, target_date, target_date)
            data_points.extend(file_data)
    else:
        # Fallback to in-memory data
        with data_lock:
            for d in historical_data:
                if datetime.fromisoformat(d["timestamp"]).date() == target_date:
                    data_points.append(d.copy())
    
    # Sort by timestamp to ensure correct order
    data_points.sort(key=lambda x: x["timestamp"])
    
    totals["count"] = len(data_points)
    
    if len(data_points) < 2:
        # Not enough data points to calculate intervals
        return totals
    
    # Calculate using actual time intervals
    total_interval_sec = 0
    interval_count = 0
    
    for i in range(len(data_points) - 1):
        current = data_points[i]
        next_point = data_points[i + 1]
        
        # Calculate actual time interval
        t1 = datetime.fromisoformat(current["timestamp"])
        t2 = datetime.fromisoformat(next_point["timestamp"])
        interval_sec = (t2 - t1).total_seconds()
        
        # Skip if interval is unreasonably large (e.g., > 10 minutes = gap in data)
        # or negative (data ordering issue)
        if interval_sec <= 0 or interval_sec > 600:
            continue
        
        interval_hours = interval_sec / 3600.0
        
        # Accumulate energy using current point's power × time interval
        totals["solar_kwh"] += current["solar"] * interval_hours
        totals["load_kwh"] += current["load"] * interval_hours
        totals["grid_export_kwh"] += current["grid_export"] * interval_hours
        totals["grid_import_kwh"] += abs(current["grid_import"]) * interval_hours
        totals["battery_charge_kwh"] += current["battery_charge"] * interval_hours
        totals["battery_discharge_kwh"] += current["battery_discharge"] * interval_hours
        
        total_interval_sec += interval_sec
        interval_count += 1
    
    # Calculate average interval for debugging
    if interval_count > 0:
        totals["avg_interval_sec"] = round(total_interval_sec / interval_count, 1)
    
    # Round all kWh values to 2 decimal places
    totals["solar_kwh"] = round(totals["solar_kwh"], 2)
    totals["load_kwh"] = round(totals["load_kwh"], 2)
    totals["grid_export_kwh"] = round(totals["grid_export_kwh"], 2)
    totals["grid_import_kwh"] = round(totals["grid_import_kwh"], 2)
    totals["battery_charge_kwh"] = round(totals["battery_charge_kwh"], 2)
    totals["battery_discharge_kwh"] = round(totals["battery_discharge_kwh"], 2)
    
    return totals


# ---------------------------------------------------------------------
# Earnings API endpoints
# ---------------------------------------------------------------------
@app.route('/api/earnings/today', methods=['GET'])
def get_earnings_today():
    """
    Get ZeroHero VPP earnings for today (from midnight to now).
    
    Returns earnings breakdown including:
    - ZEROHERO Day Credit ($1/day if qualified)
    - Super Export (6pm-8pm window)
    - Regular Feed-in Tariff
    
    Example response:
    {
        "date": "2025-12-03",
        "is_partial": true,
        "total_export_kwh": 15.5,
        "zerohero_day": {"status": "pending", "credit": 0},
        "super_export": {"export_kwh": 0.5, "earnings": 0.075},
        "regular_fit": {"export_kwh": 15.0, "earnings": 0.045},
        "total_earnings": 0.12
    }
    """
    earnings = calculate_today_earnings()
    return jsonify(earnings)


@app.route('/api/earnings', methods=['GET'])
def get_earnings():
    """
    Get ZeroHero VPP earnings for a specific date.
    
    Query parameters:
    - date: Date in YYYY-MM-DD format (optional, defaults to today)
    
    Example: /api/earnings?date=2025-12-02
    """
    date_str = request.args.get('date', datetime.now().strftime('%Y-%m-%d'))
    
    try:
        target_date = datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError:
        return jsonify({"error": "Invalid date format. Use YYYY-MM-DD"}), 400
    
    earnings = calculate_today_earnings(target_date)
    return jsonify(earnings)


@app.route('/api/earnings/range', methods=['GET'])
def get_earnings_range():
    """
    Get ZeroHero VPP earnings for a date range.
    
    Query parameters:
    - start_date: Start date in YYYY-MM-DD format (required)
    - end_date: End date in YYYY-MM-DD format (optional, defaults to today)
    
    Example: /api/earnings/range?start_date=2025-11-28&end_date=2025-12-03
    """
    start_date_str = request.args.get('start_date')
    end_date_str = request.args.get('end_date', datetime.now().strftime('%Y-%m-%d'))
    
    if not start_date_str:
        return jsonify({"error": "start_date is required (YYYY-MM-DD)"}), 400
    
    try:
        start_date = datetime.strptime(start_date_str, '%Y-%m-%d').date()
        end_date = datetime.strptime(end_date_str, '%Y-%m-%d').date()
    except ValueError:
        return jsonify({"error": "Invalid date format. Use YYYY-MM-DD"}), 400
    
    if end_date < start_date:
        return jsonify({"error": "end_date cannot be before start_date"}), 400
    
    if (end_date - start_date).days > 90:
        return jsonify({"error": "Date range cannot exceed 90 days"}), 400
    
    results = []
    total_earnings = 0
    current = start_date
    
    while current <= end_date:
        earnings = calculate_today_earnings(current)
        results.append(earnings)
        total_earnings += earnings.get("total_earnings", 0)
        current += timedelta(days=1)
    
    return jsonify({
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "count": len(results),
        "total_earnings": round(total_earnings, 4),
        "data": results
    })


@app.route('/api/archives', methods=['GET'])
def get_archives():
    """List all available archive files"""
    archives = get_all_log_files()
    total_size = sum(a["size_mb"] for a in archives)
    
    return jsonify({
        "archives": archives,
        "total_files": len(archives),
        "total_size_mb": round(total_size, 2)
    })


@app.route('/api/config', methods=['GET', 'POST'])
def manage_config():
    """Get or update configuration"""
    global config
    
    if request.method == 'GET':
        return jsonify(config)
    
    elif request.method == 'POST':
        new_config = request.json
        config.update(new_config)
        
        # Save to file
        with open(CONFIG_FILE, 'w') as f:
            json.dump(config, f, indent=2)
        
        return jsonify({"message": "Configuration updated", "config": config})


# ---------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------
if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=5000)
    args = parser.parse_args()
    
    # Start polling thread
    polling_thread = Thread(target=poll_inverter, daemon=True)
    polling_thread.start()
    
    # Start Flask server
    port = int(os.getenv('PORT', args.port))
    print(f"🚀 Starting Flask API server on port {port}")
    print(f"📁 Log directory: {log_dir}")
    print(f"📊 Archives: {len(get_all_log_files())} files")
    print(f"💰 ZeroHero earnings API: /api/earnings/today")
    app.run(host='0.0.0.0', port=port, debug=False)
