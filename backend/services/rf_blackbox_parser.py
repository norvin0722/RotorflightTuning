"""
Rotorflight blackbox CSV parser.

Handles the dual-section format:
  - Lines 1..N-1 : "Key","Value" metadata preamble
  - Line N       : unquoted CSV header starting with 'loopIteration'
  - Lines N+1..  : data rows

Produces a pandas DataFrame plus a metadata dict and a ColumnMap
that gives the rest of the engine stable, axis-indexed access to
columns regardless of firmware version minor differences.
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass, field
from typing import Any

import pandas as pd
import numpy as np


# ---------------------------------------------------------------------------
# Column map — stable names used by the analysis engine
# ---------------------------------------------------------------------------

@dataclass
class ColumnMap:
    """
    Maps logical signal names → actual CSV column names.
    All multi-axis signals are lists [roll_col, pitch_col, yaw_col].
    Optional columns are None if absent from the log.
    """
    # Timing
    loop_iteration: str = "loopIteration"
    time_us: str = "time"

    # RC / setpoint
    rc_command: list[str] = field(default_factory=lambda: [
        "rcCommand[0]", "rcCommand[1]", "rcCommand[2]", "rcCommand[3]"
    ])
    setpoint: list[str] = field(default_factory=lambda: [
        "setpoint[0]", "setpoint[1]", "setpoint[2]", "setpoint[3]"
    ])

    # Gyro — raw (pre-filter) and filtered (post-filter)
    gyro_raw: list[str] = field(default_factory=lambda: [
        "gyroRAW[0]", "gyroRAW[1]", "gyroRAW[2]"
    ])
    gyro_filtered: list[str] = field(default_factory=lambda: [
        "gyroADC[0]", "gyroADC[1]", "gyroADC[2]"
    ])

    # PID terms
    axis_p: list[str] = field(default_factory=lambda: [
        "axisP[0]", "axisP[1]", "axisP[2]"
    ])
    axis_i: list[str] = field(default_factory=lambda: [
        "axisI[0]", "axisI[1]", "axisI[2]"
    ])
    axis_d: list[str] = field(default_factory=lambda: [
        "axisD[0]", "axisD[1]", "axisD[2]"
    ])
    axis_f: list[str] = field(default_factory=lambda: [
        "axisF[0]", "axisF[1]", "axisF[2]"
    ])
    axis_b: list[str] = field(default_factory=lambda: [
        "axisB[0]", "axisB[1]", "axisB[2]"
    ])
    axis_o: list[str] = field(default_factory=lambda: [
        "axisO[0]", "axisO[1]", "axisO[2]"
    ])
    axis_sum: list[str] = field(default_factory=lambda: [
        "axisSum[0]", "axisSum[1]", "axisSum[2]"
    ])
    axis_pd: list[str] = field(default_factory=lambda: [
        "axisPD[0]", "axisPD[1]", "axisPD[2]"
    ])
    axis_error: list[str] = field(default_factory=lambda: [
        "axisError[0]", "axisError[1]", "axisError[2]"
    ])

    # Mixer outputs
    mixer: list[str] = field(default_factory=lambda: [
        "mixer[0]", "mixer[1]", "mixer[2]", "mixer[3]"
    ])

    # Accelerometer
    acc_adc: list[str] = field(default_factory=lambda: [
        "accADC[0]", "accADC[1]", "accADC[2]"
    ])

    # Attitude (degrees * 10)
    attitude: list[str] = field(default_factory=lambda: [
        "attitude[0]", "attitude[1]", "attitude[2]"
    ])

    # ESC telemetry (optional)
    esc_voltage: str | None = "EscV"
    esc_current: str | None = "EscI"
    esc_rpm: str | None = "EscRPM"
    esc_throttle: str | None = "EscThr"
    esc_pwm: str | None = "EscPwm"
    esc_cap: str | None = "EscCap"
    esc_temp: str | None = "Tesc"

    # Headspeed (RPM)
    headspeed: str | None = "headspeed"

    # Battery
    vbat: str | None = "Vbat"
    ibat: str | None = "Ibat"

    # Servos
    servo: list[str] = field(default_factory=lambda: [
        "servo[0]", "servo[1]", "servo[2]", "servo[3]"
    ])

    # Governor debug (present when debug_mode = GOVERNOR)
    debug: list[str] = field(default_factory=lambda: [
        f"debug[{i}]" for i in range(8)
    ])

    # Misc
    rssi: str | None = "rssi"
    altitude: str | None = "altitude"
    vario: str | None = "vario"
    mcu_temp: str | None = "Tmcu"
    flight_mode: str | None = "flightModeFlags"

    # Axis indices
    ROLL: int = 0
    PITCH: int = 1
    YAW: int = 2


# ---------------------------------------------------------------------------
# Preamble metadata parser
# ---------------------------------------------------------------------------

def _parse_preamble(lines: list[str]) -> dict[str, Any]:
    """
    Parse the "Key","Value" preamble lines into a dict.
    Values are cast to int/float where possible.
    Comma-separated numeric strings become lists of ints/floats.
    """
    meta: dict[str, Any] = {}
    kv_re = re.compile(r'^"([^"]+)","?(.*?)"?$')

    for line in lines:
        line = line.strip()
        if not line:
            continue
        m = kv_re.match(line)
        if not m:
            continue
        key = m.group(1).strip()
        val = m.group(2).strip()

        # Try comma-separated list of numbers first
        if "," in val:
            parts = val.split(",")
            try:
                casted = [int(p) if "." not in p else float(p) for p in parts]
                meta[key] = casted
                continue
            except ValueError:
                pass

        # Try int
        try:
            meta[key] = int(val)
            continue
        except ValueError:
            pass

        # Try float
        try:
            meta[key] = float(val)
            continue
        except ValueError:
            pass

        meta[key] = val

    return meta


# ---------------------------------------------------------------------------
# Sample rate derivation
# ---------------------------------------------------------------------------

def derive_sample_rate(meta: dict[str, Any]) -> float:
    """
    Compute the effective sample rate of logged data in Hz.

    Rotorflight log rate chain:
      gyro_rate   = 1_000_000 / looptime
      pid_rate    = gyro_rate / pid_process_denom
      log_rate    = pid_rate / frameIntervalPDenom
    """
    looptime = meta.get("looptime", 250)             # µs
    pid_denom = meta.get("pid_process_denom", 2)
    log_denom = meta.get("frameIntervalPDenom", 1)

    gyro_rate = 1_000_000 / looptime
    pid_rate = gyro_rate / pid_denom
    log_rate = pid_rate / log_denom
    return log_rate


# ---------------------------------------------------------------------------
# Main parser
# ---------------------------------------------------------------------------

@dataclass
class BlackboxLog:
    meta: dict[str, Any]
    df: pd.DataFrame
    col: ColumnMap
    sample_rate_hz: float
    csv_path: str = ""

    @property
    def duration_s(self) -> float:
        if "time" in self.df.columns:
            return (self.df["time"].iloc[-1] - self.df["time"].iloc[0]) / 1_000_000
        return len(self.df) / self.sample_rate_hz

    @property
    def n_samples(self) -> int:
        return len(self.df)

    @property
    def gyro_scale(self) -> float:
        """
        Gyro scale factor from preamble.
        gyroScale=1 means raw values are already in deg/s.
        gyroScale=16.4 (older firmware) means divide by 16.4 to get deg/s.
        """
        return float(self.meta.get("gyroScale", 1.0))

    @property
    def attitude_scale(self) -> float:
        """attitude[n] columns are in decidegrees. Multiply by 0.1 to get degrees."""
        return 0.1

    def segment(self, start_iter: int, end_iter: int) -> pd.DataFrame:
        """Slice DataFrame by loopIteration range (inclusive)."""
        mask = (
            (self.df[self.col.loop_iteration] >= start_iter) &
            (self.df[self.col.loop_iteration] <= end_iter)
        )
        return self.df[mask].reset_index(drop=True)

    def available_columns(self, cols: list[str | None]) -> list[str]:
        """Filter a list of column names to those actually present in df."""
        return [c for c in cols if c is not None and c in self.df.columns]

    @property
    def physical_units(self) -> dict[str, str]:
        """
        Reference dict: column_name → physical unit string.
        Used by the UI layer to label axes correctly.
        """
        return {
            # Time
            "time":            "µs",
            "loopIteration":   "count",
            # Gyro — gyroScale=1 in modern RF means already deg/s
            "gyroRAW[0]":      "deg/s",  "gyroRAW[1]":  "deg/s",  "gyroRAW[2]":  "deg/s",
            "gyroADC[0]":      "deg/s",  "gyroADC[1]":  "deg/s",  "gyroADC[2]":  "deg/s",
            # Setpoint: axes 0-2 = deg/s (rotational), axis 3 = collective (internal units)
            "setpoint[0]":     "deg/s",  "setpoint[1]": "deg/s",  "setpoint[2]": "deg/s",
            "setpoint[3]":     "internal",
            # RC commands: µs PWM (1000–2000)
            "rcCommand[0]":    "µs",     "rcCommand[1]": "µs",
            "rcCommand[2]":    "µs",     "rcCommand[3]": "µs",     "rcCommand[4]": "µs",
            # PID terms: dimensionless scaled output
            "axisP[0]": "au",  "axisP[1]": "au",  "axisP[2]": "au",
            "axisI[0]": "au",  "axisI[1]": "au",  "axisI[2]": "au",
            "axisD[0]": "au",  "axisD[1]": "au",  "axisD[2]": "au",
            "axisF[0]": "au",  "axisF[1]": "au",  "axisF[2]": "au",
            "axisB[0]": "au",  "axisB[1]": "au",  "axisB[2]": "au",
            "axisO[0]": "au",  "axisO[1]": "au",  "axisO[2]": "au",
            "axisSum[0]": "au","axisSum[1]": "au","axisSum[2]": "au",
            "axisPD[0]": "au", "axisPD[1]": "au", "axisPD[2]": "au",
            # axisError: setpoint - gyroADC → deg/s
            "axisError[0]":    "deg/s",  "axisError[1]": "deg/s", "axisError[2]": "deg/s",
            # Attitude: raw values are decidegrees — multiply by 0.1 to get degrees
            "attitude[0]":     "decideg (×0.1°)",
            "attitude[1]":     "decideg (×0.1°)",
            "attitude[2]":     "decideg (×0.1°)",
            # Mixer: internal ±1000 units
            "mixer[0]": "au",  "mixer[1]": "au",  "mixer[2]": "au",  "mixer[3]": "au",
            # Servos: µs PWM
            "servo[0]": "µs",  "servo[1]": "µs",  "servo[2]": "µs",  "servo[3]": "µs",
            # Motor: µs PWM (protocol=PWM)
            "motor[0]": "µs",
            # ESC telemetry
            "EscRPM":  "RPM",
            "headspeed": "RPM",
            "EscV":    "cV (÷100 = V)",   # centivolts
            "Vbat":    "cV (÷100 = V)",
            "EscI":    "cA (÷100 = A)",   # centiamps
            "Ibat":    "cA (÷100 = A)",
            "EscThr":  "0–1000 (×0.1%)",
            "EscPwm":  "0–1000 (×0.1%)",
            "EscCap":  "mAh",
            "Tmcu":    "°C",
            "Tesc":    "°C",
            "altitude": "cm (÷100 = m)",
            "vario":    "cm/s",
            "rssi":     "0–1023",
        }


def parse_blackbox_csv(source: str | io.TextIOBase, csv_path: str = "") -> BlackboxLog:
    """
    Parse a Rotorflight blackbox CSV export.

    Args:
        source : file path string OR file-like object (TextIOBase)
        csv_path : original file path (stored for reference)

    Returns:
        BlackboxLog with parsed metadata, DataFrame, ColumnMap, sample rate
    """
    if isinstance(source, str):
        with open(source, "r", encoding="utf-8", errors="replace") as f:
            raw_lines = f.readlines()
        csv_path = csv_path or source
    else:
        raw_lines = source.readlines()

    # Find the data header row — line starting with loopIteration (quoted or unquoted)
    header_idx = None
    for i, line in enumerate(raw_lines):
        stripped = line.strip().lstrip('"')
        if stripped.startswith("loopIteration"):
            header_idx = i
            break

    if header_idx is None:
        raise ValueError(
            "Could not find data header row (expected line starting with 'loopIteration'). "
            "Is this a valid Rotorflight blackbox CSV export?"
        )

    # Parse preamble
    preamble_lines = raw_lines[:header_idx]
    meta = _parse_preamble(preamble_lines)

    # Parse data section
    data_text = "".join(raw_lines[header_idx:])
    df = pd.read_csv(
        io.StringIO(data_text),
        dtype_backend="numpy_nullable",
        low_memory=False,
    )

    # Strip whitespace and quotes from column names (defensive)
    df.columns = [c.strip().strip('"') for c in df.columns]

    # Coerce all numeric columns
    for col in df.columns:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    # Apply gyroScale to raw and filtered gyro columns if scale != 1
    gyro_scale = float(meta.get("gyroScale", 1.0))
    if gyro_scale != 1.0 and gyro_scale > 0:
        gyro_cols = [
            "gyroRAW[0]", "gyroRAW[1]", "gyroRAW[2]",
            "gyroADC[0]", "gyroADC[1]", "gyroADC[2]",
        ]
        for gc in gyro_cols:
            if gc in df.columns:
                df[gc] = df[gc] / gyro_scale

    # Build column map — validate against actual columns and null-out missing
    col = ColumnMap()
    actual_cols = set(df.columns)

    def _check_optional(attr: str) -> None:
        val = getattr(col, attr)
        if val is not None and val not in actual_cols:
            setattr(col, attr, None)

    def _check_list(attr: str) -> None:
        vals = getattr(col, attr)
        setattr(col, attr, [v if v in actual_cols else None for v in vals])

    for opt in ["esc_voltage", "esc_current", "esc_rpm", "esc_throttle",
                "esc_pwm", "esc_cap", "esc_temp", "headspeed",
                "vbat", "ibat", "rssi", "altitude", "vario", "mcu_temp", "flight_mode"]:
        _check_optional(opt)

    for lst in ["gyro_raw", "gyro_filtered", "axis_p", "axis_i", "axis_d",
                "axis_f", "axis_b", "axis_o", "axis_sum", "axis_pd",
                "axis_error", "mixer", "acc_adc", "attitude",
                "servo", "debug", "rc_command", "setpoint"]:
        _check_list(lst)

    sample_rate = derive_sample_rate(meta)

    return BlackboxLog(
        meta=meta,
        df=df,
        col=col,
        sample_rate_hz=sample_rate,
        csv_path=csv_path,
    )
