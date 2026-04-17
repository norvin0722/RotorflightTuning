"""
Rotorflight analysis engine.

Dynamics model matches RFAnalyzerTool.html exactly:
  G_OL(jω) = Kp_eff / (jω · τ_mech) · PT1(fc_gyro)
  PM = 180 - 90 - arctan(ω_gc / ω_c)
  Kp_eff = P_gain / 156   (RF internal scaling confirmed empirically)
  τ_mech = 50 ms (roll/pitch),  15 ms (yaw)
  fc_gyro = per-axis gyro cutoff from matched PID profile (default 65/65/160 Hz)
  Kp extracted as median(axisP / axisError) where |axisError| > 10
"""
import numpy as np
from scipy import signal as scipy_signal
import math

AXES = ["roll", "pitch", "yaw"]

# ── column helpers ────────────────────────────────────────────────────────────
def _col(df, name):
    if name in df.columns:
        return df[name].fillna(0).to_numpy(dtype=float)
    return np.zeros(len(df))

def _safe(arr):
    return np.nan_to_num(arr, nan=0.0, posinf=0.0, neginf=0.0)


# ═══════════════════════════════════════════════════════════════════════════════
# ANALYTICAL DYNAMICS MODEL  (identical to RFAnalyzerTool.html computeDynamics)
# ═══════════════════════════════════════════════════════════════════════════════

def _compute_dynamics(kp_eff: float, tau_mech_s: float, fc_gyro_hz: float) -> dict:
    """
    Open-loop model:  G_OL(jω) = Kp_eff / (jω·τ_mech) · 1/√(1+(ω/ωc)²)
    Returns: f_gc, pm, f_bw, freqs[], mags_dB[], mags_cl_dB[]
    """
    wc = 2 * math.pi * fc_gyro_hz

    def mag_ol(w):
        return kp_eff / (w * tau_mech_s) / math.sqrt(1 + (w / wc) ** 2)

    # Binary search for gain crossover |G_OL| = 1
    w_lo, w_hi = 0.001, 10000.0
    for _ in range(80):
        wm = (w_lo + w_hi) / 2
        (w_lo if mag_ol(wm) > 1 else w_hi).__class__  # dummy
        if mag_ol(wm) > 1:
            w_lo = wm
        else:
            w_hi = wm
    w_gc = (w_lo + w_hi) / 2
    f_gc = w_gc / (2 * math.pi)

    # Phase at crossover: plant contributes -90° (integrator) + LPF phase
    pm = 180.0 - 90.0 - math.degrees(math.atan(w_gc / wc))

    # Closed-loop -3 dB bandwidth
    def mag_cl(w):
        G_mag = kp_eff / (w * tau_mech_s) / math.sqrt(1 + (w / wc) ** 2)
        G_ph  = -math.pi / 2 - math.atan(w / wc)
        Gr    = G_mag * math.cos(G_ph)
        Gi    = G_mag * math.sin(G_ph)
        dr, di = 1 + Gr, Gi
        dm2   = dr * dr + di * di
        return math.sqrt((Gr*Gr + Gi*Gi) / dm2) if dm2 > 0 else 0.0

    b_lo, b_hi = w_gc * 0.01, w_gc * 50
    for _ in range(80):
        bm = (b_lo + b_hi) / 2
        if mag_cl(bm) > 0.707:
            b_lo = bm
        else:
            b_hi = bm
    f_bw = (b_lo + b_hi) / 2 / (2 * math.pi)

    # Bode curves for frontend chart
    freqs_out, mags_ol, mags_cl = [], [], []
    exp = -1.3
    while exp <= 2.3:
        f = 10 ** exp
        w = 2 * math.pi * f
        freqs_out.append(round(f, 4))
        mags_ol.append(round(20 * math.log10(max(1e-9, mag_ol(w))), 3))
        mags_cl.append(round(20 * math.log10(max(1e-9, mag_cl(w))), 3))
        exp += 0.04

    return {
        "f_gc":       f_gc,
        "pm":         pm,
        "f_bw":       f_bw,
        "freqs":      freqs_out,
        "mags_ol_db": mags_ol,
        "mags_cl_db": mags_cl,
    }


def _extract_kp(df, axis_idx: int):
    """
    Empirical Kp = median(axisP / axisError) where |axisError| > 10.
    Matches RFAnalyzerTool.html extractKp() exactly.
    """
    P = _safe(_col(df, f"axisP[{axis_idx}]"))
    E = _safe(_col(df, f"axisError[{axis_idx}]"))
    # axisError may not exist — fall back to gyro - setpoint
    if np.all(E == 0):
        E = _safe(_col(df, f"gyroADC[{axis_idx}]")) - _safe(_col(df, f"setpoint[{axis_idx}]"))

    for threshold in [10, 5, 2, 1]:
        mask   = np.abs(E) > threshold
        ratios = P[mask] / E[mask]
        ratios = ratios[np.isfinite(ratios)]
        if len(ratios) >= 20:
            return float(np.median(ratios))
    return None


# ═══════════════════════════════════════════════════════════════════════════════
# STEP LATENCY  (matches RFAnalyzerTool.html measureStepLatency exactly)
# ═══════════════════════════════════════════════════════════════════════════════

def _measure_step_latency(df, axis_idx: int, fs: float) -> dict:
    sp    = _safe(_col(df, f"setpoint[{axis_idx}]"))
    gyro  = _safe(_col(df, f"gyroADC[{axis_idx}]"))
    t     = _safe(_col(df, "time"))
    dt_ms = 1000.0 / fs

    def find_plateaus(arr, tol=6, min_dur=18):
        out, i = [], 0
        while i < len(arr):
            val = arr[i]
            j = i
            while j < len(arr) and abs(arr[j] - val) <= tol:
                j += 1
            if j - i >= min_dur:
                out.append({"start": i, "end": j, "val": float(val)})
            i = max(j, i + 1)
        return out

    plateaus = find_plateaus(sp)
    lags     = []

    for k in range(1, len(plateaus)):
        prev, curr = plateaus[k-1], plateaus[k]
        if abs(curr["val"] - prev["val"]) < 25:
            continue
        step_start = prev["end"]
        base, target = prev["val"], curr["val"]
        half = base + (target - base) * 0.5
        direction = 1 if target > base else -1

        sp_half = None
        for i in range(step_start, min(curr["end"] + 5, len(sp))):
            if direction * (sp[i] - half) >= 0:
                sp_half = i
                break
        gy_half = None
        for i in range(step_start, min(step_start + 120, len(gyro))):
            if direction * (gyro[i] - half) >= 0:
                gy_half = i
                break

        if sp_half is not None and gy_half is not None and gy_half >= sp_half:
            lag = (gy_half - sp_half) * dt_ms
            if 0 <= lag < 200:
                lags.append(lag)

    if not lags:
        return {"median": None, "std": None, "lags": [], "dt_ms": dt_ms}
    lags.sort()
    median   = float(np.median(lags))
    std      = float(np.std(lags))
    return {"median": median, "std": std, "lags": lags, "dt_ms": dt_ms}


# ═══════════════════════════════════════════════════════════════════════════════
# REMAINING MODULES (unchanged)
# ═══════════════════════════════════════════════════════════════════════════════

def _tracking_error(df):
    out = {}
    for i, ax in enumerate(AXES):
        gyro = _safe(_col(df, f"gyroADC[{i}]"))
        sp   = _safe(_col(df, f"setpoint[{i}]"))
        err  = gyro - sp
        out[f"rms_{ax}"]  = float(np.sqrt(np.mean(err**2)))
        out[f"peak_{ax}"] = float(np.max(np.abs(err)))
        out[f"mean_{ax}"] = float(np.mean(err))
        out[f"std_{ax}"]  = float(np.std(err))
    return out


def _oscillation(df, fs):
    out = {}
    for i, ax in enumerate(AXES):
        gyro = _safe(_col(df, f"gyroADC[{i}]"))
        if len(gyro) < 256:
            out[f"dominant_hz_{ax}"] = 0.0
            out[f"severity_{ax}"]    = "none"
            continue
        freqs, psd = scipy_signal.welch(gyro, fs=fs, nperseg=min(1024, len(gyro)//2))
        mask = (freqs >= 5) & (freqs <= fs/2)
        if not mask.any():
            out[f"dominant_hz_{ax}"] = 0.0
            out[f"severity_{ax}"]    = "none"
            continue
        peak_idx = int(np.argmax(psd[mask]))
        peak_hz  = float(freqs[mask][peak_idx])
        snr      = float(psd[mask][peak_idx]) / (float(np.percentile(psd[mask], 20)) + 1e-12)
        severity = "none" if snr < 3 else "mild" if snr < 10 else "moderate" if snr < 30 else "severe"
        out[f"dominant_hz_{ax}"] = peak_hz
        out[f"severity_{ax}"]    = severity
    return out


def _fft(df, fs):
    out = {}
    nperseg     = min(1024, max(256, len(df) // 4))
    freqs_stored = False
    for i, ax in enumerate(AXES):
        raw = _safe(_col(df, f"gyroRAW[{i}]"))
        adc = _safe(_col(df, f"gyroADC[{i}]"))
        if len(raw) < nperseg:
            continue
        freqs, psd_raw = scipy_signal.welch(raw, fs=fs, nperseg=nperseg)
        _,     psd_adc = scipy_signal.welch(adc, fs=fs, nperseg=nperseg)
        mask   = (freqs >= 20) & (freqs <= 350)
        df_bin = float(freqs[1] - freqs[0]) if len(freqs) > 1 else 1.0
        rms_raw = float(np.sqrt(np.sum(psd_raw[mask]) * df_bin))
        rms_adc = float(np.sqrt(np.sum(psd_adc[mask]) * df_bin))
        atten   = float(20 * np.log10(max(rms_adc, 1e-9) / max(rms_raw, 1e-9))) if rms_raw > 0 else 0.0
        out[f"rms_raw_{ax}"]        = rms_raw
        out[f"rms_adc_{ax}"]        = rms_adc
        out[f"attenuation_db_{ax}"] = atten
        step = max(1, len(freqs) // 512)
        out[f"psd_raw_{ax}"] = psd_raw[::step].tolist()
        out[f"psd_adc_{ax}"] = psd_adc[::step].tolist()
        if not freqs_stored:
            out["freqs"]   = freqs[::step].tolist()
            out["fs"]      = float(fs)
            out["nfft"]    = int(nperseg)
            out["frames"]  = int(max(1, (len(raw) - nperseg) // (nperseg // 2)))
            out["max_hz"]  = float(min(fs / 2, 500))
            freqs_stored   = True
    return out


def _governor(df):
    out = {}
    hs = _safe(_col(df, "headspeed"))
    hs_valid = hs[hs > 100]
    if not len(hs_valid):
        hs_valid = _safe(_col(df, "EscRPM"))
        hs_valid = hs_valid[hs_valid > 100]
    if len(hs_valid):
        out["headspeed_mean"]  = float(np.mean(hs_valid))
        out["headspeed_std"]   = float(np.std(hs_valid))
        out["headspeed_sag"]   = float(np.mean(hs_valid) - np.min(hs_valid))
        out["headspeed_droop"] = float(np.percentile(hs_valid, 95) - np.percentile(hs_valid, 5))
    else:
        out.update({"headspeed_mean": 0.0, "headspeed_std": 0.0,
                    "headspeed_sag":  0.0, "headspeed_droop": 0.0})
    step = max(1, len(hs) // 1000)
    out["headspeed_series"] = hs[::step].tolist()
    return out


def _pidf_balance(df):
    out = {}
    for i, ax in enumerate(AXES):
        P = np.abs(_safe(_col(df, f"axisP[{i}]")))
        I = np.abs(_safe(_col(df, f"axisI[{i}]")))
        D = np.abs(_safe(_col(df, f"axisD[{i}]")))
        F = np.abs(_safe(_col(df, f"axisF[{i}]")))
        total = (np.mean(P) + np.mean(I) + np.mean(D) + np.mean(F)) or 1.0
        for term, arr in [("p",P),("i",I),("d",D),("f",F)]:
            out[f"{term}_pct_{ax}"]  = float(np.mean(arr) / total * 100)
            out[f"{term}_mean_{ax}"] = float(np.mean(arr))
        out[f"d_p_ratio_{ax}"] = float(np.mean(D) / (np.mean(P) + 1e-6))
        out[f"i_windup_{ax}"]  = 1.0 if np.mean(I) > 3 * np.mean(P) else 0.0
    return out


def _noise(df):
    out = {}
    for i, ax in enumerate(AXES):
        raw = _safe(_col(df, f"gyroRAW[{i}]"))
        adc = _safe(_col(df, f"gyroADC[{i}]"))
        out[f"raw_std_{ax}"] = float(np.std(raw))
        out[f"std_{ax}"]     = float(np.std(adc))
        out[f"raw_rms_{ax}"] = float(np.sqrt(np.mean(raw**2)))
        out[f"rms_{ax}"]     = float(np.sqrt(np.mean(adc**2)))
    return out


def _overview(df, fs):
    out = {}
    vbat = _safe(_col(df, "Vbat"))
    ibat = _safe(_col(df, "Ibat"))
    t    = _safe(_col(df, "time"))
    valid_v = vbat[vbat > 0]
    valid_i = ibat[ibat > 0]
    out["vbat_mean"] = float(np.mean(valid_v) / 100) if len(valid_v) else 0.0
    out["ibat_mean"] = float(np.mean(valid_i) / 100) if len(valid_i) else 0.0
    out["duration_s"] = float((t[-1] - t[0]) / 1_000_000) if len(t) > 1 else float(len(df) / fs)
    step = max(1, len(t) // 1000)
    if len(t) > 1:
        t0 = t[0]
        out["time_s"] = ((t[::step] - t0) / 1_000_000).tolist()
    else:
        out["time_s"] = list(range(0, len(df), step))
    step2 = max(1, len(df) // 1000)
    for i in range(3):
        ax = AXES[i]
        out[f"gyro_raw_{ax}"]    = _safe(_col(df, f"gyroRAW[{i}]"))[::step2].tolist()
        out[f"gyro_adc_{ax}"]    = _safe(_col(df, f"gyroADC[{i}]"))[::step2].tolist()
        out[f"setpoint_{ax}"]    = _safe(_col(df, f"setpoint[{i}]"))[::step2].tolist()
        out[f"pid_p_{ax}"]       = _safe(_col(df, f"axisP[{i}]"))[::step2].tolist()
        out[f"pid_i_{ax}"]       = _safe(_col(df, f"axisI[{i}]"))[::step2].tolist()
        out[f"pid_d_{ax}"]       = _safe(_col(df, f"axisD[{i}]"))[::step2].tolist()
        out[f"pid_f_{ax}"]       = _safe(_col(df, f"axisF[{i}]"))[::step2].tolist()
        E = _safe(_col(df, f"axisError[{i}]"))
        if np.all(E == 0):
            E = _safe(_col(df, f"gyroADC[{i}]")) - _safe(_col(df, f"setpoint[{i}]"))
        out[f"axis_error_{ax}"]  = E[::step2].tolist()
        out[f"headspeed_{ax}"]   = _safe(_col(df, "headspeed"))[::step2].tolist()
        out[f"gov_target_{ax}"]  = _safe(_col(df, "headspeed"))[::step2].tolist()
    return out


# ═══════════════════════════════════════════════════════════════════════════════
# MASTER RUNNER
# ═══════════════════════════════════════════════════════════════════════════════

# τ_mech per axis: cyclic = 50 ms, yaw = 15 ms  (from RFAnalyzerTool)
TAU_MECH = [0.050, 0.050, 0.015]
# Default fc_gyro if no config dump: roll/pitch=65Hz, yaw=160Hz
FC_DEFAULT = [65.0, 65.0, 160.0]
# RF internal P-gain scaling factor (empirically confirmed: Kp_eff = P_gain / 156)
RF_P_SCALE = 156.0


def run_full_analysis(df, sample_rate_hz: float, config_data: dict = None) -> dict:
    """
    config_data (optional): output of rf_config_parser.parse_dump() for this flight.
    Used to get per-axis gyro cutoff and P-gain from the matched PID profile.
    """
    fs = float(sample_rate_hz)

    # ── Resolve per-axis fc_gyro and P_gain from config if available ─────────
    hs_arr2 = _safe(_col(df, "headspeed"))
    hs_valid2 = hs_arr2[hs_arr2 > 100]
    avg_hs = float(np.mean(hs_valid2)) if len(hs_valid2) else 0.0

    fc_gyro = list(FC_DEFAULT)
    cfg_p   = [None, None, None]

    if config_data:
        profiles = config_data.get("pidProfiles", [])
        best = None
        if avg_hs > 0 and profiles:
            best_d = float("inf")
            for p in profiles:
                rpm = p.get("targetRPM")
                if rpm and abs(rpm - avg_hs) < best_d:
                    best_d = abs(rpm - avg_hs)
                    best = p
        if best is None and profiles:
            for p in profiles:
                if p.get("roll", {}).get("P") or p.get("pitch", {}).get("P"):
                    best = p
                    break
        if best:
            filts = best.get("filters", {})
            fc_gyro[0] = float(filts.get("rollGyroCutoff")  or FC_DEFAULT[0])
            fc_gyro[1] = float(filts.get("pitchGyroCutoff") or FC_DEFAULT[1])
            yaw_fc_cfg = filts.get("yawGyroCutoff") or 0
            fc_gyro[2] = float(yaw_fc_cfg) if yaw_fc_cfg > 0 else FC_DEFAULT[2]
            cfg_p[0]   = best.get("roll",  {}).get("P")
            cfg_p[1]   = best.get("pitch", {}).get("P")
            cfg_p[2]   = best.get("yaw",   {}).get("P")

    # ── Dynamics (analytical model, identical to RFAnalyzerTool) ─────────────
    dynamics_out = {}
    bode_out     = {}

    for i, ax in enumerate(AXES):
        # Priority order matches RFAnalyzerTool.html renderDynamicsTab():
        # 1. Config P-gain / 156  (preferred — exact, no measurement noise)
        # 2. Empirical median(axisP/axisError) — used when no config available
        # 3. Hard-coded fallback (0.7 cyclic / 0.6 yaw)
        #
        # Note: empirical Kp is unreliable on hover logs (yaw axisError ~0),
        # so we prefer cfg whenever available. For step-input logs without
        # config, empirical extraction is accurate.
        kp_emp = _extract_kp(df, i)

        if cfg_p[i] is not None and cfg_p[i] > 0:
            kp_eff = cfg_p[i] / RF_P_SCALE
        elif kp_emp is not None and abs(kp_emp) > 0.01:
            kp_eff = abs(kp_emp)
        else:
            kp_eff = (0.7 if i < 2 else 0.6)

        dyn = _compute_dynamics(kp_eff, TAU_MECH[i], fc_gyro[i])

        p_implied = round(kp_eff * RF_P_SCALE)
        dynamics_out[f"phase_margin_{ax}"]  = round(dyn["pm"],   2)
        dynamics_out[f"bandwidth_{ax}"]     = round(dyn["f_bw"], 4)
        dynamics_out[f"gain_crossover_{ax}"]= round(dyn["f_gc"], 4)
        dynamics_out[f"fc_gyro_{ax}"]       = float(fc_gyro[i])
        dynamics_out[f"kp_eff_{ax}"]        = round(kp_eff, 4)
        dynamics_out[f"p_gain_implied_{ax}"]= p_implied
        dynamics_out[f"cfg_p_{ax}"]         = cfg_p[i]

        bode_out[f"ol_mag_{i}"] = dyn["mags_ol_db"]
        bode_out[f"cl_mag_{i}"] = dyn["mags_cl_db"]
        if i == 0:
            bode_out["freqs"] = dyn["freqs"]

    # ── Step latency ──────────────────────────────────────────────────────────
    latency_out = {}
    for i, ax in enumerate(AXES):
        lat = _measure_step_latency(df, i, fs)
        latency_out[f"median_{ax}"] = lat["median"] if lat["median"] is not None else 0.0
        latency_out[f"std_{ax}"]    = lat["std"]    if lat["std"]    is not None else 0.0
        latency_out[f"n_steps_{ax}"]= float(len(lat["lags"]))
        latency_out[f"lags_{ax}"]   = lat["lags"][:20]  # store first 20 for chart dots

    return {
        "overview":        _overview(df, fs),
        "tracking_error":  _tracking_error(df),
        "oscillation":     _oscillation(df, fs),
        "fft":             _fft(df, fs),
        "bode":            bode_out,
        "dynamics":        dynamics_out,
        "governor":        _governor(df),
        "pidf_balance":    _pidf_balance(df),
        "control_latency": latency_out,
        "noise":           _noise(df),
    }
