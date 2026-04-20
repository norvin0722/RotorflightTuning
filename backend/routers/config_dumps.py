from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from core.deps import get_db
from db.models import ConfigDump, PIDProfile, RateProfile, FilterSetting
from services.rf_config_parser import parse_dump

router = APIRouter()


def _build_pid_profiles(orm_pids, parsed_profiles: list) -> list:
    """Merge DB gyro cutoffs with parsed d/b cutoffs (not stored as DB columns)."""
    parsed_by_idx = {p["idx"]: p.get("filters", {}) for p in parsed_profiles}
    out = []
    for p in orm_pids:
        pf = parsed_by_idx.get(p.profile_index, {})
        out.append({
            "profile_index":     p.profile_index,
            "target_rpm":        p.target_rpm,
            "roll_gyro_cutoff":  p.roll_gyro_cutoff,
            "pitch_gyro_cutoff": p.pitch_gyro_cutoff,
            "yaw_gyro_cutoff":   p.yaw_gyro_cutoff,
            "roll_d_cutoff":     pf.get("rollDCutoff") or None,
            "pitch_d_cutoff":    pf.get("pitchDCutoff") or None,
            "yaw_d_cutoff":      pf.get("yawDCutoff") or None,
            "roll_b_cutoff":     pf.get("rollBCutoff") or None,
            "pitch_b_cutoff":    pf.get("pitchBCutoff") or None,
            "yaw_b_cutoff":      pf.get("yawBCutoff") or None,
            "roll_b_gain":       pf.get("rollBGain") or 0,
            "pitch_b_gain":      pf.get("pitchBGain") or 0,
            "yaw_b_gain":        pf.get("yawBGain") or 0,
        })
    return out


class ConfigDumpCreate(BaseModel):
    flight_id: Optional[str] = None
    raw_text: str


class ConfigDumpOut(BaseModel):
    id: str
    flight_id: Optional[str]
    craft_name: Optional[str]
    firmware: Optional[str]
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


@router.post("", response_model=ConfigDumpOut, status_code=201)
async def create_config_dump(payload: ConfigDumpCreate, db: AsyncSession = Depends(get_db)):
    parsed = parse_dump(payload.raw_text)

    dump = ConfigDump(
        flight_id=payload.flight_id,
        raw_text=payload.raw_text,
        craft_name=parsed.get("name"),
        firmware=parsed.get("firmware"),
    )
    db.add(dump)
    await db.flush()

    for p in parsed.get("pidProfiles", []):
        roll  = p.get("roll",  {})
        pitch = p.get("pitch", {})
        yaw   = p.get("yaw",   {})
        gov   = p.get("gov",   {})
        filt  = p.get("filters", {})
        pid = PIDProfile(
            config_dump_id=dump.id,
            profile_index=p.get("idx", 0),
            target_rpm=p.get("targetRPM"),
            roll_p=roll.get("P"),  roll_i=roll.get("I"),  roll_d=roll.get("D"),  roll_f=roll.get("F"),
            pitch_p=pitch.get("P"),pitch_i=pitch.get("I"),pitch_d=pitch.get("D"),pitch_f=pitch.get("F"),
            yaw_p=yaw.get("P"),   yaw_i=yaw.get("I"),   yaw_d=yaw.get("D"),   yaw_f=yaw.get("F"),
            roll_gyro_cutoff=filt.get("rollGyroCutoff"),
            pitch_gyro_cutoff=filt.get("pitchGyroCutoff"),
            yaw_gyro_cutoff=filt.get("yawGyroCutoff"),
            gov_p=gov.get("P"), gov_i=gov.get("I"), gov_f=gov.get("F"),
        )
        db.add(pid)

    for r in parsed.get("rateProfiles", []):
        roll  = r.get("roll",  {})
        pitch = r.get("pitch", {})
        yaw   = r.get("yaw",   {})
        rp = RateProfile(
            config_dump_id=dump.id,
            profile_index=r.get("idx", 0),
            roll_rc_rate=roll.get("rcRate"),  roll_srate=roll.get("srate"),  roll_expo=roll.get("expo"),
            pitch_rc_rate=pitch.get("rcRate"),pitch_srate=pitch.get("srate"),pitch_expo=pitch.get("expo"),
            yaw_rc_rate=yaw.get("rcRate"),    yaw_srate=yaw.get("srate"),    yaw_expo=yaw.get("expo"),
        )
        db.add(rp)

    gf = parsed.get("gyroFilters", {})
    fs = FilterSetting(
        config_dump_id=dump.id,
        lpf1_type=gf.get("lpf1Type"),       lpf1_hz=gf.get("lpf1Hz"),
        lpf2_type=gf.get("lpf2Type"),       lpf2_hz=gf.get("lpf2Hz"),
        dyn_notch_count=gf.get("dynNotchCount"), dyn_notch_q=gf.get("dynNotchQ"),
        dyn_notch_min_hz=gf.get("dynNotchMinHz"),dyn_notch_max_hz=gf.get("dynNotchMaxHz"),
        rpm_filter_enabled=bool(gf.get("rpmFilterEnabled", False)),
    )
    db.add(fs)

    await db.commit()
    await db.refresh(dump)
    return dump


@router.get("/{dump_id}/profiles")
async def get_profiles(dump_id: str, db: AsyncSession = Depends(get_db)):
    dump = await db.get(ConfigDump, dump_id)
    if not dump:
        raise HTTPException(404, "Config dump not found")

    pid_res  = await db.execute(select(PIDProfile).where(PIDProfile.config_dump_id == dump_id).order_by(PIDProfile.profile_index))
    rate_res = await db.execute(select(RateProfile).where(RateProfile.config_dump_id == dump_id).order_by(RateProfile.profile_index))
    filt_res = await db.execute(select(FilterSetting).where(FilterSetting.config_dump_id == dump_id))

    def pid_to_dict(p):
        return {
            "profile_index": p.profile_index, "target_rpm": p.target_rpm,
            "roll":  {"P": p.roll_p,  "I": p.roll_i,  "D": p.roll_d,  "F": p.roll_f},
            "pitch": {"P": p.pitch_p, "I": p.pitch_i, "D": p.pitch_d, "F": p.pitch_f},
            "yaw":   {"P": p.yaw_p,   "I": p.yaw_i,   "D": p.yaw_d,   "F": p.yaw_f},
            "filters": {
                "rollGyroCutoff":  p.roll_gyro_cutoff,
                "pitchGyroCutoff": p.pitch_gyro_cutoff,
                "yawGyroCutoff":   p.yaw_gyro_cutoff,
            },
            "gov": {"P": p.gov_p, "I": p.gov_i, "F": p.gov_f},
        }

    def rate_to_dict(r):
        return {
            "profile_index": r.profile_index,
            "roll":  {"rcRate": r.roll_rc_rate,  "srate": r.roll_srate,  "expo": r.roll_expo},
            "pitch": {"rcRate": r.pitch_rc_rate, "srate": r.pitch_srate, "expo": r.pitch_expo},
            "yaw":   {"rcRate": r.yaw_rc_rate,   "srate": r.yaw_srate,   "expo": r.yaw_expo},
        }

    def filt_to_dict(f):
        return {
            "lpf1_type": f.lpf1_type, "lpf1_hz": f.lpf1_hz,
            "lpf2_type": f.lpf2_type, "lpf2_hz": f.lpf2_hz,
            "dyn_notch_count": f.dyn_notch_count, "dyn_notch_q": f.dyn_notch_q,
            "dyn_notch_min_hz": f.dyn_notch_min_hz, "dyn_notch_max_hz": f.dyn_notch_max_hz,
            "rpm_filter_enabled": f.rpm_filter_enabled,
        }

    return {
        "pid_profiles":    [pid_to_dict(p)  for p in pid_res.scalars().all()],
        "rate_profiles":   [rate_to_dict(r) for r in rate_res.scalars().all()],
        "filter_settings": [filt_to_dict(f) for f in filt_res.scalars().all()],
    }


@router.get("/for-flight/{flight_id}")
async def get_config_for_flight(flight_id: str, db: AsyncSession = Depends(get_db)):
    """
    Return the most recent config dump for a flight, including all filter settings
    and PID profiles. Used by the frontend to compute FFT filter band overlays.
    """
    result = await db.execute(
        select(ConfigDump)
        .where(ConfigDump.flight_id == flight_id)
        .order_by(ConfigDump.created_at.desc())
    )
    dump = result.scalars().first()
    if not dump:
        return {"found": False}

    filt_res = await db.execute(
        select(FilterSetting).where(FilterSetting.config_dump_id == dump.id)
    )
    filt = filt_res.scalars().first()

    pid_res = await db.execute(
        select(PIDProfile)
        .where(PIDProfile.config_dump_id == dump.id)
        .order_by(PIDProfile.profile_index)
    )
    pids = pid_res.scalars().all()

    return {
        "found": True,
        "dump_id": dump.id,
        "craft_name": dump.craft_name,
        "filters": {
            "lpf1_type":       filt.lpf1_type       if filt else None,
            "lpf1_hz":         filt.lpf1_hz         if filt else None,
            "lpf2_type":       filt.lpf2_type       if filt else None,
            "lpf2_hz":         filt.lpf2_hz         if filt else None,
            "dyn_notch_count": filt.dyn_notch_count if filt else None,
            "dyn_notch_q":     filt.dyn_notch_q     if filt else None,
            "dyn_notch_min_hz":filt.dyn_notch_min_hz if filt else None,
            "dyn_notch_max_hz":filt.dyn_notch_max_hz if filt else None,
            "rpm_filter_enabled": filt.rpm_filter_enabled if filt else False,
        } if filt else {},
        "pid_profiles": [
            {
                "profile_index": p.profile_index,
                "target_rpm":    p.target_rpm,
                "roll_gyro_cutoff":  p.roll_gyro_cutoff,
                "pitch_gyro_cutoff": p.pitch_gyro_cutoff,
                "yaw_gyro_cutoff":   p.yaw_gyro_cutoff,
            }
            for p in pids
        ],
    }


@router.get("/for-flight/{flight_id}/full")
async def get_full_config_for_flight(flight_id: str, db: AsyncSession = Depends(get_db)):
    """
    Return the full config dump raw_text for a flight so the frontend
    can compute precise RPM notch frequencies from gear ratios and sources.
    """
    result = await db.execute(
        select(ConfigDump)
        .where(ConfigDump.flight_id == flight_id)
        .order_by(ConfigDump.created_at.desc())
    )
    dump = result.scalars().first()
    if not dump:
        return {"found": False}

    from services.rf_config_parser import parse_dump
    parsed = parse_dump(dump.raw_text or "")

    filt_res = await db.execute(
        select(FilterSetting).where(FilterSetting.config_dump_id == dump.id)
    )
    filt = filt_res.scalars().first()

    pid_res = await db.execute(
        select(PIDProfile)
        .where(PIDProfile.config_dump_id == dump.id)
        .order_by(PIDProfile.profile_index)
    )
    pids = pid_res.scalars().all()

    gf = parsed.get("gyroFilters", {})

    return {
        "found": True,
        "dump_id": dump.id,
        "craft_name": dump.craft_name,
        # Full filter config needed for band computation
        "filters": {
            "lpf1_type":        gf.get("lpf1Type"),
            "lpf1_hz":          gf.get("lpf1Hz"),
            "lpf2_type":        gf.get("lpf2Type"),
            "lpf2_hz":          gf.get("lpf2Hz"),
            "dyn_notch_count":  gf.get("dynNotchCount"),
            "dyn_notch_q":      gf.get("dynNotchQ"),
            "dyn_notch_min_hz": gf.get("dynNotchMinHz"),
            "dyn_notch_max_hz": gf.get("dynNotchMaxHz"),
            # rpm_filter_enabled: true if ANY axis has notch sources defined,
            # OR if rpm_filter_harmonics > 0. The sources being non-empty IS the
            # enable flag in Rotorflight — don't rely on rpm_filter_harmonics alone.
            "rpm_filter_enabled": bool(
                gf.get("rpmFilterEnabled", False) or
                gf.get("rpmSourceRoll",  "").strip("0, ") or
                gf.get("rpmSourcePitch", "").strip("0, ") or
                gf.get("rpmSourceYaw",   "").strip("0, ")
            ),
            "rpm_notch_min_hz": gf.get("rpmNotchMinHz", 0),
            # Per-axis RPM notch arrays (comma-separated strings)
            "rpm_source_roll":   gf.get("rpmSourceRoll",  ""),
            "rpm_source_pitch":  gf.get("rpmSourcePitch", ""),
            "rpm_source_yaw":    gf.get("rpmSourceYaw",   ""),
            "rpm_q_roll":        gf.get("rpmQRoll",  ""),
            "rpm_q_pitch":       gf.get("rpmQPitch", ""),
            "rpm_q_yaw":         gf.get("rpmQYaw",   ""),
            "rpm_center_roll":   gf.get("rpmCenterRoll",  ""),
            "rpm_center_pitch":  gf.get("rpmCenterPitch", ""),
            "rpm_center_yaw":    gf.get("rpmCenterYaw",   ""),
        },
        # Gear ratios for RPM frequency calculation
        "main_gear_ratio": parsed.get("mainGearRatio", [1, 1]),
        "tail_gear_ratio": parsed.get("tailGearRatio", [1, 1]),
        "motor_poles_main": parsed.get("motorPolesMain", 10),
        # PID profiles — gyro cutoff from DB, d/b cutoffs from parsed dump
        # (d/b cutoffs are not stored as DB columns, so we supplement from parsed)
        "pid_profiles": _build_pid_profiles(pids, parsed.get("pidProfiles", [])),
    }
