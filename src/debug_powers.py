import time
from datetime import datetime

from pymodbus.client import ModbusTcpClient
from pymodbus.exceptions import ModbusIOException, ConnectionException

IP = "192.168.9.242"   # change if needed
PORT = 502
UNIT_ID = 1

RETRY_TIMEOUT_SEC = 10
RETRY_DELAY_SEC = 1


def robust_read_input_registers(client, addr, count):
    """Read input registers with a simple retry loop."""
    start = time.time()
    while True:
        if not client.connected:
            try:
                client.connect()
            except Exception:
                pass

        try:
            rr = client.read_input_registers(address=addr, count=count, unit=UNIT_ID)
            if (not isinstance(rr, ModbusIOException)) and (not rr.isError()):
                return rr.registers
        except (ConnectionException, OSError, Exception):
            pass

        if time.time() - start > RETRY_TIMEOUT_SEC:
            return None

        time.sleep(RETRY_DELAY_SEC)


def u32(client, addr):
    """Read unsigned 32-bit (two input registers)."""
    regs = robust_read_input_registers(client, addr, 2)
    if regs is None:
        return None
    hi, lo = regs
    return (hi << 16) | lo


def s32(client, addr):
    """Read signed 32-bit (two input registers)."""
    val = u32(client, addr)
    if val is None:
        return None
    if val & 0x80000000:
        val -= 0x100000000
    return val


def fmt_w(raw):
    """Format a raw 0.1W value."""
    if raw is None:
        return "None"
    return f"{raw} (={raw/10.0:.1f} W)"


def main():
    client = ModbusTcpClient(IP, port=PORT)
    client.connect()

    ts = datetime.now().isoformat(timespec="seconds")
    print(f"=== Debug read @ {ts} ===")

    # --- PV input power (1/2, 0.1 W) ---
    pv_raw = u32(client, 1)
    pv_w = pv_raw / 10.0 if pv_raw is not None else None

    # --- Load power: use 40/41 as main instantaneous load (0.1 W) ---
    load_40_raw = s32(client, 40)       # "watts used on load?"
    load_40_w = load_40_raw / 10.0 if load_40_raw is not None else None

    # 1037/1038: "Total power to load" (looks similar to 40/41 for you)
    load_1037_raw = s32(client, 1037)
    load_1037_w = load_1037_raw / 10.0 if load_1037_raw is not None else None

    # 1032/1033 is clearly junk on your inverter; keep for reference only
    load_1032_raw = s32(client, 1032)

    # --- Grid power candidate: 1029/1030 (0.1 W) ---
    # We assume: positive = import from grid
    grid_1029_raw = s32(client, 1029)
    grid_w = grid_1029_raw / 10.0 if grid_1029_raw is not None else None

    # --- Battery charge / discharge registers (raw from inverter) ---
    chg_116_raw = s32(client, 116)      # "charge power?"
    dis_1009_raw = s32(client, 1009)    # "Battery discharge power"

    chg_116_w = chg_116_raw / 10.0 if chg_116_raw is not None else None
    dis_1009_w = dis_1009_raw / 10.0 if dis_1009_raw is not None else None

    # --- Estimated battery power via power balance ---
    # Convention: grid_w > 0 means importing from grid
    # Power balance (ignoring losses):
    #   PV + Grid = Load + Batt_charge - Batt_discharge
    # Let Batt_net = Batt_charge - Batt_discharge (charge positive).
    # Then: Batt_net = PV + Grid - Load
    batt_net = None
    batt_chg_est = None
    batt_dis_est = None

    if pv_w is not None and load_40_w is not None and grid_w is not None:
        batt_net = pv_w + grid_w - load_40_w
        if batt_net >= 0:
            batt_chg_est = batt_net
            batt_dis_est = 0.0
        else:
            batt_chg_est = 0.0
            batt_dis_est = -batt_net

    client.close()

    # --- Print results ---
    print(f"PV (1/2) raw:           {fmt_w(pv_raw)}")

    print(f"Load 40/41 raw:         {fmt_w(load_40_raw)}  <-- preferred load power")
    print(f"Total load 1037/1038:   {fmt_w(load_1037_raw)}")

    print(f"Grid 1029/1030 raw:     {fmt_w(grid_1029_raw)}  (assumed + = import)")

    print(f"Batt CHG reg 116/117:   {fmt_w(chg_116_raw)}")
    print(f"Batt DIS reg 1009/1010: {fmt_w(dis_1009_raw)}")

    print("\nEstimated battery power (from PV + Load + Grid):")
    print(f"  Batt_net_est:         {batt_net:.1f} W (charge>0, discharge<0)" if batt_net is not None else "  Batt_net_est:         None")
    print(f"  Batt_charge_est:      {batt_chg_est:.1f} W" if batt_chg_est is not None else "  Batt_charge_est:      None")
    print(f"  Batt_discharge_est:   {batt_dis_est:.1f} W" if batt_dis_est is not None else "  Batt_discharge_est:   None")


if __name__ == "__main__":
    main()

