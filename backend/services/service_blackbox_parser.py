"""
services/blackbox_parser.py
FastAPI service wrapper around rf_blackbox_parser.

Provides two functions used by the routers:
  parse_uploaded_csv()      — fast preamble-only parse for flight creation
  load_segment_dataframe()  — full parse + segment slice for analysis
"""

import sys
from pathlib import Path
from typing import Any

import pandas as pd

# Add the services directory to path so rf_blackbox_parser can be imported
sys.path.insert(0, str(Path(__file__).parent))

from rf_blackbox_parser import parse_blackbox_csv, ColumnMap


def parse_uploaded_csv(csv_path: str) -> dict[str, Any]:
    """
    Parse just the preamble metadata from a CSV.
    Returns a flat dict with keys from the preamble + derived fields.
    Does a full parse but discards the DataFrame — only needs to be done once.
    """
    log = parse_blackbox_csv(csv_path)

    return {
        **log.meta,
        "sample_rate_hz":         log.sample_rate_hz,
        "total_loop_iterations":  int(log.df["loopIteration"].iloc[-1]) if len(log.df) > 0 else None,
        "duration_s":             log.duration_s,
        "gyro_scale":             log.gyro_scale,
    }


def load_segment_dataframe(
    csv_path:       str,
    start_iteration: int,
    end_iteration:   int,
) -> tuple[pd.DataFrame, ColumnMap]:
    """
    Full CSV parse + segment slice.
    Returns (DataFrame of just the segment rows, ColumnMap).
    """
    log = parse_blackbox_csv(csv_path)
    seg_df = log.segment(start_iteration, end_iteration)
    return seg_df, log.col
