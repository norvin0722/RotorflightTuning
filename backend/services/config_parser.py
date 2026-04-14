"""
services/config_parser.py
FastAPI service wrapper around rf_config_parser.

Converts the RFConfig dataclass into plain dicts
that the config_dumps router can persist directly.
"""

import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent))

from rf_config_parser import (
    parse_dump,
    pid_profile_to_db_dict,
    rate_profile_to_db_dict,
    filter_settings_to_db_dict,
)


def parse_config_dump_text(raw_dump: str) -> dict[str, Any]:
    """
    Parse a Rotorflight 'dump all' text.

    Returns a dict with:
      meta            : firmware version, craft name, board info
      pid_profiles    : list of dicts (one per profile, ready for DB insert)
      rate_profiles   : list of dicts
      filter_settings : dict (global gyro filter settings)
      active_profile  : int (profile index active at dump time)
      active_rateprofile : int
    """
    config = parse_dump(raw_dump)

    return {
        "meta": {
            "firmware_version": config.meta.firmware_version,
            "firmware_date":    config.meta.firmware_date,
            "mcu":              config.meta.mcu,
            "msp_api":          config.meta.msp_api,
            "craft_name":       config.meta.craft_name,
            "board_name":       config.meta.board_name,
            "board_design":     config.meta.board_design,
            "manufacturer_id":  config.meta.manufacturer_id,
        },
        "pid_profiles":    [pid_profile_to_db_dict(p) for p in config.pid_profiles],
        "rate_profiles":   [rate_profile_to_db_dict(r) for r in config.rate_profiles],
        "filter_settings": filter_settings_to_db_dict(config),
        "active_profile":       config.active_profile,
        "active_rateprofile":   config.active_rateprofile,
    }
