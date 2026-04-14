"""
Router: /api/segments

Segments receive a small CSV slice uploaded from the browser.
The browser filters the 220MB log in memory before sending.
"""

import uuid
import shutil
from pathlib import Path
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from core.config import settings
from core.deps import get_db
from db.models import Segment, ManeuverType, PidProfile, RateProfile, ConfigDump

router = APIRouter()


class SegmentOut(BaseModel):
    id:               uuid.UUID
    flight_id:        uuid.UUID
    label:            str
    start_iteration:  int
    end_iteration:    int
    duration_loops:   int | None
    maneuver_type:    str | None
    pid_profile_id:   uuid.UUID | None
    rate_profile_id:  uuid.UUID | None
    csv_path:         str | None
    row_count:        int | None
    notes:            str | None
    created_at:       datetime

    class Config:
        from_attributes = True


async def _resolve_maneuver(name: str | None, db) -> uuid.UUID | None:
    if not name:
        return None
    result = await db.execute(select(ManeuverType).where(ManeuverType.name == name))
    mt = result.scalar_one_or_none()
    if mt:
        return mt.id
    new_mt = ManeuverType(name=name, is_custom=True)
    db.add(new_mt)
    await db.flush()
    return new_mt.id


async def _resolve_pid(flight_id: uuid.UUID, index: int | None, db) -> uuid.UUID | None:
    if index is None:
        return None
    dump_res = await db.execute(select(ConfigDump).where(ConfigDump.flight_id == flight_id).limit(1))
    dump = dump_res.scalar_one_or_none()
    if not dump:
        return None
    pid_res = await db.execute(
        select(PidProfile).where(PidProfile.config_dump_id == dump.id, PidProfile.profile_index == index)
    )
    pid = pid_res.scalar_one_or_none()
    return pid.id if pid else None


async def _resolve_rate(flight_id: uuid.UUID, index: int | None, db) -> uuid.UUID | None:
    if index is None:
        return None
    dump_res = await db.execute(select(ConfigDump).where(ConfigDump.flight_id == flight_id).limit(1))
    dump = dump_res.scalar_one_or_none()
    if not dump:
        return None
    rate_res = await db.execute(
        select(RateProfile).where(RateProfile.config_dump_id == dump.id, RateProfile.profile_index == index)
    )
    rate = rate_res.scalar_one_or_none()
    return rate.id if rate else None


@router.post("/upload", response_model=SegmentOut, status_code=status.HTTP_201_CREATED)
async def upload_segment(
    file:               UploadFile   = File(...),
    flight_id:          str          = Form(...),
    label:              str          = Form(...),
    start_iteration:    int          = Form(...),
    end_iteration:      int          = Form(...),
    row_count:          int          = Form(...),
    maneuver_type_name: str          = Form(""),
    pid_profile_index:  str          = Form(""),
    rate_profile_index: str          = Form(""),
    notes:              str          = Form(""),
    db: AsyncSession = Depends(get_db),
):
    fid = uuid.UUID(flight_id)
    if end_iteration <= start_iteration:
        raise HTTPException(status_code=400, detail="end_iteration must be > start_iteration")

    seg_id   = uuid.uuid4()
    dest_dir = Path(settings.data_dir) / str(fid) / "segments"
    dest_dir.mkdir(parents=True, exist_ok=True)
    safe_label = label.replace(" ", "_").replace("/", "-")[:40]
    dest_path  = dest_dir / f"{seg_id}_{safe_label}.csv"

    try:
        with open(dest_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save segment: {e}")

    pid_index  = int(pid_profile_index)  if pid_profile_index.strip()  else None
    rate_index = int(rate_profile_index) if rate_profile_index.strip() else None

    maneuver_id = await _resolve_maneuver(maneuver_type_name or None, db)
    pid_id      = await _resolve_pid(fid, pid_index,  db)
    rate_id     = await _resolve_rate(fid, rate_index, db)

    segment = Segment(
        id               = seg_id,
        flight_id        = fid,
        label            = label,
        start_iteration  = start_iteration,
        end_iteration    = end_iteration,
        maneuver_type_id = maneuver_id,
        pid_profile_id   = pid_id,
        rate_profile_id  = rate_id,
        csv_path         = str(dest_path),
        notes            = notes or None,
    )
    db.add(segment)
    await db.commit()
    await db.refresh(segment)

    mt_name = None
    if segment.maneuver_type_id:
        mt = await db.get(ManeuverType, segment.maneuver_type_id)
        mt_name = mt.name if mt else None

    return SegmentOut(
        id=segment.id, flight_id=segment.flight_id, label=segment.label,
        start_iteration=segment.start_iteration, end_iteration=segment.end_iteration,
        duration_loops=segment.end_iteration - segment.start_iteration,
        maneuver_type=mt_name, pid_profile_id=segment.pid_profile_id,
        rate_profile_id=segment.rate_profile_id, csv_path=segment.csv_path,
        row_count=row_count, notes=segment.notes, created_at=segment.created_at,
    )


@router.get("/", response_model=list[SegmentOut])
async def list_segments(flight_id: uuid.UUID = Query(...), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Segment).where(Segment.flight_id == flight_id).order_by(Segment.start_iteration)
    )
    out = []
    for s in result.scalars().all():
        mt_name = None
        if s.maneuver_type_id:
            mt = await db.get(ManeuverType, s.maneuver_type_id)
            mt_name = mt.name if mt else None
        out.append(SegmentOut(
            id=s.id, flight_id=s.flight_id, label=s.label,
            start_iteration=s.start_iteration, end_iteration=s.end_iteration,
            duration_loops=s.end_iteration - s.start_iteration,
            maneuver_type=mt_name, pid_profile_id=s.pid_profile_id,
            rate_profile_id=s.rate_profile_id, csv_path=s.csv_path,
            row_count=None, notes=s.notes, created_at=s.created_at,
        ))
    return out


@router.get("/{segment_id}", response_model=SegmentOut)
async def get_segment(segment_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    s = await db.get(Segment, segment_id)
    if not s:
        raise HTTPException(status_code=404, detail="Segment not found")
    mt_name = None
    if s.maneuver_type_id:
        mt = await db.get(ManeuverType, s.maneuver_type_id)
        mt_name = mt.name if mt else None
    return SegmentOut(
        id=s.id, flight_id=s.flight_id, label=s.label,
        start_iteration=s.start_iteration, end_iteration=s.end_iteration,
        duration_loops=s.end_iteration - s.start_iteration,
        maneuver_type=mt_name, pid_profile_id=s.pid_profile_id,
        rate_profile_id=s.rate_profile_id, csv_path=s.csv_path,
        row_count=None, notes=s.notes, created_at=s.created_at,
    )


@router.delete("/{segment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_segment(segment_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    s = await db.get(Segment, segment_id)
    if not s:
        raise HTTPException(status_code=404, detail="Segment not found")
    if s.csv_path and Path(s.csv_path).exists():
        Path(s.csv_path).unlink(missing_ok=True)
    await db.delete(s)
    await db.commit()
