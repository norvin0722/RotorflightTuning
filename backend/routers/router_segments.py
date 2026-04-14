"""
Router: /api/segments

Endpoints:
  POST   /                          Create a segment on a flight
  GET    /?flight_id={id}           List segments for a flight
  GET    /{segment_id}              Get a segment with its metrics summary
  DELETE /{segment_id}              Delete a segment + its metrics
"""

import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from core.deps import get_db
from db.models import Segment, ManeuverType, PidProfile, RateProfile

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────────

class SegmentCreate(BaseModel):
    flight_id:            uuid.UUID
    label:                str
    start_iteration:      int
    end_iteration:        int
    maneuver_type_name:   str | None = None   # looked up by name
    pid_profile_index:    int | None = None   # matched from config dump
    rate_profile_index:   int | None = None
    notes:                str | None = None


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
    notes:            str | None

    class Config:
        from_attributes = True


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _resolve_maneuver(name: str | None, db: AsyncSession) -> uuid.UUID | None:
    if not name:
        return None
    result = await db.execute(
        select(ManeuverType).where(ManeuverType.name == name)
    )
    mt = result.scalar_one_or_none()
    if mt:
        return mt.id
    # Auto-create as custom if not found
    new_mt = ManeuverType(name=name, is_custom=True)
    db.add(new_mt)
    await db.flush()
    return new_mt.id


async def _resolve_pid_profile(
    flight_id: uuid.UUID,
    profile_index: int | None,
    db: AsyncSession,
) -> uuid.UUID | None:
    if profile_index is None:
        return None
    # Find the config dump for this flight, then match profile index
    from db.models import ConfigDump
    dump_result = await db.execute(
        select(ConfigDump).where(ConfigDump.flight_id == flight_id).limit(1)
    )
    dump = dump_result.scalar_one_or_none()
    if not dump:
        return None
    pid_result = await db.execute(
        select(PidProfile).where(
            PidProfile.config_dump_id == dump.id,
            PidProfile.profile_index == profile_index,
        )
    )
    pid = pid_result.scalar_one_or_none()
    return pid.id if pid else None


async def _resolve_rate_profile(
    flight_id: uuid.UUID,
    profile_index: int | None,
    db: AsyncSession,
) -> uuid.UUID | None:
    if profile_index is None:
        return None
    from db.models import ConfigDump
    dump_result = await db.execute(
        select(ConfigDump).where(ConfigDump.flight_id == flight_id).limit(1)
    )
    dump = dump_result.scalar_one_or_none()
    if not dump:
        return None
    rate_result = await db.execute(
        select(RateProfile).where(
            RateProfile.config_dump_id == dump.id,
            RateProfile.profile_index == profile_index,
        )
    )
    rate = rate_result.scalar_one_or_none()
    return rate.id if rate else None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/", response_model=SegmentOut, status_code=status.HTTP_201_CREATED)
async def create_segment(body: SegmentCreate, db: AsyncSession = Depends(get_db)):
    if body.end_iteration <= body.start_iteration:
        raise HTTPException(
            status_code=400,
            detail="end_iteration must be greater than start_iteration"
        )

    maneuver_type_id = await _resolve_maneuver(body.maneuver_type_name, db)
    pid_profile_id   = await _resolve_pid_profile(body.flight_id, body.pid_profile_index, db)
    rate_profile_id  = await _resolve_rate_profile(body.flight_id, body.rate_profile_index, db)

    segment = Segment(
        flight_id        = body.flight_id,
        label            = body.label,
        start_iteration  = body.start_iteration,
        end_iteration    = body.end_iteration,
        maneuver_type_id = maneuver_type_id,
        pid_profile_id   = pid_profile_id,
        rate_profile_id  = rate_profile_id,
        notes            = body.notes,
    )
    db.add(segment)
    await db.commit()
    await db.refresh(segment)

    return SegmentOut(
        id               = segment.id,
        flight_id        = segment.flight_id,
        label            = segment.label,
        start_iteration  = segment.start_iteration,
        end_iteration    = segment.end_iteration,
        duration_loops   = segment.end_iteration - segment.start_iteration,
        maneuver_type    = body.maneuver_type_name,
        pid_profile_id   = segment.pid_profile_id,
        rate_profile_id  = segment.rate_profile_id,
        notes            = segment.notes,
    )


@router.get("/", response_model=list[SegmentOut])
async def list_segments(
    flight_id: uuid.UUID = Query(...),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Segment)
        .where(Segment.flight_id == flight_id)
        .order_by(Segment.start_iteration)
    )
    segments = result.scalars().all()
    out = []
    for s in segments:
        mt_name = None
        if s.maneuver_type_id:
            mt = await db.get(ManeuverType, s.maneuver_type_id)
            mt_name = mt.name if mt else None
        out.append(SegmentOut(
            id               = s.id,
            flight_id        = s.flight_id,
            label            = s.label,
            start_iteration  = s.start_iteration,
            end_iteration    = s.end_iteration,
            duration_loops   = s.end_iteration - s.start_iteration,
            maneuver_type    = mt_name,
            pid_profile_id   = s.pid_profile_id,
            rate_profile_id  = s.rate_profile_id,
            notes            = s.notes,
        ))
    return out


@router.get("/{segment_id}", response_model=SegmentOut)
async def get_segment(segment_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    segment = await db.get(Segment, segment_id)
    if not segment:
        raise HTTPException(status_code=404, detail="Segment not found")
    return segment


@router.delete("/{segment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_segment(segment_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    segment = await db.get(Segment, segment_id)
    if not segment:
        raise HTTPException(status_code=404, detail="Segment not found")
    await db.delete(segment)
    await db.commit()
