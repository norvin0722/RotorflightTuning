"""
services/analysis_engine.py
FastAPI service wrapper around rf_analysis_engine.

Bridges the router → analysis engine with optional module filtering
and FFT config translation.
"""

import sys
from pathlib import Path
from typing import Any

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))

from rf_analysis_engine import run_all, FFTConfig as EngineFFTConfig
from rf_blackbox_parser import ColumnMap


def run_segment_analysis(
    df:               pd.DataFrame,
    col:              ColumnMap,
    sample_rate_hz:   float,
    pid_profile:      dict | None = None,
    global_filters:   dict | None = None,
    target_headspeed: int | None  = None,
    fft_cfg:          Any         = None,
    modules:          list[str] | None = None,
) -> dict[str, dict]:
    """
    Run analysis modules on a segment DataFrame.

    fft_cfg can be a Pydantic model from the router (with nperseg, overlap_pct,
    window, db_scale fields) or None for defaults.

    If modules is not None, only the listed modules are run.
    """
    # Translate router FFT config → engine FFT config
    engine_fft = None
    if fft_cfg is not None:
        engine_fft = EngineFFTConfig(
            nperseg     = getattr(fft_cfg, "nperseg",     1024),
            overlap_pct = getattr(fft_cfg, "overlap_pct", 0.75),
            window      = getattr(fft_cfg, "window",      "hann"),
            db_scale    = getattr(fft_cfg, "db_scale",    True),
        )

    all_results = run_all(
        df               = df,
        col              = col,
        sample_rate_hz   = sample_rate_hz,
        pid_profile      = pid_profile,
        global_filters   = global_filters,
        target_headspeed = target_headspeed,
        fft_cfg          = engine_fft,
    )

    if modules is not None:
        return {k: v for k, v in all_results.items() if k in modules}
    return all_results
