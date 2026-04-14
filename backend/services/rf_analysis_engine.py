"""
Rotorflight blackbox analysis engine.

Unit reference (from firmware source + docs verification):
  gyroRAW / gyroADC / setpoint[0-2] / axisError[0-2] : deg/s
  axisP/I/D/F/B/O / axisSum / axisPD                 : dimensionless (au)
  attitude[0-2]                                       : decidegrees (×0.1 = degrees)
  rcCommand[0-4] / servo[0-3] / motor[0]              : µs PWM
  EscRPM / headspeed                                  : RPM
  EscV / Vbat                                         : centivolts (÷100 = V)
  EscI / Ibat                                         : centiamps  (÷100 = A)
  EscThr / EscPwm                                     : 0-1000 (×0.1%)
  EscCap                                              : mAh
  Tmcu / Tesc                                         : °C
  altitude                                            : cm (÷100 = m)
  time                                                : µs
  PID gains (config dump)                             : dimensionless gain multipliers
  Gyro filter Hz settings                             : Hz
  gov_headspeed                                       : RPM
  vbat_max/min_cell_voltage                           : centivolts (÷100 = V)
  attitude (config dump error_limit etc.)             : degrees
  servo center/min/max (config dump)                  : µs

Modules
-------
  tracking_error      — RMS, peak, time-domain error per axis (deg/s)
  step_response       — rise time, overshoot, settling time
  oscillation         — P/D oscillation detection via zero-crossing and FFT peaks
  fft_vibration       — Welch PSD with configurable window/overlap/function + filter shading
  bode_coherence      — open-loop transfer function estimate + coherence for phase margin
  governor            — headspeed stability, sag, recovery time (RPM)
  pidf_balance        — relative contribution of each PIDF term per axis
  control_latency     — cross-correlation setpoint→gyro lag estimation (ms)
  servo_analysis      — servo activity, range utilisation, correlation with axes

All public functions accept a pandas DataFrame slice (from BlackboxLog.segment())
plus a ColumnMap and optional config keyword arguments.
They return plain dicts so results can be stored directly as segment_metrics rows.
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
from scipy import signal as sp_signal
from scipy.stats import pearsonr

from rf_blackbox_parser import ColumnMap

warnings.filterwarnings("ignore", category=RuntimeWarning)

AXIS_NAMES = ["roll", "pitch", "yaw"]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _col(df: pd.DataFrame, name: str | None) -> np.ndarray | None:
    """Return a float64 numpy array for a column, or None if missing."""
    if name is None or name not in df.columns:
        return None
    return df[name].to_numpy(dtype=np.float64, na_value=np.nan)


def _valid(arr: np.ndarray | None) -> bool:
    return arr is not None and not np.all(np.isnan(arr))


def _rms(arr: np.ndarray) -> float:
    clean = arr[~np.isnan(arr)]
    if len(clean) == 0:
        return 0.0
    return float(np.sqrt(np.mean(clean ** 2)))


def _peak(arr: np.ndarray) -> float:
    clean = arr[~np.isnan(arr)]
    if len(clean) == 0:
        return 0.0
    return float(np.max(np.abs(clean)))


# ---------------------------------------------------------------------------
# 1. Tracking error
# ---------------------------------------------------------------------------

def tracking_error(
    df: pd.DataFrame,
    col: ColumnMap,
) -> dict[str, Any]:
    """
    Compute setpoint tracking error per axis.

    Uses axisError[n] directly when available (most accurate).
    Falls back to setpoint[n] - gyroADC[n] if not.

    Returns dict with per-axis rms_error, peak_error, mean_error, std_error.
    """
    results: dict[str, Any] = {}

    for i, axis in enumerate(AXIS_NAMES):
        err_col = col.axis_error[i] if col.axis_error[i] else None
        err = _col(df, err_col)

        if not _valid(err):
            # Fallback: setpoint - filtered gyro
            sp = _col(df, col.setpoint[i])
            gy = _col(df, col.gyro_filtered[i])
            if _valid(sp) and _valid(gy):
                err = sp - gy
            else:
                results[f"{axis}_rms_error"] = None
                continue

        clean = err[~np.isnan(err)]
        results[f"{axis}_rms_error"]  = float(np.sqrt(np.mean(clean ** 2)))
        results[f"{axis}_peak_error"] = float(np.max(np.abs(clean)))
        results[f"{axis}_mean_error"] = float(np.mean(clean))
        results[f"{axis}_std_error"]  = float(np.std(clean))

    # All tracking error values are in deg/s
    results["_units"] = "deg/s"
    return results


# ---------------------------------------------------------------------------
# 2. Step response
# ---------------------------------------------------------------------------

def step_response(
    df: pd.DataFrame,
    col: ColumnMap,
    sample_rate_hz: float,
    setpoint_threshold: float = 50.0,
    min_step_magnitude: float = 100.0,
) -> dict[str, Any]:
    """
    Detect step inputs in setpoint and measure gyro response characteristics.

    For each detected step per axis:
      - rise time   : time from 10% to 90% of final value (ms)
      - overshoot   : peak beyond final value as % of step magnitude
      - settling    : time to stay within ±5% of final value (ms)

    Returns aggregate stats (mean/max) across all detected steps.
    """
    results: dict[str, Any] = {}
    dt_ms = 1000.0 / sample_rate_hz

    for i, axis in enumerate(AXIS_NAMES):
        sp  = _col(df, col.setpoint[i])
        gy  = _col(df, col.gyro_filtered[i])

        if not _valid(sp) or not _valid(gy):
            continue

        # Detect step onset: large, sustained change in setpoint
        d_sp = np.diff(sp, prepend=sp[0])
        step_mask = np.abs(d_sp) > setpoint_threshold

        # Group into individual steps
        step_indices = np.where(step_mask)[0]
        if len(step_indices) == 0:
            continue

        # Cluster consecutive indices into single step events
        clusters = []
        cluster = [step_indices[0]]
        for idx in step_indices[1:]:
            if idx - cluster[-1] <= 3:
                cluster.append(idx)
            else:
                clusters.append(cluster[0])
                cluster = [idx]
        clusters.append(cluster[0])

        rise_times, overshoots, settle_times = [], [], []

        for onset in clusters:
            # Extract 200ms window after step
            window_samples = int(0.2 * sample_rate_hz)
            end = min(onset + window_samples, len(gy))
            if end - onset < 20:
                continue

            step_sp = sp[onset:end]
            step_gy = gy[onset:end]

            magnitude = np.abs(step_sp[-1] - step_sp[0])
            if magnitude < min_step_magnitude:
                continue

            target = step_sp[-1]
            lo = target * 0.10
            hi = target * 0.90

            # Rise time: first crossing of 10% to 90%
            try:
                t10 = next(j for j, v in enumerate(step_gy) if abs(v) >= abs(lo))
                t90 = next(j for j, v in enumerate(step_gy) if abs(v) >= abs(hi))
                rise_times.append((t90 - t10) * dt_ms)
            except StopIteration:
                pass

            # Overshoot
            if target != 0:
                peak_val = np.max(np.abs(step_gy)) * np.sign(target)
                overshoot_pct = (peak_val - target) / magnitude * 100
                if overshoot_pct > 0:
                    overshoots.append(float(overshoot_pct))

            # Settling time: last time outside ±5% band
            band = 0.05 * magnitude
            outside = np.where(np.abs(step_gy - target) > band)[0]
            if len(outside) > 0:
                settle_times.append(outside[-1] * dt_ms)

        prefix = f"{axis}_step"
        if rise_times:
            results[f"{prefix}_rise_ms_mean"]   = float(np.mean(rise_times))
            results[f"{prefix}_rise_ms_max"]    = float(np.max(rise_times))
        if overshoots:
            results[f"{prefix}_overshoot_pct_mean"] = float(np.mean(overshoots))
            results[f"{prefix}_overshoot_pct_max"]  = float(np.max(overshoots))
        if settle_times:
            results[f"{prefix}_settle_ms_mean"] = float(np.mean(settle_times))
            results[f"{prefix}_settle_ms_max"]  = float(np.max(settle_times))
        results[f"{prefix}_count"] = len(clusters)

    return results


# ---------------------------------------------------------------------------
# 3. Oscillation detection
# ---------------------------------------------------------------------------

def oscillation_detection(
    df: pd.DataFrame,
    col: ColumnMap,
    sample_rate_hz: float,
    zero_cross_min_hz: float = 10.0,
    zero_cross_max_hz: float = 200.0,
) -> dict[str, Any]:
    """
    Detect P/D oscillations via zero-crossing frequency analysis on gyro error
    and PD output. Also flags high-frequency D-term buzz.

    Returns dominant oscillation frequency (Hz), oscillation intensity (RMS
    in the oscillation band), and a severity flag (none/mild/moderate/severe).
    """
    results: dict[str, Any] = {}

    for i, axis in enumerate(AXIS_NAMES):
        gy  = _col(df, col.gyro_filtered[i])
        pd_out = _col(df, col.axis_pd[i]) if col.axis_pd[i] else None

        signal_to_check = pd_out if _valid(pd_out) else gy
        if not _valid(signal_to_check):
            continue

        arr = signal_to_check[~np.isnan(signal_to_check)]
        if len(arr) < 64:
            continue

        # Zero-crossing frequency estimate
        zero_crossings = np.where(np.diff(np.sign(arr)))[0]
        if len(zero_crossings) > 1:
            avg_period_samples = np.mean(np.diff(zero_crossings)) * 2
            zc_freq = sample_rate_hz / avg_period_samples
        else:
            zc_freq = 0.0

        # FFT-based dominant frequency in oscillation band
        freqs, psd = sp_signal.welch(arr, fs=sample_rate_hz, nperseg=min(256, len(arr)//4))
        band_mask = (freqs >= zero_cross_min_hz) & (freqs <= zero_cross_max_hz)
        if band_mask.any():
            band_psd = psd[band_mask]
            band_freqs = freqs[band_mask]
            dom_freq = float(band_freqs[np.argmax(band_psd)])
            band_rms = float(np.sqrt(np.trapz(band_psd, band_freqs)))
        else:
            dom_freq = 0.0
            band_rms = 0.0

        # Total RMS for normalisation
        total_rms = _rms(arr)
        osc_ratio = band_rms / (total_rms + 1e-9)

        # Severity classification
        if osc_ratio < 0.15:
            severity = "none"
        elif osc_ratio < 0.30:
            severity = "mild"
        elif osc_ratio < 0.55:
            severity = "moderate"
        else:
            severity = "severe"

        results[f"{axis}_osc_dominant_hz"]  = dom_freq
        results[f"{axis}_osc_band_rms"]     = band_rms
        results[f"{axis}_osc_ratio"]        = float(osc_ratio)
        results[f"{axis}_osc_severity"]     = severity
        results[f"{axis}_zc_freq_hz"]       = float(zc_freq)

    return results


# ---------------------------------------------------------------------------
# 4. FFT vibration analysis
# ---------------------------------------------------------------------------

@dataclass
class FFTConfig:
    """User-configurable FFT parameters."""
    nperseg: int = 1024          # Window size: 256, 512, 1024, 2048, 4096
    overlap_pct: float = 0.75    # Overlap fraction: 0.0 – 0.95
    window: str = "hann"         # "hann", "blackman", "flattop", "boxcar", "hamming"
    db_scale: bool = True        # Return PSD in dB (True) or linear (False)


def fft_vibration(
    df: pd.DataFrame,
    col: ColumnMap,
    sample_rate_hz: float,
    pid_profile: dict | None = None,
    global_filters: dict | None = None,
    fft_cfg: FFTConfig | None = None,
) -> dict[str, Any]:
    """
    Compute Welch PSD for raw and filtered gyro on all three axes.

    Returns:
      - freqs           : frequency axis array (Hz)
      - {axis}_raw_psd  : PSD of gyroRAW (pre-filter)
      - {axis}_filt_psd : PSD of gyroADC (post-filter)
      - filter_bands    : list of {label, lo_hz, hi_hz, type} dicts for UI shading
      - nperseg, overlap_pct, window : echo back FFT settings for display
    """
    if fft_cfg is None:
        fft_cfg = FFTConfig()

    noverlap = int(fft_cfg.nperseg * fft_cfg.overlap_pct)
    results: dict[str, Any] = {
        "nperseg":      fft_cfg.nperseg,
        "overlap_pct":  fft_cfg.overlap_pct,
        "window":       fft_cfg.window,
        "sample_rate_hz": sample_rate_hz,
    }

    freqs_out = None

    for i, axis in enumerate(AXIS_NAMES):
        raw_arr  = _col(df, col.gyro_raw[i])
        filt_arr = _col(df, col.gyro_filtered[i])

        for label, arr in [("raw", raw_arr), ("filt", filt_arr)]:
            if not _valid(arr):
                results[f"{axis}_{label}_psd"] = None
                continue

            arr_clean = np.nan_to_num(arr, nan=0.0)
            freqs, psd = sp_signal.welch(
                arr_clean,
                fs=sample_rate_hz,
                window=fft_cfg.window,
                nperseg=min(fft_cfg.nperseg, len(arr_clean) // 2),
                noverlap=noverlap,
            )

            if freqs_out is None:
                freqs_out = freqs.tolist()

            if fft_cfg.db_scale:
                psd_out = (10 * np.log10(psd + 1e-12)).tolist()
            else:
                psd_out = psd.tolist()

            results[f"{axis}_{label}_psd"] = psd_out

    results["freqs"] = freqs_out or []

    # Build filter shading bands for the UI
    results["filter_bands"] = _build_filter_bands(
        pid_profile=pid_profile,
        global_filters=global_filters,
        sample_rate_hz=sample_rate_hz,
    )

    return results


def _build_filter_bands(
    pid_profile: dict | None,
    global_filters: dict | None,
    sample_rate_hz: float,
) -> list[dict]:
    """
    Build a list of filter band descriptors for FFT chart shading.
    Each entry: {label, lo_hz, hi_hz, color_hint, axis}
    """
    bands = []
    nyquist = sample_rate_hz / 2

    gf = global_filters or {}
    pp = pid_profile or {}

    # Global LPF1
    lpf1_hz = gf.get("gyro_lpf1_static_hz") or gf.get("gyro_lowpass_hz")
    lpf1_type = gf.get("gyro_lpf1_type", "")
    if lpf1_hz and lpf1_hz > 0:
        bands.append({
            "label": f"Gyro LPF1 ({lpf1_type}) cutoff",
            "lo_hz": lpf1_hz * 0.5,
            "hi_hz": nyquist,
            "color_hint": "blue",
            "axis": "all",
        })

    # Global LPF2
    lpf2_hz = gf.get("gyro_lpf2_static_hz") or gf.get("gyro_lowpass2_hz")
    lpf2_type = gf.get("gyro_lpf2_type", "NONE")
    if lpf2_hz and lpf2_hz > 0 and lpf2_type != "NONE":
        bands.append({
            "label": f"Gyro LPF2 ({lpf2_type}) cutoff",
            "lo_hz": lpf2_hz * 0.5,
            "hi_hz": nyquist,
            "color_hint": "teal",
            "axis": "all",
        })

    # Dynamic notch band
    dyn_min = gf.get("dyn_notch_min_hz", 0)
    dyn_max = gf.get("dyn_notch_max_hz", 0)
    if dyn_min and dyn_max and dyn_max > dyn_min:
        bands.append({
            "label": f"Dynamic notch range ({dyn_min}–{dyn_max} Hz)",
            "lo_hz": dyn_min,
            "hi_hz": dyn_max,
            "color_hint": "amber",
            "axis": "all",
        })

    # Per-axis profile gyro cutoffs (from PID profile)
    axis_cutoff_keys = [
        ("roll_gyro_cutoff",  "roll",  "coral"),
        ("pitch_gyro_cutoff", "pitch", "purple"),
        ("yaw_gyro_cutoff",   "yaw",   "green"),
    ]
    for key, axis, color in axis_cutoff_keys:
        hz = pp.get(key)
        if hz and hz > 0:
            bands.append({
                "label": f"{axis.capitalize()} gyro cutoff ({hz} Hz)",
                "lo_hz": hz * 0.5,
                "hi_hz": nyquist,
                "color_hint": color,
                "axis": axis,
            })

    # D-term cutoffs
    d_cutoff_keys = [
        ("roll_d_cutoff",  "roll",  "coral"),
        ("pitch_d_cutoff", "pitch", "purple"),
        ("yaw_d_cutoff",   "yaw",   "green"),
    ]
    for key, axis, color in d_cutoff_keys:
        hz = pp.get(key)
        if hz and hz > 0:
            bands.append({
                "label": f"{axis.capitalize()} D-term cutoff ({hz} Hz)",
                "lo_hz": hz * 0.4,
                "hi_hz": hz * 1.2,
                "color_hint": color,
                "axis": axis,
            })

    return bands


# ---------------------------------------------------------------------------
# 5. Bode plot + coherence (phase margin estimation)
# ---------------------------------------------------------------------------

def bode_coherence(
    df: pd.DataFrame,
    col: ColumnMap,
    sample_rate_hz: float,
    nperseg: int = 1024,
    overlap_pct: float = 0.75,
) -> dict[str, Any]:
    """
    Estimate open-loop transfer function H(f) = Gyro(f) / Setpoint(f)
    using Welch cross-spectral density for each axis.

    Also computes MSC (magnitude squared coherence) to show frequency
    bands where the estimate is reliable.

    Returns per axis:
      - freqs            : frequency axis (Hz)
      - magnitude_db     : |H(f)| in dB
      - phase_deg        : angle(H(f)) in degrees
      - coherence        : MSC 0–1
      - gain_crossover_hz: frequency where |H| = 0 dB
      - phase_margin_deg : phase at gain crossover + 180°
      - phase_crossover_hz: frequency where phase = -180°
      - gain_margin_db   : -|H| at phase crossover
    """
    results: dict[str, Any] = {}
    noverlap = int(nperseg * overlap_pct)

    for i, axis in enumerate(AXIS_NAMES):
        sp  = _col(df, col.setpoint[i])
        gy  = _col(df, col.gyro_filtered[i])

        if not _valid(sp) or not _valid(gy):
            continue

        # Require sufficient excitation in setpoint
        if np.std(sp[~np.isnan(sp)]) < 5.0:
            results[f"{axis}_bode_note"] = "Insufficient setpoint excitation for reliable estimate"
            continue

        # Align and clean
        n = min(len(sp), len(gy))
        sp_c = np.nan_to_num(sp[:n], nan=0.0)
        gy_c = np.nan_to_num(gy[:n], nan=0.0)

        win_size = min(nperseg, n // 4)
        if win_size < 32:
            continue

        # Cross-spectral density: Pxy = Sxy / Sxx
        freqs, Pxx = sp_signal.welch(sp_c, fs=sample_rate_hz, nperseg=win_size, noverlap=noverlap)
        _, Pxy     = sp_signal.csd(sp_c, gy_c, fs=sample_rate_hz, nperseg=win_size, noverlap=noverlap)

        # Transfer function estimate
        with np.errstate(divide="ignore", invalid="ignore"):
            H = np.where(np.abs(Pxx) > 1e-12, Pxy / Pxx, np.nan + 0j)

        magnitude_db = 20 * np.log10(np.abs(H) + 1e-12)
        phase_deg    = np.degrees(np.angle(H))
        # Unwrap phase for stability analysis
        phase_unwrapped = np.degrees(np.unwrap(np.angle(H)))

        # Coherence (MSC)
        _, coherence = sp_signal.coherence(
            sp_c, gy_c,
            fs=sample_rate_hz,
            nperseg=win_size,
            noverlap=noverlap,
        )

        # Gain crossover: where |H| crosses 0 dB (from above)
        gain_crossover_hz = None
        phase_margin_deg  = None
        for j in range(1, len(magnitude_db)):
            if magnitude_db[j - 1] >= 0 >= magnitude_db[j]:
                # Interpolate
                f_gc = float(np.interp(0, [magnitude_db[j], magnitude_db[j-1]], [freqs[j], freqs[j-1]]))
                p_gc = float(np.interp(f_gc, freqs, phase_unwrapped))
                gain_crossover_hz = f_gc
                phase_margin_deg  = 180.0 + p_gc
                break

        # Phase crossover: where phase = -180°
        phase_crossover_hz = None
        gain_margin_db     = None
        for j in range(1, len(phase_unwrapped)):
            if phase_unwrapped[j - 1] > -180 >= phase_unwrapped[j]:
                f_pc = float(np.interp(-180, [phase_unwrapped[j], phase_unwrapped[j-1]], [freqs[j], freqs[j-1]]))
                g_pc = float(np.interp(f_pc, freqs, magnitude_db))
                phase_crossover_hz = f_pc
                gain_margin_db     = -g_pc
                break

        prefix = f"{axis}_bode"
        results[f"{prefix}_freqs"]             = freqs.tolist()
        results[f"{prefix}_magnitude_db"]      = magnitude_db.tolist()
        results[f"{prefix}_phase_deg"]         = phase_deg.tolist()
        results[f"{prefix}_phase_unwrapped"]   = phase_unwrapped.tolist()
        results[f"{prefix}_coherence"]         = coherence.tolist()
        results[f"{prefix}_gain_crossover_hz"] = gain_crossover_hz
        results[f"{prefix}_phase_margin_deg"]  = phase_margin_deg
        results[f"{prefix}_phase_crossover_hz"]= phase_crossover_hz
        results[f"{prefix}_gain_margin_db"]    = gain_margin_db

        # Stability interpretation
        if phase_margin_deg is not None:
            if phase_margin_deg >= 45:
                stability = "stable"
            elif phase_margin_deg >= 20:
                stability = "marginal"
            else:
                stability = "unstable"
            results[f"{prefix}_stability"] = stability

    return results


# ---------------------------------------------------------------------------
# 6. Governor / headspeed stability
# ---------------------------------------------------------------------------

def governor_analysis(
    df: pd.DataFrame,
    col: ColumnMap,
    sample_rate_hz: float,
    target_headspeed: int | None = None,
) -> dict[str, Any]:
    """
    Analyse headspeed stability, throttle-induced sag, and recovery.

    Uses logged 'headspeed' column. If not present, falls back to EscRPM.
    """
    results: dict[str, Any] = {}

    hs = _col(df, col.headspeed)
    if not _valid(hs):
        hs = _col(df, col.esc_rpm)
    if not _valid(hs):
        return {"governor_note": "No headspeed or ESC RPM data available"}

    hs_clean = hs[~np.isnan(hs)]
    if len(hs_clean) < 10:
        return {}

    results["hs_mean_rpm"]   = float(np.mean(hs_clean))
    results["hs_std_rpm"]    = float(np.std(hs_clean))
    results["hs_min_rpm"]    = float(np.min(hs_clean))
    results["hs_max_rpm"]    = float(np.max(hs_clean))
    results["hs_range_rpm"]  = float(np.max(hs_clean) - np.min(hs_clean))
    results["_units_hs"]     = "RPM"

    if target_headspeed and target_headspeed > 0:
        deviation = hs_clean - target_headspeed
        results["hs_target_rpm"]         = target_headspeed
        results["hs_mean_deviation_rpm"] = float(np.mean(deviation))
        results["hs_rms_deviation_rpm"]  = float(_rms(deviation))
        results["hs_max_sag_rpm"]        = float(np.min(deviation))
        results["hs_stability_pct"]      = float(
            100.0 * (1.0 - np.std(hs_clean) / target_headspeed)
        )

    # RPM droop events: drops > 2% of mean
    threshold = results["hs_mean_rpm"] * 0.02
    droop_mask = hs_clean < (results["hs_mean_rpm"] - threshold)
    results["hs_droop_event_count"] = int(
        np.sum(np.diff(droop_mask.astype(int)) == 1)
    )

    # Governor throttle correlation
    thr = _col(df, col.esc_throttle)
    if _valid(thr):
        n = min(len(hs), len(thr))
        valid = ~(np.isnan(hs[:n]) | np.isnan(thr[:n]))
        if valid.sum() > 10:
            r, _ = pearsonr(hs[:n][valid], thr[:n][valid])
            results["hs_throttle_correlation"] = float(r)

    return results


# ---------------------------------------------------------------------------
# 7. PIDF balance
# ---------------------------------------------------------------------------

def pidf_balance(
    df: pd.DataFrame,
    col: ColumnMap,
) -> dict[str, Any]:
    """
    Compute relative contribution of each PIDF term to total output per axis.

    Contribution = RMS(term) / (RMS(P) + RMS(I) + RMS(D) + RMS(F) + ε)

    Also computes D/P ratio (a useful oscillation indicator: D/P > 0.7 → D-heavy).
    """
    results: dict[str, Any] = {}

    term_cols = {
        "P": col.axis_p,
        "I": col.axis_i,
        "D": col.axis_d,
        "F": col.axis_f,
        "B": col.axis_b,
        "O": col.axis_o,
    }

    for i, axis in enumerate(AXIS_NAMES):
        term_rms = {}
        for term, cols_list in term_cols.items():
            c = cols_list[i] if cols_list else None
            arr = _col(df, c)
            term_rms[term] = _rms(arr) if _valid(arr) else 0.0

        total = sum(term_rms.values()) + 1e-9

        for term, rms_val in term_rms.items():
            results[f"{axis}_{term}_rms"]          = float(rms_val)
            results[f"{axis}_{term}_contribution"] = float(rms_val / total)

        results[f"{axis}_total_rms"] = float(total)

        # D/P ratio
        if term_rms["P"] > 1e-6:
            results[f"{axis}_D_P_ratio"] = float(term_rms["D"] / term_rms["P"])

        # I wind-up indicator: I contribution > 40% suggests slow decay or wind-up
        results[f"{axis}_i_windup_flag"] = bool(
            term_rms["I"] / total > 0.40
        )

    return results


# ---------------------------------------------------------------------------
# 8. Control latency
# ---------------------------------------------------------------------------

def control_latency(
    df: pd.DataFrame,
    col: ColumnMap,
    sample_rate_hz: float,
    max_lag_ms: float = 50.0,
) -> dict[str, Any]:
    """
    Estimate control latency per axis via cross-correlation of setpoint → gyro.

    The lag at peak cross-correlation = end-to-end latency from RC input
    to gyro response (includes PID processing + actuator delay).

    Returns lag in samples and milliseconds, plus correlation strength.
    """
    results: dict[str, Any] = {}
    max_lag_samples = int(max_lag_ms * sample_rate_hz / 1000)

    for i, axis in enumerate(AXIS_NAMES):
        sp = _col(df, col.setpoint[i])
        gy = _col(df, col.gyro_filtered[i])

        if not _valid(sp) or not _valid(gy):
            continue

        n = min(len(sp), len(gy))
        sp_c = np.nan_to_num(sp[:n] - np.nanmean(sp[:n]))
        gy_c = np.nan_to_num(gy[:n] - np.nanmean(gy[:n]))

        # Normalised cross-correlation
        norm = (np.std(sp_c) * np.std(gy_c) * n) + 1e-12
        xcorr = np.correlate(gy_c, sp_c, mode="full") / norm

        mid = len(xcorr) // 2
        # Search only positive lags (gyro must lag setpoint)
        search = xcorr[mid: mid + max_lag_samples]

        if len(search) == 0:
            continue

        peak_idx  = int(np.argmax(search))
        peak_corr = float(search[peak_idx])

        lag_ms = peak_idx / sample_rate_hz * 1000.0

        results[f"{axis}_latency_samples"] = peak_idx
        results[f"{axis}_latency_ms"]      = float(lag_ms)
        results[f"{axis}_xcorr_peak"]      = peak_corr
        results[f"{axis}_latency_reliable"] = bool(peak_corr > 0.3)

    results["_units_latency"] = "ms"
    return results


# ---------------------------------------------------------------------------
# 9. Servo analysis
# ---------------------------------------------------------------------------

def servo_analysis(
    df: pd.DataFrame,
    col: ColumnMap,
    sample_rate_hz: float,
    servo_min: int = 500,
    servo_max: int = 1000,
) -> dict[str, Any]:
    """
    Analyse servo activity and range utilisation.

    Servo indices for a typical Rotorflight 3-blade CCPM:
      servo[0] = aileron/rear
      servo[1] = elevator/left-front
      servo[2] = collective/right-front
      servo[3] = tail (variable-pitch or gyro-controlled)
    """
    results: dict[str, Any] = {}
    servo_range = servo_max - servo_min

    for j, srv_col in enumerate(col.servo):
        arr = _col(df, srv_col)
        if not _valid(arr):
            continue

        clean = arr[~np.isnan(arr)]
        if len(clean) < 10:
            continue

        utilisation = float(np.ptp(clean) / servo_range * 100)
        results[f"servo{j}_mean"]         = float(np.mean(clean))
        results[f"servo{j}_std"]          = float(np.std(clean))
        results[f"servo{j}_min"]          = float(np.min(clean))
        results[f"servo{j}_max"]          = float(np.max(clean))
        results[f"servo{j}_range_utilisation_pct"] = utilisation
        results[f"servo{j}_rms_activity"] = float(_rms(np.diff(clean)))

        # Correlation with roll/pitch/collective setpoints
        for k, axis in enumerate(["roll", "pitch", "collective"]):
            if k < len(col.setpoint):
                sp = _col(df, col.setpoint[k])
                if _valid(sp):
                    n = min(len(clean), len(sp))
                    valid = ~np.isnan(sp[:n])
                    if valid.sum() > 10:
                        try:
                            r, _ = pearsonr(clean[:n][valid], sp[:n][valid])
                            results[f"servo{j}_{axis}_correlation"] = float(r)
                        except Exception:
                            pass

    return results


# ---------------------------------------------------------------------------
# 10. Master analysis runner
# ---------------------------------------------------------------------------

def run_all(
    df: pd.DataFrame,
    col: ColumnMap,
    sample_rate_hz: float,
    pid_profile: dict | None = None,
    global_filters: dict | None = None,
    target_headspeed: int | None = None,
    fft_cfg: FFTConfig | None = None,
    bode_nperseg: int = 1024,
    bode_overlap: float = 0.75,
) -> dict[str, dict]:
    """
    Run all analysis modules on a segment DataFrame.

    Returns a dict of module_name → results_dict.
    Individual module failures are caught and reported without stopping others.
    """
    modules = {
        "tracking_error":    lambda: tracking_error(df, col),
        "step_response":     lambda: step_response(df, col, sample_rate_hz),
        "oscillation":       lambda: oscillation_detection(df, col, sample_rate_hz),
        "fft_vibration":     lambda: fft_vibration(df, col, sample_rate_hz, pid_profile, global_filters, fft_cfg),
        "bode_coherence":    lambda: bode_coherence(df, col, sample_rate_hz, bode_nperseg, bode_overlap),
        "governor":          lambda: governor_analysis(df, col, sample_rate_hz, target_headspeed),
        "pidf_balance":      lambda: pidf_balance(df, col),
        "control_latency":   lambda: control_latency(df, col, sample_rate_hz),
        "servo":             lambda: servo_analysis(df, col, sample_rate_hz),
    }

    results: dict[str, dict] = {}
    for name, fn in modules.items():
        try:
            results[name] = fn()
        except Exception as exc:
            results[name] = {"error": str(exc)}

    return results
