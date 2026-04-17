"""
Parse Rotorflight "dump all" CLI output.

Key name reference (confirmed from RFAnalyzerTool.html source):
  gyro_rpm_notch_source_roll/pitch/yaw   — per-axis source arrays (comma-separated ints)
  gyro_rpm_notch_q_roll/pitch/yaw        — per-axis Q×10 arrays
  gyro_rpm_notch_center_roll/pitch/yaw   — per-axis center offsets in 0.1 Hz units

Source encoding (tens=group, units=harmonic):
  10 → Motor fundamental    (motor_hz = headspeed × main_gear_denom/numer / 60)
  11 → MR Fundamental       (headspeed / 60)
  12 → MR 2nd harmonic      (2 × headspeed / 60)
  13 → MR 3rd harmonic
  14 → MR 4th harmonic
  21 → TR Fundamental       (headspeed × tail_ratio / 60)
  22 → TR 2nd harmonic
  etc.

Gear ratio storage: "342,3808" = numerator,denominator
  main_rotor_hz = headspeed_rpm / 60
  motor_hz      = headspeed_rpm × (denom / numer) / 60
  tail_rotor_hz = headspeed_rpm × (tail_numer / tail_denom) / 60
"""
import re


def _get_val(lines, key):
    pattern = re.compile(rf"^set\s+{re.escape(key)}\s*=\s*(.+)$")
    for line in lines:
        m = pattern.match(line.strip())
        if m:
            return m.group(1).strip()
    return None


def _get_num(lines, key):
    v = _get_val(lines, key)
    if v is None:
        return None
    try:
        return int(v)
    except ValueError:
        try:
            return float(v)
        except ValueError:
            return None


def _section_lines(all_lines, marker):
    sections = []
    cur = None
    pattern = re.compile(rf"^{re.escape(marker)}\s+(\d+)$")
    for line in all_lines:
        m = pattern.match(line.strip())
        if m:
            if cur is not None:
                sections.append(cur)
            cur = {"idx": int(m.group(1)), "lines": []}
        elif cur is not None:
            cur["lines"].append(line.strip())
    if cur is not None:
        sections.append(cur)
    seen = {}
    for s in sections:
        if any("restore original" in l for l in s["lines"]):
            continue
        seen[s["idx"]] = s
    return list(seen.values())


def _section_num(section, key):
    v = _get_val(section["lines"], key)
    if v is None:
        return None
    try:
        return int(v)
    except ValueError:
        try:
            return float(v)
        except ValueError:
            return None


def parse_dump(text: str) -> dict:
    lines = text.splitlines()

    name = _get_val(lines, "name") or ""
    firmware = None
    for line in lines:
        m = re.match(r"#\s*Rotorflight\s+/\s*(\S+)", line)
        if m:
            firmware = m.group(1)
            break

    # ── Global gyro filters ────────────────────────────────────────────────
    # Correct key names verified against RFAnalyzerTool.html parseRFDump()
    gf = {
        "lpf1Type":        _get_val(lines, "gyro_lpf1_type") or "NONE",
        "lpf1Hz":          _get_num(lines, "gyro_lpf1_static_hz") or 0,
        "lpf1DynMin":      _get_num(lines, "gyro_lpf1_dyn_min_hz"),
        "lpf1DynMax":      _get_num(lines, "gyro_lpf1_dyn_max_hz"),
        "lpf2Type":        _get_val(lines, "gyro_lpf2_type") or "NONE",
        "lpf2Hz":          _get_num(lines, "gyro_lpf2_static_hz") or 0,
        "dynNotchCount":   _get_num(lines, "dyn_notch_count") or 0,
        "dynNotchQ":       _get_num(lines, "dyn_notch_q") or 0,
        "dynNotchMinHz":   _get_num(lines, "dyn_notch_min_hz") or 0,
        "dynNotchMaxHz":   _get_num(lines, "dyn_notch_max_hz") or 0,
        "rpmNotchMinHz":   _get_num(lines, "gyro_rpm_notch_min_hz") or 0,
        # ── CORRECT key names for per-axis RPM notch config ──
        "rpmSourceRoll":   _get_val(lines, "gyro_rpm_notch_source_roll")   or "",
        "rpmSourcePitch":  _get_val(lines, "gyro_rpm_notch_source_pitch")  or "",
        "rpmSourceYaw":    _get_val(lines, "gyro_rpm_notch_source_yaw")    or "",
        "rpmQRoll":        _get_val(lines, "gyro_rpm_notch_q_roll")        or "",
        "rpmQPitch":       _get_val(lines, "gyro_rpm_notch_q_pitch")       or "",
        "rpmQYaw":         _get_val(lines, "gyro_rpm_notch_q_yaw")         or "",
        "rpmCenterRoll":   _get_val(lines, "gyro_rpm_notch_center_roll")   or "",
        "rpmCenterPitch":  _get_val(lines, "gyro_rpm_notch_center_pitch")  or "",
        "rpmCenterYaw":    _get_val(lines, "gyro_rpm_notch_center_yaw")    or "",
    }

    # ── Gear ratios ────────────────────────────────────────────────────────
    # Stored as "numerator,denominator" e.g. "342,3808"
    # motor_hz = headspeed × (denom / numer) / 60
    main_gear_str = _get_val(lines, "main_rotor_gear_ratio") or "1,1"
    tail_gear_str = _get_val(lines, "tail_rotor_gear_ratio") or "1,1"
    main_gear = _parse_ratio(main_gear_str)  # [numer, denom]
    tail_gear = _parse_ratio(tail_gear_str)

    motor_poles_str = _get_val(lines, "motor_poles") or "10"
    motor_poles = [int(x.strip()) for x in motor_poles_str.split(",") if x.strip().isdigit()]
    motor_poles_main = motor_poles[0] if motor_poles else 10

    # ── PID profiles ──────────────────────────────────────────────────────
    pid_sections = _section_lines(lines, "profile")
    pid_profiles = []
    for s in pid_sections:
        pid_profiles.append({
            "idx": s["idx"],
            "targetRPM": _section_num(s, "gov_headspeed"),
            # Rotorflight uses *_p_gain / *_i_gain / *_d_gain / *_f_gain
            "roll":  {"P": _section_num(s, "roll_p_gain"),  "I": _section_num(s, "roll_i_gain"),
                      "D": _section_num(s, "roll_d_gain"),  "F": _section_num(s, "roll_f_gain")},
            "pitch": {"P": _section_num(s, "pitch_p_gain"), "I": _section_num(s, "pitch_i_gain"),
                      "D": _section_num(s, "pitch_d_gain"), "F": _section_num(s, "pitch_f_gain")},
            "yaw":   {"P": _section_num(s, "yaw_p_gain"),   "I": _section_num(s, "yaw_i_gain"),
                      "D": _section_num(s, "yaw_d_gain"),   "F": _section_num(s, "yaw_f_gain")},
            "gov":   {
                "P": _section_num(s, "gov_p_gain"), "I": _section_num(s, "gov_i_gain"),
                "F": _section_num(s, "gov_f_gain"),
                "cyclicFF":  _section_num(s, "yaw_cyclic_ff_gain"),
                "collectFF": _section_num(s, "yaw_collective_ff_gain"),
            },
            "filters": {
                "rollGyroCutoff":  _section_num(s, "roll_gyro_cutoff")  or 0,
                "pitchGyroCutoff": _section_num(s, "pitch_gyro_cutoff") or 0,
                "yawGyroCutoff":   _section_num(s, "yaw_gyro_cutoff")   or 0,
                "rollDCutoff":     _section_num(s, "roll_d_cutoff")     or 0,
                "pitchDCutoff":    _section_num(s, "pitch_d_cutoff")    or 0,
                "yawDCutoff":      _section_num(s, "yaw_d_cutoff")      or 0,
            },
        })

    # ── Rate profiles ─────────────────────────────────────────────────────
    rate_sections = _section_lines(lines, "rateprofile")
    rate_profiles = []
    for s in rate_sections:
        rate_profiles.append({
            "idx": s["idx"],
            "roll":  {"rcRate": _section_num(s, "roll_rc_rate"),
                      "srate":  _section_num(s, "roll_srate"),
                      "expo":   _section_num(s, "roll_expo")},
            "pitch": {"rcRate": _section_num(s, "pitch_rc_rate"),
                      "srate":  _section_num(s, "pitch_srate"),
                      "expo":   _section_num(s, "pitch_expo")},
            "yaw":   {"rcRate": _section_num(s, "yaw_rc_rate"),
                      "srate":  _section_num(s, "yaw_srate"),
                      "expo":   _section_num(s, "yaw_expo")},
        })

    return {
        "name": name.strip('"'),
        "firmware": firmware,
        "gyroFilters": gf,
        "pidProfiles": pid_profiles,
        "rateProfiles": rate_profiles,
        "mainGearRatio": main_gear,
        "tailGearRatio": tail_gear,
        "motorPolesMain": motor_poles_main,
    }


def _parse_ratio(s):
    """Parse '342,3808' or '342:3808' → [numer, denom]. Falls back to [1,1]."""
    try:
        for sep in [",", ":", "/"]:
            if sep in str(s):
                parts = str(s).split(sep)
                return [int(parts[0].strip()), int(parts[1].strip())]
        return [int(str(s).strip()), 1]
    except Exception:
        return [1, 1]
