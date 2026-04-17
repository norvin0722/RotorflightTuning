"""
Load a pre-sliced segment CSV into a pandas DataFrame.
The CSV was sliced browser-side so it is small (KB–MB, not 300 MB).
Returns (df, sample_rate_hz).
"""
import pandas as pd
import numpy as np


def load_segment_dataframe(csv_path: str):
    """Read the segment CSV slice and return (df, sample_rate_hz)."""
    df = pd.read_csv(csv_path, comment="#", low_memory=False)
    df.columns = [c.strip().strip('"') for c in df.columns]

    # Derive sample rate from time column (microseconds)
    sample_rate_hz = 1000.0  # default
    if "time" in df.columns and len(df) > 1:
        times = pd.to_numeric(df["time"], errors="coerce").dropna().values
        if len(times) > 1:
            dt_us = np.mean(np.diff(times[:500]))
            if dt_us > 0:
                sample_rate_hz = 1_000_000.0 / dt_us

    # Coerce all numeric columns
    for col in df.columns:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    return df, sample_rate_hz
