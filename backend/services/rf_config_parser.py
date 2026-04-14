"""
Rotorflight config dump parser.
Handles 'dump all' output from Rotorflight 4.x firmware.

Parses into structured sections:
  - meta         : firmware version, craft name, board info
  - master        : all global 'set key = value' pairs (gyro filters, blackbox, etc.)
  - pid_profiles  : list of per-profile PID/governor/filter dicts (index 0-5)
  - rate_profiles : list of per-rateprofile dicts (index 0-5)
  - active_profile      : profile index active at time of dump
  - active_rateprofile  : rateprofile index active at time of dump
"""

import re
from dataclasses import dataclass, field
from typing import Any


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class RFMeta:
    firmware_version: str = ""
    firmware_date: str = ""
    mcu: str = ""
    msp_api: str = ""
    craft_name: str = ""
    board_name: str = ""
    board_design: str = ""
    manufacturer_id: str = ""


@dataclass
class RFPidProfile:
    index: int = 0
    params: dict[str, Any] = field(default_factory=dict)

    # Convenience props for the most analysis-critical fields
    @property
    def pitch_pid(self) -> dict:
        return {
            "p": self.params.get("pitch_p_gain"),
            "i": self.params.get("pitch_i_gain"),
            "d": self.params.get("pitch_d_gain"),
            "f": self.params.get("pitch_f_gain"),
            "b": self.params.get("pitch_b_gain"),
            "o": self.params.get("pitch_o_gain"),
        }

    @property
    def roll_pid(self) -> dict:
        return {
            "p": self.params.get("roll_p_gain"),
            "i": self.params.get("roll_i_gain"),
            "d": self.params.get("roll_d_gain"),
            "f": self.params.get("roll_f_gain"),
            "b": self.params.get("roll_b_gain"),
            "o": self.params.get("roll_o_gain"),
        }

    @property
    def yaw_pid(self) -> dict:
        return {
            "p": self.params.get("yaw_p_gain"),
            "i": self.params.get("yaw_i_gain"),
            "d": self.params.get("yaw_d_gain"),
            "f": self.params.get("yaw_f_gain"),
            "b": self.params.get("yaw_b_gain"),
        }

    @property
    def gyro_cutoffs(self) -> dict:
        return {
            "pitch_gyro_hz": self.params.get("pitch_gyro_cutoff"),
            "roll_gyro_hz":  self.params.get("roll_gyro_cutoff"),
            "yaw_gyro_hz":   self.params.get("yaw_gyro_cutoff"),
            "pitch_d_hz":    self.params.get("pitch_d_cutoff"),
            "roll_d_hz":     self.params.get("roll_d_cutoff"),
            "yaw_d_hz":      self.params.get("yaw_d_cutoff"),
        }

    @property
    def governor(self) -> dict:
        return {
            "headspeed":            self.params.get("gov_headspeed"),
            "gain":                 self.params.get("gov_gain"),
            "p_gain":               self.params.get("gov_p_gain"),
            "i_gain":               self.params.get("gov_i_gain"),
            "d_gain":               self.params.get("gov_d_gain"),
            "f_gain":               self.params.get("gov_f_gain"),
            "cyclic_ff_weight":     self.params.get("gov_cyclic_ff_weight"),
            "collective_ff_weight": self.params.get("gov_collective_ff_weight"),
            "yaw_ff_weight":        self.params.get("gov_yaw_ff_weight"),
        }


@dataclass
class RFRateProfile:
    index: int = 0
    params: dict[str, Any] = field(default_factory=dict)

    @property
    def rates(self) -> dict:
        return {
            "roll_rc_rate":       self.params.get("roll_rc_rate"),
            "pitch_rc_rate":      self.params.get("pitch_rc_rate"),
            "yaw_rc_rate":        self.params.get("yaw_rc_rate"),
            "collective_rc_rate": self.params.get("collective_rc_rate"),
            "roll_expo":          self.params.get("roll_expo"),
            "pitch_expo":         self.params.get("pitch_expo"),
            "yaw_expo":           self.params.get("yaw_expo"),
            "roll_srate":         self.params.get("roll_srate"),
            "pitch_srate":        self.params.get("pitch_srate"),
            "yaw_srate":          self.params.get("yaw_srate"),
            "collective_srate":   self.params.get("collective_srate"),
        }


@dataclass
class RFConfig:
    meta: RFMeta = field(default_factory=RFMeta)
    master: dict[str, Any] = field(default_factory=dict)
    pid_profiles: list[RFPidProfile] = field(default_factory=list)
    rate_profiles: list[RFRateProfile] = field(default_factory=list)
    active_profile: int = 0
    active_rateprofile: int = 0
    raw_dump: str = ""

    def pid_profile(self, index: int) -> RFPidProfile | None:
        for p in self.pid_profiles:
            if p.index == index:
                return p
        return None

    def rate_profile(self, index: int) -> RFRateProfile | None:
        for r in self.rate_profiles:
            if r.index == index:
                return r
        return None

    @property
    def global_gyro_filters(self) -> dict:
        """Global gyro filter settings from the master section."""
        keys = [
            "gyro_lpf1_type", "gyro_lpf1_static_hz",
            "gyro_lpf1_dyn_min_hz", "gyro_lpf1_dyn_max_hz",
            "gyro_lpf2_type", "gyro_lpf2_static_hz",
            "gyro_notch1_hz", "gyro_notch1_cutoff",
            "gyro_notch2_hz", "gyro_notch2_cutoff",
            "dyn_notch_count", "dyn_notch_q",
            "dyn_notch_min_hz", "dyn_notch_max_hz",
            "gyro_rpm_notch_min_hz",
            "gyro_decimation_hz",
        ]
        return {k: self.master[k] for k in keys if k in self.master}


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------

# Matches:  set some_key = some value
_SET_RE = re.compile(r"^set\s+(\w+)\s*=\s*(.+)$")

# Matches version comment line
_VERSION_RE = re.compile(
    r"#\s*Rotorflight\s*/\s*(\S+)\s+\((\S+)\)\s+([\d.]+)\s+(.*?)\s*/\s*[\d:]+\s*\((\S+)\)\s*MSP API:\s*(\S+)"
)

# Matches craft name comment
_NAME_RE = re.compile(r"^#\s*name:\s*(.+)$")


def _cast(value: str) -> Any:
    """Cast string value to int, float, or leave as string."""
    v = value.strip()
    # Comma-separated lists → keep as string (e.g. rpm notch arrays)
    if "," in v:
        return v
    try:
        return int(v)
    except ValueError:
        pass
    try:
        return float(v)
    except ValueError:
        pass
    return v


def parse_dump(dump_text: str) -> RFConfig:
    """
    Parse a Rotorflight 'dump all' text into an RFConfig object.

    Args:
        dump_text: Raw text content of the dump.

    Returns:
        Populated RFConfig instance.
    """
    config = RFConfig(raw_dump=dump_text)
    lines = dump_text.splitlines()

    # Parsing state
    # section: "header" | "master" | "pid_profile" | "rate_profile"
    section = "header"
    current_pid: RFPidProfile | None = None
    current_rate: RFRateProfile | None = None

    # Track the last explicit 'profile N' / 'rateprofile N' seen
    # before a '# restore original profile selection' comment
    _last_pid_index = 0
    _last_rate_index = 0
    _in_restore_pid = False
    _in_restore_rate = False

    for line in lines:
        stripped = line.strip()

        # Skip blank lines and pure comment lines (except special ones)
        if not stripped:
            continue

        # ------------------------------------------------------------------
        # Version header
        # ------------------------------------------------------------------
        m = _VERSION_RE.match(stripped)
        if m:
            config.meta.mcu = f"{m.group(1)} ({m.group(2)})"
            config.meta.firmware_version = m.group(3)
            config.meta.firmware_date = m.group(4)
            config.meta.msp_api = m.group(6)
            continue

        # Craft name
        m = _NAME_RE.match(stripped)
        if m:
            config.meta.craft_name = m.group(1).strip()
            continue

        # Board info
        if stripped.startswith("board_name "):
            config.meta.board_name = stripped.split(None, 1)[1]
            continue
        if stripped.startswith("board_design "):
            config.meta.board_design = stripped.split(None, 1)[1]
            continue
        if stripped.startswith("manufacturer_id "):
            config.meta.manufacturer_id = stripped.split(None, 1)[1]
            continue

        # ------------------------------------------------------------------
        # Restore active profile/rateprofile detection
        # The pattern is:
        #   # restore original profile selection
        #   profile 0
        # ------------------------------------------------------------------
        if "restore original profile selection" in stripped:
            _in_restore_pid = True
            _in_restore_rate = False
            continue
        if "restore original rateprofile selection" in stripped:
            _in_restore_rate = True
            _in_restore_pid = False
            continue

        # ------------------------------------------------------------------
        # Section switches: 'profile N' and 'rateprofile N'
        # ------------------------------------------------------------------
        pid_switch = re.match(r"^profile\s+(\d+)$", stripped)
        rate_switch = re.match(r"^rateprofile\s+(\d+)$", stripped)

        if pid_switch:
            idx = int(pid_switch.group(1))
            if _in_restore_pid:
                config.active_profile = idx
                _in_restore_pid = False
            else:
                # Save previous pid profile if any
                if current_pid is not None:
                    config.pid_profiles.append(current_pid)
                current_pid = RFPidProfile(index=idx)
                section = "pid_profile"
                _last_pid_index = idx
            continue

        if rate_switch:
            idx = int(rate_switch.group(1))
            if _in_restore_rate:
                config.active_rateprofile = idx
                _in_restore_rate = False
            else:
                if current_rate is not None:
                    config.rate_profiles.append(current_rate)
                current_rate = RFRateProfile(index=idx)
                section = "rate_profile"
                _last_rate_index = idx
            continue

        # ------------------------------------------------------------------
        # 'set key = value' lines
        # ------------------------------------------------------------------
        m = _SET_RE.match(stripped)
        if not m:
            # Detect transition from header/resources into master section
            # by watching for the first 'set' after board config lines.
            # Non-set lines in resources/dma/feature sections are ignored.
            continue

        key = m.group(1)
        value = _cast(m.group(2))

        if section == "pid_profile" and current_pid is not None:
            current_pid.params[key] = value
        elif section == "rate_profile" and current_rate is not None:
            current_rate.params[key] = value
        else:
            # master section — everything before the first 'profile N'
            config.master[key] = value

    # Flush any remaining open profiles
    if current_pid is not None:
        config.pid_profiles.append(current_pid)
    if current_rate is not None:
        config.rate_profiles.append(current_rate)

    # If we never saw a restore comment, default active to 0
    # (shouldn't happen with a real dump all, but be safe)

    return config


# ---------------------------------------------------------------------------
# Serialisation helpers (for storing in DB)
# ---------------------------------------------------------------------------

def pid_profile_to_db_dict(profile: RFPidProfile) -> dict:
    """
    Flatten an RFPidProfile into a dict matching the pid_profiles DB schema.
    Known columns get explicit keys; everything else goes into extra_params.
    """
    known = {
        "profile_index":    profile.index,
        "pitch_p_gain":     profile.params.get("pitch_p_gain"),
        "pitch_i_gain":     profile.params.get("pitch_i_gain"),
        "pitch_d_gain":     profile.params.get("pitch_d_gain"),
        "pitch_f_gain":     profile.params.get("pitch_f_gain"),
        "pitch_b_gain":     profile.params.get("pitch_b_gain"),
        "pitch_o_gain":     profile.params.get("pitch_o_gain"),
        "roll_p_gain":      profile.params.get("roll_p_gain"),
        "roll_i_gain":      profile.params.get("roll_i_gain"),
        "roll_d_gain":      profile.params.get("roll_d_gain"),
        "roll_f_gain":      profile.params.get("roll_f_gain"),
        "roll_b_gain":      profile.params.get("roll_b_gain"),
        "roll_o_gain":      profile.params.get("roll_o_gain"),
        "yaw_p_gain":       profile.params.get("yaw_p_gain"),
        "yaw_i_gain":       profile.params.get("yaw_i_gain"),
        "yaw_d_gain":       profile.params.get("yaw_d_gain"),
        "yaw_f_gain":       profile.params.get("yaw_f_gain"),
        "yaw_b_gain":       profile.params.get("yaw_b_gain"),
        "pitch_gyro_cutoff": profile.params.get("pitch_gyro_cutoff"),
        "roll_gyro_cutoff":  profile.params.get("roll_gyro_cutoff"),
        "yaw_gyro_cutoff":   profile.params.get("yaw_gyro_cutoff"),
        "pitch_d_cutoff":    profile.params.get("pitch_d_cutoff"),
        "roll_d_cutoff":     profile.params.get("roll_d_cutoff"),
        "yaw_d_cutoff":      profile.params.get("yaw_d_cutoff"),
        "gov_headspeed":     profile.params.get("gov_headspeed"),
        "gov_gain":          profile.params.get("gov_gain"),
        "gov_p_gain":        profile.params.get("gov_p_gain"),
        "gov_i_gain":        profile.params.get("gov_i_gain"),
        "gov_d_gain":        profile.params.get("gov_d_gain"),
        "gov_f_gain":        profile.params.get("gov_f_gain"),
    }
    known_keys = set(known.keys()) - {"profile_index"}
    extra = {k: v for k, v in profile.params.items() if k not in known_keys}
    known["extra_params"] = extra
    return known


def rate_profile_to_db_dict(profile: RFRateProfile) -> dict:
    """
    Flatten an RFRateProfile into a dict matching the rate_profiles DB schema.
    """
    known = {
        "profile_index":      profile.index,
        "roll_rc_rate":       profile.params.get("roll_rc_rate"),
        "pitch_rc_rate":      profile.params.get("pitch_rc_rate"),
        "yaw_rc_rate":        profile.params.get("yaw_rc_rate"),
        "collective_rc_rate": profile.params.get("collective_rc_rate"),
        "roll_expo":          profile.params.get("roll_expo"),
        "pitch_expo":         profile.params.get("pitch_expo"),
        "yaw_expo":           profile.params.get("yaw_expo"),
        "collective_expo":    profile.params.get("collective_expo"),
        "roll_srate":         profile.params.get("roll_srate"),
        "pitch_srate":        profile.params.get("pitch_srate"),
        "yaw_srate":          profile.params.get("yaw_srate"),
        "collective_srate":   profile.params.get("collective_srate"),
    }
    known_keys = set(known.keys()) - {"profile_index"}
    extra = {k: v for k, v in profile.params.items() if k not in known_keys}
    known["extra_params"] = extra
    return known


def filter_settings_to_db_dict(config: RFConfig) -> dict:
    """
    Extract global gyro filter settings for the filter_settings DB table.
    """
    m = config.master
    return {
        "gyro_lpf1_type":      m.get("gyro_lpf1_type"),
        "gyro_lpf1_static_hz": m.get("gyro_lpf1_static_hz"),
        "gyro_lpf1_dyn_min_hz": m.get("gyro_lpf1_dyn_min_hz"),
        "gyro_lpf1_dyn_max_hz": m.get("gyro_lpf1_dyn_max_hz"),
        "gyro_lpf2_type":      m.get("gyro_lpf2_type"),
        "gyro_lpf2_static_hz": m.get("gyro_lpf2_static_hz"),
        "gyro_notch1_hz":      m.get("gyro_notch1_hz"),
        "gyro_notch1_cutoff":  m.get("gyro_notch1_cutoff"),
        "gyro_notch2_hz":      m.get("gyro_notch2_hz"),
        "gyro_notch2_cutoff":  m.get("gyro_notch2_cutoff"),
        "dyn_notch_count":     m.get("dyn_notch_count"),
        "dyn_notch_q":         m.get("dyn_notch_q"),
        "dyn_notch_min_hz":    m.get("dyn_notch_min_hz"),
        "dyn_notch_max_hz":    m.get("dyn_notch_max_hz"),
        "gyro_decimation_hz":  m.get("gyro_decimation_hz"),
        "rpm_filter_enabled":  "RPM_FILTER" in str(m.get("feature", "")),
        "extra_params": {
            k: v for k, v in m.items()
            if k.startswith("gyro_rpm_notch")
        },
    }


# ---------------------------------------------------------------------------
# Quick self-test (run directly: python rf_config_parser.py <dumpfile.txt>)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys, json

    if len(sys.argv) < 2:
        print("Usage: python rf_config_parser.py <dump_file.txt>")
        sys.exit(1)

    with open(sys.argv[1], "r") as f:
        text = f.read()

    cfg = parse_dump(text)

    print(f"\n=== META ===")
    print(f"  Craft        : {cfg.meta.craft_name}")
    print(f"  Firmware     : {cfg.meta.firmware_version}  ({cfg.meta.firmware_date})")
    print(f"  Board        : {cfg.meta.board_name} / {cfg.meta.board_design}")
    print(f"  MSP API      : {cfg.meta.msp_api}")

    print(f"\n=== ACTIVE AT DUMP TIME ===")
    print(f"  PID profile  : {cfg.active_profile}")
    print(f"  Rate profile : {cfg.active_rateprofile}")

    print(f"\n=== GLOBAL GYRO FILTERS ===")
    for k, v in cfg.global_gyro_filters.items():
        print(f"  {k:<30} = {v}")

    print(f"\n=== PID PROFILES ({len(cfg.pid_profiles)} found) ===")
    for p in cfg.pid_profiles:
        g = p.governor
        c = p.gyro_cutoffs
        print(f"\n  Profile {p.index}")
        print(f"    Pitch PID    : {p.pitch_pid}")
        print(f"    Roll PID     : {p.roll_pid}")
        print(f"    Yaw PID      : {p.yaw_pid}")
        print(f"    Gyro cutoffs : {c}")
        print(f"    Gov headspeed: {g['headspeed']} RPM")

    print(f"\n=== RATE PROFILES ({len(cfg.rate_profiles)} found) ===")
    for r in cfg.rate_profiles:
        print(f"\n  Rateprofile {r.index}")
        print(f"    Rates: {r.rates}")
