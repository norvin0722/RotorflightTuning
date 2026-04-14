"""
Router: /api/config-dumps

Endpoints:
  POST   /?flight_id={id}       Upload + parse a dump all text for a flight
  GET    /?flight_id={id}       List config dumps for a flight
  GET    /{dump_id}             Get a single dump with parsed profiles
  GET    /{dump_id}/profiles    Get all PID + rate profiles for a dump
"""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from core.deps import get_db
from db.models import ConfigDump, PidProfile, RateProfile, FilterSetting
from services.config_parser import parse_config_dump_text

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────────

class ConfigDumpCreate(BaseModel):
    flight_id: uuid.UUID
    raw_dump:  str
    dump_type: str = "dump_all"


class PidProfileOut(BaseModel):
    id:             uuid.UUID
    profile_index:  int
    # PID gains (dimensionless)
    pitch_p_gain:   int | None;  pitch_i_gain:  int | None;  pitch_d_gain:  int | None
    pitch_f_gain:   int | None;  pitch_b_gain:  int | None;  pitch_o_gain:  int | None
    roll_p_gain:    int | None;  roll_i_gain:   int | None;  roll_d_gain:   int | None
    roll_f_gain:    int | None;  roll_b_gain:   int | None;  roll_o_gain:   int | None
    yaw_p_gain:     int | None;  yaw_i_gain:    int | None;  yaw_d_gain:    int | None
    yaw_f_gain:     int | None;  yaw_b_gain:    int | None
    # Filter cutoffs (Hz)
    pitch_gyro_cutoff_hz: int | None;  roll_gyro_cutoff_hz: int | None
    yaw_gyro_cutoff_hz:   int | None;  pitch_d_cutoff_hz:   int | None
    roll_d_cutoff_hz:     int | None;  yaw_d_cutoff_hz:     int | None
    # Governor
    gov_headspeed_rpm:        int | None
    gov_gain:                 int | None
    gov_p_gain:               int | None;  gov_i_gain: int | None
    gov_d_gain:               int | None;  gov_f_gain: int | None
    gov_cyclic_ff_weight:     int | None
    gov_collective_ff_weight: int | None
    gov_yaw_ff_weight:        int | None
    extra_params: dict

    class Config:
        from_attributes = True


class RateProfileOut(BaseModel):
    id:            uuid.UUID
    profile_index: int
    rates_type:    str | None
    roll_rc_rate:  int | None;  pitch_rc_rate:  int | None;  yaw_rc_rate:  int | None
    collective_rc_rate: int | None
    roll_expo:     int | None;  pitch_expo:     int | None;  yaw_expo:     int | None
    roll_srate:    int | None;  pitch_srate:    int | None;  yaw_srate:    int | None
    collective_srate: int | None
    extra_params:  dict

    class Config:
        from_attributes = True


class FilterSettingOut(BaseModel):
    gyro_lpf1_type:       str | None
    gyro_lpf1_static_hz:  int | None
    gyro_lpf1_dyn_min_hz: int | None
    gyro_lpf1_dyn_max_hz: int | None
    gyro_lpf2_type:       str | None
    gyro_lpf2_static_hz:  int | None
    dyn_notch_count:      int | None
    dyn_notch_q:          int | None
    dyn_notch_min_hz:     int | None
    dyn_notch_max_hz:     int | None
    rpm_filter_enabled:   bool | None
    gyro_decimation_hz:   int | None

    class Config:
        from_attributes = True


class ConfigDumpProfilesOut(BaseModel):
    dump_id:        uuid.UUID
    active_profile: int | None
    pid_profiles:   list[PidProfileOut]
    rate_profiles:  list[RateProfileOut]
    filter_settings: FilterSettingOut | None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/", status_code=status.HTTP_201_CREATED)
async def upload_config_dump(
    body: ConfigDumpCreate,
    db:   AsyncSession = Depends(get_db),
):
    """
    Parse a Rotorflight 'dump all' text and store all extracted profiles.

    - Creates a config_dumps row with the raw text
    - Parses and stores all PID profiles, rate profiles, and global filter settings
    - Returns the dump ID and number of profiles found
    """
    # Parse the dump text using rf_config_parser
    parsed = parse_config_dump_text(body.raw_dump)

    dump = ConfigDump(
        flight_id        = body.flight_id,
        raw_dump         = body.raw_dump,
        dump_type        = body.dump_type,
        firmware_version = parsed["meta"].get("firmware_version"),
        craft_name       = parsed["meta"].get("craft_name"),
        board_name       = parsed["meta"].get("board_name"),
        parsed_at        = datetime.utcnow(),
    )
    db.add(dump)
    await db.flush()  # get dump.id before inserting children

    # Store PID profiles
    for p in parsed["pid_profiles"]:
        pid = PidProfile(
            config_dump_id           = dump.id,
            profile_index            = p["profile_index"],
            pitch_p_gain             = p.get("pitch_p_gain"),
            pitch_i_gain             = p.get("pitch_i_gain"),
            pitch_d_gain             = p.get("pitch_d_gain"),
            pitch_f_gain             = p.get("pitch_f_gain"),
            pitch_b_gain             = p.get("pitch_b_gain"),
            pitch_o_gain             = p.get("pitch_o_gain"),
            roll_p_gain              = p.get("roll_p_gain"),
            roll_i_gain              = p.get("roll_i_gain"),
            roll_d_gain              = p.get("roll_d_gain"),
            roll_f_gain              = p.get("roll_f_gain"),
            roll_b_gain              = p.get("roll_b_gain"),
            roll_o_gain              = p.get("roll_o_gain"),
            yaw_p_gain               = p.get("yaw_p_gain"),
            yaw_i_gain               = p.get("yaw_i_gain"),
            yaw_d_gain               = p.get("yaw_d_gain"),
            yaw_f_gain               = p.get("yaw_f_gain"),
            yaw_b_gain               = p.get("yaw_b_gain"),
            pitch_gyro_cutoff_hz     = p.get("pitch_gyro_cutoff"),
            roll_gyro_cutoff_hz      = p.get("roll_gyro_cutoff"),
            yaw_gyro_cutoff_hz       = p.get("yaw_gyro_cutoff"),
            pitch_d_cutoff_hz        = p.get("pitch_d_cutoff"),
            roll_d_cutoff_hz         = p.get("roll_d_cutoff"),
            yaw_d_cutoff_hz          = p.get("yaw_d_cutoff"),
            gov_headspeed_rpm        = p.get("gov_headspeed"),
            gov_gain                 = p.get("gov_gain"),
            gov_p_gain               = p.get("gov_p_gain"),
            gov_i_gain               = p.get("gov_i_gain"),
            gov_d_gain               = p.get("gov_d_gain"),
            gov_f_gain               = p.get("gov_f_gain"),
            gov_cyclic_ff_weight     = p.get("gov_cyclic_ff_weight"),
            gov_collective_ff_weight = p.get("gov_collective_ff_weight"),
            gov_yaw_ff_weight        = p.get("gov_yaw_ff_weight"),
            extra_params             = p.get("extra_params", {}),
        )
        db.add(pid)

    # Store rate profiles
    for r in parsed["rate_profiles"]:
        rate = RateProfile(
            config_dump_id     = dump.id,
            profile_index      = r["profile_index"],
            rates_type         = r.get("rates_type"),
            roll_rc_rate       = r.get("roll_rc_rate"),
            pitch_rc_rate      = r.get("pitch_rc_rate"),
            yaw_rc_rate        = r.get("yaw_rc_rate"),
            collective_rc_rate = r.get("collective_rc_rate"),
            roll_expo          = r.get("roll_expo"),
            pitch_expo         = r.get("pitch_expo"),
            yaw_expo           = r.get("yaw_expo"),
            collective_expo    = r.get("collective_expo"),
            roll_srate         = r.get("roll_srate"),
            pitch_srate        = r.get("pitch_srate"),
            yaw_srate          = r.get("yaw_srate"),
            collective_srate   = r.get("collective_srate"),
            extra_params       = r.get("extra_params", {}),
        )
        db.add(rate)

    # Store global filter settings
    fs_data = parsed.get("filter_settings", {})
    if fs_data:
        fs = FilterSetting(
            config_dump_id        = dump.id,
            gyro_lpf1_type        = fs_data.get("gyro_lpf1_type"),
            gyro_lpf1_static_hz   = fs_data.get("gyro_lpf1_static_hz"),
            gyro_lpf1_dyn_min_hz  = fs_data.get("gyro_lpf1_dyn_min_hz"),
            gyro_lpf1_dyn_max_hz  = fs_data.get("gyro_lpf1_dyn_max_hz"),
            gyro_lpf2_type        = fs_data.get("gyro_lpf2_type"),
            gyro_lpf2_static_hz   = fs_data.get("gyro_lpf2_static_hz"),
            gyro_notch1_hz        = fs_data.get("gyro_notch1_hz"),
            gyro_notch1_cutoff_hz = fs_data.get("gyro_notch1_cutoff"),
            gyro_notch2_hz        = fs_data.get("gyro_notch2_hz"),
            gyro_notch2_cutoff_hz = fs_data.get("gyro_notch2_cutoff"),
            dyn_notch_count       = fs_data.get("dyn_notch_count"),
            dyn_notch_q           = fs_data.get("dyn_notch_q"),
            dyn_notch_min_hz      = fs_data.get("dyn_notch_min_hz"),
            dyn_notch_max_hz      = fs_data.get("dyn_notch_max_hz"),
            rpm_filter_enabled    = fs_data.get("rpm_filter_enabled", False),
            gyro_decimation_hz    = fs_data.get("gyro_decimation_hz"),
            extra_params          = fs_data.get("extra_params", {}),
        )
        db.add(fs)

    await db.commit()
    await db.refresh(dump)

    return {
        "dump_id":         str(dump.id),
        "pid_profiles":    len(parsed["pid_profiles"]),
        "rate_profiles":   len(parsed["rate_profiles"]),
        "active_profile":  parsed.get("active_profile"),
        "craft_name":      parsed["meta"].get("craft_name"),
        "firmware_version": parsed["meta"].get("firmware_version"),
    }


@router.get("/{dump_id}/profiles", response_model=ConfigDumpProfilesOut)
async def get_profiles(dump_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    dump = await db.get(ConfigDump, dump_id)
    if not dump:
        raise HTTPException(status_code=404, detail="Config dump not found")

    pid_result = await db.execute(
        select(PidProfile)
        .where(PidProfile.config_dump_id == dump_id)
        .order_by(PidProfile.profile_index)
    )
    rate_result = await db.execute(
        select(RateProfile)
        .where(RateProfile.config_dump_id == dump_id)
        .order_by(RateProfile.profile_index)
    )
    fs_result = await db.execute(
        select(FilterSetting).where(FilterSetting.config_dump_id == dump_id)
    )

    return ConfigDumpProfilesOut(
        dump_id        = dump_id,
        active_profile = None,
        pid_profiles   = pid_result.scalars().all(),
        rate_profiles  = rate_result.scalars().all(),
        filter_settings= fs_result.scalar_one_or_none(),
    )
