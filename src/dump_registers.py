#!/usr/bin/env python3
"""
Dump all register values defined in registers.md (Growatt SPH, 8none1/growatt_sph_nodered).

- Supports the actual format in registers.md, including lines like:
    - 15 - Read/Set LCD panel language (1 = English)
    - 23 -> 27 - Serial number
    - 40 & 41 - watts used on load?
    - 1023, 1024, 1025 - Batt #6 start, stop, on/off
    - 1108 > 1123 - Cell N voltage

- Uses:
    * "Holding Regs 03" section as FC=03
    * "Input Regs 04" section as FC=04

- By default, reads from registers.md in the current directory,
  but you can pass --file to specify a different path.
"""

import re
import os
import sys
import time
import argparse
from dataclasses import dataclass
from typing import List, Optional

from pymodbus.client import ModbusTcpClient
from pymodbus.exceptions import ModbusIOException, ConnectionException


# ---------------------------------------------------------------------
# Default Modbus config
# ---------------------------------------------------------------------
DEFAULT_IP = "192.168.9.242"   # change if needed
DEFAULT_PORT = 502
DEFAULT_UNIT_ID = 1

RETRY_TIMEOUT_SEC = 10
RETRY_DELAY_SEC = 0.5


@dataclass
class RegDef:
    fc: int          # 3 = holding, 4 = input
    start: int       # first register
    end: int         # last register (inclusive)
    desc: str        # description text from registers.md


# ---------------------------------------------------------------------
# Modbus helpers
# ---------------------------------------------------------------------
def robust_read_registers(
    client: ModbusTcpClient,
    fc: int,
    addr: int,
    count: int,
    unit_id: int,
) -> Optional[list[int]]:
    """
    Read holding (03) or input (04) registers with a simple retry loop.
    Returns a list of register values or None if it fails.
    """
    start_ts = time.time()
    while True:
        if not client.connected:
            try:
                client.connect()
            except Exception:
                pass

        try:
            if fc == 3:
                rr = client.read_holding_registers(address=addr, count=count, unit=unit_id)
            else:
                rr = client.read_input_registers(address=addr, count=count, unit=unit_id)

            if (not isinstance(rr, ModbusIOException)) and (not rr.isError()):
                return rr.registers
        except (ConnectionException, OSError, Exception):
            pass

        if time.time() - start_ts > RETRY_TIMEOUT_SEC:
            return None

        time.sleep(RETRY_DELAY_SEC)


# ---------------------------------------------------------------------
# registers.md parsing
# ---------------------------------------------------------------------

def parse_address_segment(seg: str) -> Optional[tuple[int, int]]:
    """
    Parse the "address part" of a line, e.g.:

      "15"
      "23 -> 27"
      "40 & 41"
      "1023, 1024, 1025"
      "1108 > 1123"
      "1001,1002,1003,1004,1005,1006, 1007,1008"

    Returns (start, end) inclusive, or None if nothing valid is found.
    We treat comma-separated lists as a block from min..max.
    """
    seg = seg.strip()
    if not seg:
        return None

    # Normalize symbols:
    # - treat "->" and ">" as range indicators
    # - treat "&" as another way to list two related registers
    normalized = seg.replace("->", "-").replace(">", "-").replace("&", ",")

    # Now we have something like:
    #   "23 - 27"
    #   "1023, 1024, 1025"
    #   "1108 - 1123"
    #   "1001,1002,1003"
    #   "15"
    # First split by comma to handle explicit lists.
    tokens = []
    for part in normalized.split(","):
        part = part.strip()
        if not part:
            continue
        tokens.append(part)

    if not tokens:
        return None

    addrs: list[int] = []

    for tok in tokens:
        # range like "23 - 27"
        if "-" in tok:
            parts = [p.strip() for p in tok.split("-") if p.strip()]
            if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
                a1 = int(parts[0])
                a2 = int(parts[1])
                addrs.append(a1)
                addrs.append(a2)
            elif len(parts) == 1 and parts[0].isdigit():
                addrs.append(int(parts[0]))
            # if funky, ignore
        else:
            # single address
            # must start with digit(s)
            if tok.isdigit():
                addrs.append(int(tok))

    if not addrs:
        return None

    start = min(addrs)
    end = max(addrs)
    return (start, end)


def parse_registers_md(path: str) -> List[RegDef]:
    """
    Parse registers.md into a list of RegDef entries.

    We identify sections by lines containing:
      "holding regs 03"  -> FC=3
      "input regs 04"    -> FC=4

    Then parse list lines starting with "- " followed by an address segment.
    """
    if not os.path.exists(path):
        print(f"ERROR: registers file not found: {path}")
        sys.exit(1)

    regs: List[RegDef] = []
    current_fc: Optional[int] = None

    with open(path, "r", encoding="utf-8") as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line:
                continue

            lower = line.lower()

            # Section switching (ignore markdown "#" etc.)
            if "holding regs 03" in lower:
                current_fc = 3
                continue
            if "input regs 04" in lower:
                current_fc = 4
                continue

            if current_fc is None:
                continue  # skip anything before we know FC

            # We care mainly about bullet lines like "- 15 - something"
            if not line.lstrip().startswith("-"):
                continue

            # Drop leading "-" / "*" and whitespace
            content = line.lstrip("-* ").strip()
            if not content:
                continue

            # Split into "address segment" + "description"
            # Try to split on " - " first, then " = ", else first whitespace.
            addr_seg = ""
            desc = ""

            # Prefer " - " as delimiter (most common)
            if " - " in content:
                parts = content.split(" - ", 1)
                addr_seg, desc = parts[0].strip(), parts[1].strip()
            elif " = " in content:
                parts = content.split(" = ", 1)
                addr_seg, desc = parts[0].strip(), parts[1].strip()
            else:
                # Fallback: take first token(s) until non-digit/non-separator,
                # everything else as description.
                # Example: "1037 CT Mode. 0 = wired CT"
                m = re.match(r"^([0-9,\s>&\-]+)\s+(.*)$", content)
                if m:
                    addr_seg = m.group(1).strip()
                    desc = m.group(2).strip()
                else:
                    continue  # not a register line

            addr_range = parse_address_segment(addr_seg)
            if not addr_range:
                continue

            start, end = addr_range
            if not desc:
                desc = "(no description)"

            regs.append(RegDef(fc=current_fc, start=start, end=end, desc=desc))

    return regs


# ---------------------------------------------------------------------
# Dump logic
# ---------------------------------------------------------------------
def dump_registers(ip: str, port: int, unit_id: int, regs: List[RegDef]):
    client = ModbusTcpClient(ip, port=port)
    client.connect()

    print(f"Connecting to Growatt SPH @ {ip}:{port}, unit {unit_id}")
    print(f"Total register entries parsed from registers.md: {len(regs)}")
    print("-" * 80)

    try:
        for r in regs:
            count = r.end - r.start + 1
            vals = robust_read_registers(client, r.fc, r.start, count, unit_id)
            fc_str = f"0{r.fc}"

            if vals is None:
                print(f"FC{fc_str} {r.start:4d}->{r.end:<4d}  FAILED  | {r.desc}")
                continue

            parts = [f"{r.start + i}={v}" for i, v in enumerate(vals)]
            values_str = ", ".join(parts)
            print(f"FC{fc_str} {r.start:4d}->{r.end:<4d}  {values_str}  | {r.desc}")

    finally:
        client.close()


# ---------------------------------------------------------------------
# CLI entrypoint
# ---------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Dump all Modbus register values listed in registers.md (Growatt SPH)"
    )
    parser.add_argument(
        "--ip",
        default=DEFAULT_IP,
        help=f"Inverter IP address (default: {DEFAULT_IP})",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"Modbus TCP port (default: {DEFAULT_PORT})",
    )
    parser.add_argument(
        "--unit",
        type=int,
        default=DEFAULT_UNIT_ID,
        help=f"Modbus unit ID (default: {DEFAULT_UNIT_ID})",
    )
    parser.add_argument(
        "--file",
        default="registers.md",
        help="Path to registers.md (default: ./registers.md)",
    )

    args = parser.parse_args()

    regs = parse_registers_md(args.file)
    if not regs:
        print("No registers parsed from registers.md. "
              "Check the file format or parser logic.")
        sys.exit(1)

    dump_registers(args.ip, args.port, args.unit, regs)


if __name__ == "__main__":
    main()

