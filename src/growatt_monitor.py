import os
import json
import time
import csv
import argparse
from datetime import datetime

from pymodbus.client import ModbusTcpClient
from pymodbus.exceptions import ModbusIOException, ConnectionException


# ---------------------------------------------------------------------
# Default configuration (used if no config file is found)
# ---------------------------------------------------------------------
DEFAULT_CONFIG = {
    "modbus": {
        "ip": "192.168.1.50",
        "port": 502,
        "unit_id": 1
    },
    "interval_seconds": 30,
    "output": {
        "mode": "log",    # options: log | mqtt | both
        "log_file": "growatt_log.csv",
        "mqtt": {
            "enabled": False,
            "host": "127.0.0.1",
            "port": 1883,
            "username": "",
            "password": "",
            "topic_prefix": "home/growatt"
        }
    }
}

# Where to search config.json automatically
CONFIG_SEARCH_PATHS = [
    "./config.json",
    "/etc/growatt-monitor/config.json"
]

RETRY_TIMEOUT_SEC = 30
RETRY_DELAY_SEC = 1


# ---------------------------------------------------------------------
# Merge two dictionaries (recursive)
# ---------------------------------------------------------------------
def deep_merge_dict(base, override):
    result = dict(base)
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(result.get(k), dict):
            result[k] = deep_merge_dict(result[k], v)
        else:
            result[k] = v
    return result


# ---------------------------------------------------------------------
# Load configuration (command-line override available)
# ---------------------------------------------------------------------
def load_config_from_paths(cmd_path=None):
    cfg = DEFAULT_CONFIG.copy()

    # 1) Highest priority: command-line file
    if cmd_path:
        if os.path.exists(cmd_path):
            with open(cmd_path, "r", encoding="utf-8") as f:
                user_cfg = json.load(f)
            cfg = deep_merge_dict(cfg, user_cfg)
            print(f"✔ Using config file: {cmd_path}")
            return cfg
        else:
            print(f"⚠ Config file not found: {cmd_path}, continue searching...")

    # 2) Search predefined locations
    for path in CONFIG_SEARCH_PATHS:
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    user_cfg = json.load(f)
                cfg = deep_merge_dict(cfg, user_cfg)
                print(f"✔ Using config file: {path}")
                return cfg
            except Exception as e:
                print(f"⚠ Failed to load {path}: {e}")

    # 3) Use defaults
    print("⚠ No config file found. Using default configuration.")
    return cfg


# ---------------------------------------------------------------------
# Modbus reading with retry mechanism (up to 30 seconds)
# ---------------------------------------------------------------------
def robust_read_input_registers(client, addr, count, unit_id):
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

        # Timeout exceeded
        if time.time() - start > RETRY_TIMEOUT_SEC:
            return None

        time.sleep(RETRY_DELAY_SEC)


def read_input_u32(client, addr, unit_id):
    regs = robust_read_input_registers(client, addr, 2, unit_id)
    if regs is None:
        return None
    hi, lo = regs
    return (hi << 16) | lo


def read_input_s32(client, addr, unit_id):
    v = read_input_u32(client, addr, unit_id)
    if v is None:
        return None
    if v & 0x80000000:
        v -= 0x100000000
    return v


def read_input_u16(client, addr, unit_id):
    regs = robust_read_input_registers(client, addr, 1, unit_id)
    return None if regs is None else regs[0]


# ---------------------------------------------------------------------
# Logging utilities
# ---------------------------------------------------------------------
LOG_HEADER = [
    "timestamp",
    "pv_w",
    "load_w",
    "grid_w",
    "battery_charge_w",
    "battery_discharge_w",
    "battery_net_w",
    "soc_inv_percent",
    "soc_bms_percent"
]


def ensure_log_header(path):
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        with open(path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(LOG_HEADER)
        print(f"✔ Created log file with header: {path}")


def append_log_row(path, row):
    with open(path, "a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(row)


# ---------------------------------------------------------------------
# MQTT support
# ---------------------------------------------------------------------
class MQTTClientWrapper:
    def __init__(self, cfg):
        self.enabled = cfg.get("enabled", False)
        self.host = cfg.get("host", "127.0.0.1")
        self.port = cfg.get("port", 1883)
        self.username = cfg.get("username") or None
        self.password = cfg.get("password") or None
        self.topic_prefix = cfg.get("topic_prefix", "home/growatt")
        self.client = None
        self.available = False

        if not self.enabled:
            return

        try:
            import paho.mqtt.client as mqtt
            self.client = mqtt.Client()
            if self.username:
                self.client.username_pw_set(self.username, self.password or "")
            self.client.connect(self.host, self.port, keepalive=60)
            self.available = True
            print(f"✔ MQTT connected: {self.host}:{self.port}")
        except Exception as e:
            print(f"⚠ MQTT init failed: {e}")

    def publish_metrics(self, metrics: dict):
        if not (self.enabled and self.available):
            return

        try:
            for key, value in metrics.items():
                topic = f"{self.topic_prefix}/{key}"
                payload = "NA" if value is None else str(value)
                self.client.publish(topic, payload, qos=0, retain=False)
        except Exception as e:
            print(f"⚠ MQTT publish failed: {e}")


# ---------------------------------------------------------------------
# Main monitoring loop
# ---------------------------------------------------------------------
def main():
    # Command-line argument parsing
    parser = argparse.ArgumentParser(description="Growatt SPH Monitor")
    parser.add_argument("-c", "--config", help="Specify config file path", default=None)
    args = parser.parse_args()

    cfg = load_config_from_paths(args.config)

    ip = cfg["modbus"]["ip"]
    port = cfg["modbus"]["port"]
    unit_id = cfg["modbus"]["unit_id"]
    interval = cfg.get("interval_seconds", 30)

    output_mode = cfg["output"].get("mode", "log")
    log_path = cfg["output"].get("log_file", "growatt_log.csv")
    mqtt_cfg = cfg["output"].get("mqtt", {})

    mqtt_client = MQTTClientWrapper(mqtt_cfg)

    if output_mode in ("log", "both"):
        ensure_log_header(log_path)

    client = ModbusTcpClient(ip, port=port)

    print(f"Growatt Monitor started. Sampling every {interval} seconds...")
    print(f"Modbus: {ip}:{port}, UnitID={unit_id}")
    print(f"Output mode: {output_mode}")
    print("----------------------------------------------")

    try:
        while True:
            ts = datetime.now().isoformat(timespec="seconds")

            # PV
            pv_raw = read_input_u32(client, 1, unit_id)
            pv = pv_raw / 10.0 if pv_raw is not None else None

            # Grid
            grid_raw = read_input_s32(client, 1029, unit_id)
            grid = grid_raw / 10.0 if grid_raw is not None else None

            # Load
            load_raw = read_input_s32(client, 1037, unit_id)
            load = load_raw / 10.0 if load_raw is not None else None

            # Battery (energy balance)
            if pv is not None and load is not None and grid is not None:
                net = pv - load + grid
                charge = max(net, 0)
                discharge = max(-net, 0)
            else:
                net = charge = discharge = None

            # SOC
            soc_inv = read_input_u16(client, 1014, unit_id)
            soc_bms = read_input_u16(client, 1086, unit_id)

            # Print summary line
            print(
                f"[{ts}] PV={pv}W  Load={load}W  Grid={grid}W  "
                f"BattChg={charge}W  BattDis={discharge}W  "
                f"SOC(inv/BMS)= {soc_inv}/{soc_bms}"
            )

            # Log to CSV
            if output_mode in ("log", "both"):
                row = [
                    ts, pv, load, grid,
                    charge, discharge, net,
                    soc_inv, soc_bms
                ]
                append_log_row(log_path, row)

            # Publish MQTT
            if output_mode in ("mqtt", "both"):
                metrics = {
                    "pv_w": pv,
                    "load_w": load,
                    "grid_w": grid,
                    "battery_charge_w": charge,
                    "battery_discharge_w": discharge,
                    "battery_net_w": net,
                    "soc_inv_percent": soc_inv,
                    "soc_bms_percent": soc_bms
                }
                mqtt_client.publish_metrics(metrics)

            time.sleep(interval)

    except KeyboardInterrupt:
        print("\nUser interrupted. Exiting...")
    finally:
        client.close()


if __name__ == "__main__":
    main()

