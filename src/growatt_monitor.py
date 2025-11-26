import os
import json
import time
import csv
from datetime import datetime

from pymodbus.client import ModbusTcpClient
from pymodbus.exceptions import ModbusIOException, ConnectionException

# -----------------------
# 默认配置
# -----------------------
DEFAULT_CONFIG = {
    "modbus": {
        "ip": "192.168.9.242",
        "port": 502,
        "unit_id": 1
    },
    "interval_seconds": 30,
    "output": {
        "mode": "log",  # "log" | "mqtt" | "both"
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

RETRY_TIMEOUT_SEC = 30
RETRY_DELAY_SEC = 1

# -----------------------
# 配置加载
# -----------------------
def load_config(path="config.json"):
    cfg = DEFAULT_CONFIG.copy()

    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                user_cfg = json.load(f)
            # 简单递归合并
            cfg = deep_merge_dict(cfg, user_cfg)
            print(f"加载配置文件 {path} 成功")
        except Exception as e:
            print(f"加载配置文件 {path} 失败，使用默认配置: {e}")
    else:
        print(f"未找到 {path}，使用默认配置")

    return cfg


def deep_merge_dict(base, override):
    """简易递归合并 dict：override 覆盖 base"""
    result = dict(base)
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(result.get(k), dict):
            result[k] = deep_merge_dict(result[k], v)
        else:
            result[k] = v
    return result


# -----------------------
# Modbus 读函数（带重试）
# -----------------------
def robust_read_input_registers(client, addr, count, unit_id):
    """
    可靠读取 Input Registers:
    - 失败时等待一小会儿再重试
    - 累计超过 RETRY_TIMEOUT_SEC 仍失败则返回 None
    """
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


def read_input_u32(client, addr, unit_id):
    regs = robust_read_input_registers(client, addr, 2, unit_id)
    if regs is None:
        return None
    hi, lo = regs
    return (hi << 16) | lo


def read_input_s32(client, addr, unit_id):
    val = read_input_u32(client, addr, unit_id)
    if val is None:
        return None
    if val & 0x80000000:
        val -= 0x100000000
    return val


def read_input_u16(client, addr, unit_id):
    regs = robust_read_input_registers(client, addr, 1, unit_id)
    if regs is None:
        return None
    return regs[0]


# -----------------------
# 日志写入
# -----------------------
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
    exists = os.path.exists(path)
    if not exists or os.path.getsize(path) == 0:
        # 创建并写 header
        with open(path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(LOG_HEADER)
        print(f"日志文件 {path} 已创建并写入表头")


def append_log_row(path, row):
    with open(path, "a", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(row)


# -----------------------
# MQTT 相关（可选）
# -----------------------
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

        if self.enabled:
            try:
                import paho.mqtt.client as mqtt
                self.client = mqtt.Client()
                if self.username is not None:
                    self.client.username_pw_set(self.username, self.password or "")
                self.client.connect(self.host, self.port, keepalive=60)
                self.available = True
                print(f"MQTT 已启用，连接到 {self.host}:{self.port}")
            except ImportError:
                print("未安装 paho-mqtt，MQTT 功能不可用（pip install paho-mqtt）。")
            except Exception as e:
                print(f"MQTT 连接失败: {e}")

    def publish_metrics(self, metrics: dict):
        if not (self.enabled and self.available and self.client):
            return

        try:
            for key, value in metrics.items():
                topic = f"{self.topic_prefix}/{key}"
                payload = "NA" if value is None else str(value)
                self.client.publish(topic, payload, qos=0, retain=False)
        except Exception as e:
            print(f"MQTT 发布失败: {e}")


# -----------------------
# 主循环
# -----------------------
def main():
    cfg = load_config("config.json")

    ip = cfg["modbus"]["ip"]
    port = cfg["modbus"]["port"]
    unit_id = cfg["modbus"]["unit_id"]
    interval = cfg.get("interval_seconds", 30)

    output_mode = cfg["output"].get("mode", "log").lower()
    log_path = cfg["output"].get("log_file", "growatt_log.csv")
    mqtt_cfg = cfg["output"].get("mqtt", {})
    mqtt_client = MQTTClientWrapper(mqtt_cfg)

    if output_mode in ("log", "both"):
        ensure_log_header(log_path)

    client = ModbusTcpClient(ip, port=port)
    if not client.connect():
        print(f"首次连接 Modbus 失败：{ip}:{port}，但循环中会继续尝试重连。")

    print(f"开始循环监控，每 {interval} 秒采集一次... (Ctrl+C 结束)")

    try:
        while True:
            loop_start = time.time()
            timestamp = datetime.now().isoformat(timespec="seconds")

            # 1) PV
            pv_raw = read_input_u32(client, 1, unit_id)
            pv = pv_raw / 10.0 if pv_raw is not None else None

            # 2) grid
            grid_raw = read_input_s32(client, 1029, unit_id)
            grid = grid_raw / 10.0 if grid_raw is not None else None

            # 3) load
            load_raw = read_input_s32(client, 1037, unit_id)
            load = load_raw / 10.0 if load_raw is not None else None

            # 4) battery power (via power balance)
            if pv is not None and load is not None and grid is not None:
                batt_net = pv - load + grid
                if batt_net >= 0:
                    batt_charge = batt_net
                    batt_discharge = 0.0
                else:
                    batt_charge = 0.0
                    batt_discharge = -batt_net
            else:
                batt_net = batt_charge = batt_discharge = None

            # 5) SOC (1014) & BMS SOC (1086)
            soc_inv = read_input_u16(client, 1014, unit_id)
            soc_bms = read_input_u16(client, 1086, unit_id)

            # --- 打印一行状态 ---
            def fmt(v, unit="W"):
                if v is None:
                    return "NA"
                if unit == "W":
                    return f"{v:.0f}W"
                return str(v)

            line = (
                f"[{timestamp}] "
                f"PV={fmt(pv)} "
                f"Load={fmt(load)} "
                f"Grid={fmt(grid)} "
                f"BattChg={fmt(batt_charge)} "
                f"BattDis={fmt(batt_discharge)} "
                f"SOC(inv/BMS)={soc_inv if soc_inv is not None else 'NA'}%"
                f"/{soc_bms if soc_bms is not None else 'NA'}%"
            )
            print(line)

            # --- 日志 ---
            if output_mode in ("log", "both"):
                row = [
                    timestamp,
                    f"{pv:.1f}" if pv is not None else "",
                    f"{load:.1f}" if load is not None else "",
                    f"{grid:.1f}" if grid is not None else "",
                    f"{batt_charge:.1f}" if batt_charge is not None else "",
                    f"{batt_discharge:.1f}" if batt_discharge is not None else "",
                    f"{batt_net:.1f}" if batt_net is not None else "",
                    soc_inv if soc_inv is not None else "",
                    soc_bms if soc_bms is not None else "",
                ]
                try:
                    append_log_row(log_path, row)
                except Exception as e:
                    print(f"写日志失败: {e}")

            # --- MQTT ---
            if output_mode in ("mqtt", "both"):
                metrics = {
                    "pv_w": pv,
                    "load_w": load,
                    "grid_w": grid,
                    "battery_charge_w": batt_charge,
                    "battery_discharge_w": batt_discharge,
                    "battery_net_w": batt_net,
                    "soc_inv_percent": soc_inv,
                    "soc_bms_percent": soc_bms,
                }
                mqtt_client.publish_metrics(metrics)

            # --- 控制采样周期 ---
            elapsed = time.time() - loop_start
            sleep_time = max(0, interval - elapsed)
            time.sleep(sleep_time)

    except KeyboardInterrupt:
        print("\n用户中断，退出监控。")
    finally:
        client.close()


if __name__ == "__main__":
    main()

