import time
from pymodbus.client import ModbusTcpClient
from pymodbus.exceptions import ModbusIOException, ConnectionException

IP = "192.168.9.242"
PORT = 502
UNIT_ID = 1  # 你的 SPH 默认 1

RETRY_TIMEOUT_SEC = 30
RETRY_DELAY_SEC = 1


def robust_read_input_registers(client, addr, count):
    """
    可靠读取 Input Registers:
    - 失败时等待一小会儿再重试
    - 累计超过 RETRY_TIMEOUT_SEC 仍失败则返回 None
    """
    start = time.time()
    while True:
        # 如果连接断了，尝试重连
        if not client.connected:
            try:
                client.connect()
            except Exception:
                # 连接失败也当作一次失败
                pass

        try:
            rr = client.read_input_registers(address=addr, count=count, unit=UNIT_ID)
            if (not isinstance(rr, ModbusIOException)) and (not rr.isError()):
                return rr.registers
        except (ConnectionException, OSError, Exception):
            # 这里捕获连接异常/网络异常，不直接抛出
            pass

        # 检查超时
        if time.time() - start > RETRY_TIMEOUT_SEC:
            return None

        time.sleep(RETRY_DELAY_SEC)


def read_input_u32(client, addr):
    regs = robust_read_input_registers(client, addr, 2)
    if regs is None:
        return None
    hi, lo = regs
    return (hi << 16) | lo


def read_input_s32(client, addr):
    val = read_input_u32(client, addr)
    if val is None:
        return None
    if val & 0x80000000:
        val -= 0x100000000
    return val


def read_input_u16(client, addr):
    regs = robust_read_input_registers(client, addr, 1)
    if regs is None:
        return None
    return regs[0]


def main():
    client = ModbusTcpClient(IP, port=PORT)
    if not client.connect():
        print("Modbus 连接失败，稍后再试。")
        return

    try:
        # === PV 输入功率 reg 1/2 ===
        pv_raw = read_input_u32(client, 1)
        if pv_raw is None:
            print("PV 输入功率: 读取失败（超过重试时间）")
            pv = None
        else:
            pv = pv_raw / 10.0
            print(f"PV 输入功率: {pv:.1f} W")

        # === 电网功率 reg 1029/1030 ===
        grid_raw = read_input_s32(client, 1029)
        if grid_raw is None:
            print("电网功率: 读取失败（超过重试时间）")
            grid = None
        else:
            grid = grid_raw / 10.0
            print(f"电网功率: {grid:.1f} W  (正=取电, 负=回馈)")

        # === 负载功率 reg 1037/1038 ===
        load_raw = read_input_s32(client, 1037)
        if load_raw is None:
            print("负载功率: 读取失败（超过重试时间）")
            load = None
        else:
            load = load_raw / 10.0
            print(f"负载功率: {load:.1f} W")

        # === 电池功率（通过能量平衡推算） ===
        if pv is not None and load is not None and grid is not None:
            batt_power = pv - load + grid
            if batt_power >= 0:
                charge = batt_power
                discharge = 0
            else:
                charge = 0
                discharge = -batt_power
            print(f"电池充电: {charge:.1f} W")
            print(f"电池放电: {discharge:.1f} W")
            print(f"--> 电池净功率: {batt_power:.1f} W")
        else:
            print("电池功率: 因为部分功率寄存器读取失败，暂时无法计算")

        # === 逆变器 SOC (1014) & 电池电压(1013) ===
        soc_block = robust_read_input_registers(client, 1013, 4)
        if soc_block is None:
            print("\n逆变器 SOC (1014): 读取失败（超过重试时间）")
        else:
            batt_volt_raw = soc_block[0]  # 1013
            soc_inv = soc_block[1]        # 1014
            # batt_volt 的缩放按你寄存器文档决定：有的要 /10，有的是 V 直接值
            print(f"\n电池电压 (1013): {batt_volt_raw} (请根据文档判断是否 /10)")
            print(f"逆变器 SOC (1014): {soc_inv} %")

        # === BMS SOC (1086) ===
        soc_bms_val = read_input_u16(client, 1086)
        if soc_bms_val is None:
            print("BMS SOC (1086): 读取失败（超过重试时间）")
        else:
            print(f"BMS SOC      (1086): {soc_bms_val} %")

    finally:
        client.close()


if __name__ == "__main__":
    main()

