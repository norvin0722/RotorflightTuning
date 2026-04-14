"""
services/blackbox_parser.py

Two modes:
  parse_uploaded_csv()     — reads ONLY the preamble (no DataFrame), fast and safe for large files
  load_segment_dataframe() — full parse + slice, used only when running analysis
"""

import io
import re
from pathlib import Path
from typing import Any

import pandas as pd


# ── Preamble-only parse (used at upload time) ─────────────────────────────────

def parse_uploaded_csv(csv_path: str) -> dict[str, Any]:
    """
    Read only the preamble metadata from a Rotorflight blackbox CSV.
    Stops reading as soon as it finds the loopIteration header row.
    Does NOT load the full DataFrame — safe for files of any size.
    """
    meta: dict[str, Any] = {}
    kv_re = re.compile(r'^"?([^",]+)"?,(.+)$')
    header_found = False
    total_loops = None
    last_loop_val = None

    with open(csv_path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            stripped = line.strip()

            # Detect loopIteration header row
            if stripped.lstrip('"').startswith("loopIteration"):
                header_found = True
                continue

            if not header_found:
                # Parse preamble key/value rows
                m = kv_re.match(stripped)
                if m:
                    key = m.group(1).strip().strip('"')
                    val = m.group(2).strip().strip('"')
                    try:
                        if "," in val:
                            meta[key] = val
                        else:
                            meta[key] = int(val)
                    except ValueError:
                        try:
                            meta[key] = float(val)
                        except ValueError:
                            meta[key] = val
            else:
                # Count data rows and track last loopIteration value
                if stripped:
                    # First column is loopIteration
                    comma = stripped.find(",")
                    if comma > 0:
                        try:
                            last_loop_val = int(stripped[:comma])
                        except ValueError:
                            pass
                    if total_loops is None:
                        total_loops = 0
                    total_loops += 1

    # Derive sample rate from preamble values
    looptime   = int(meta.get("looptime", 250))
    pid_denom  = int(meta.get("pid_process_denom", 2))
    log_denom  = int(meta.get("frameIntervalPDenom", 1))
    gyro_rate  = 1_000_000 / looptime
    pid_rate   = gyro_rate / pid_denom
    sample_rate = pid_rate / log_denom

    duration_s = None
    if total_loops and sample_rate:
        duration_s = round(total_loops / sample_rate, 2)

    # Normalise craft name key (firmware uses different casing)
    craft_name = (
        meta.get("Craft name")
        or meta.get("craft_name")
        or meta.get("name")
        or None
    )

    firmware = (
        meta.get("firmwareVersion")
        or meta.get("Firmware revision")
        or None
    )

    board = meta.get("Board information") or meta.get("board_name") or None

    return {
        **meta,
        "craft_name":             craft_name,
        "firmware_version":       firmware,
        "board_name":             board,
        "sample_rate_hz":         round(sample_rate, 1),
        "total_loop_iterations":  last_loop_val,
        "duration_s":             duration_s,
        "gyro_scale":             float(meta.get("gyroScale", 1.0)),
    }


# ── Full parse for analysis ───────────────────────────────────────────────────

def load_segment_dataframe(
    csv_path: str,
    start_iteration: int,
    end_iteration: int,
):
    """
    Full parse of the CSV, returning only the rows in [start_iteration, end_iteration].
    Imports rf_blackbox_parser lazily to avoid the pandas/scipy overhead at startup.
    """
    import sys
    sys.path.insert(0, str(Path(__file__).parent))
    from rf_blackbox_parser import parse_blackbox_csv

    log = parse_blackbox_csv(csv_path)
    seg_df = log.segment(start_iteration, end_iteration)
    return seg_df, log.col
