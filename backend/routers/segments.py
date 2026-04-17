import os
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import joinedload
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from core.deps import get_db
from core.config import settings
from db.models import Segment

router = APIRouter()


class SegmentOut(BaseModel):
    id: str
    flight_id: str
    label: str
    start_iteration: Optional[int] = None
    end_iteration: Optional[int] = None
    csv_path: Optional[str] = None
    row_count: Optional[int] = None
    notes: Optional[str] = None
    analysis_status: Optional[str] = None
    created_at: Optional[datetime] = None
    duration_loops: Optional[int] = None
    duration_s: Optional[float] = None

    class Config:
        from_attributes = True

    @classmethod
    def from_orm(cls, seg: Segment):
        loops = seg.duration_loops
        rate = seg.flight.sample_rate_hz if seg.flight else None
        duration_s = (loops / rate) if (loops is not None and rate) else None
        return cls(
            id=str(seg.id),
            flight_id=str(seg.flight_id),
            label=seg.label,
            start_iteration=seg.start_iteration,
            end_iteration=seg.end_iteration,
            csv_path=seg.csv_path,
            row_count=seg.row_count,
            notes=seg.notes,
            analysis_status=seg.analysis_status,
            created_at=seg.created_at,
            duration_loops=loops,
            duration_s=duration_s,
        )


@router.post("/upload", response_model=SegmentOut, status_code=201)
async def upload_segment(
    flight_id: str = Form(...),
    label: str = Form(...),
    start_iteration: int = Form(...),
    end_iteration: int = Form(...),
    notes: Optional[str] = Form(default=None),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    # Create the storage directory
    seg_dir = os.path.join(settings.data_dir, flight_id, "segments")
    os.makedirs(seg_dir, exist_ok=True)

    # Read and save the CSV slice
    content = await file.read()
    lines = content.decode("utf-8", errors="replace").splitlines()
    # Subtract 1 for the header row; clamp to 0
    data_rows = max(0, len(lines) - 1)

    safe_label = label.replace(" ", "_").replace("/", "_").replace("\\", "_")
    filename = f"{safe_label}.csv"
    filepath = os.path.join(seg_dir, filename)
    with open(filepath, "wb") as f:
        f.write(content)

    # Sanitise notes — reject the literal string "null" sent by some browsers
    clean_notes = notes if (notes and notes.strip() and notes.strip().lower() != "null") else None

    seg = Segment(
        flight_id=flight_id,
        label=label,
        start_iteration=start_iteration,
        end_iteration=end_iteration,
        csv_path=filepath,
        row_count=data_rows,
        notes=clean_notes,
        analysis_status="pending",
    )
    db.add(seg)
    await db.commit()
    await db.refresh(seg)
    return SegmentOut.from_orm(seg)


@router.get("", response_model=list[SegmentOut])
async def list_segments(flight_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Segment)
        .where(Segment.flight_id == flight_id)
        .order_by(Segment.created_at.asc())
        .options(joinedload(Segment.flight))
    )
    segs = result.scalars().all()
    return [SegmentOut.from_orm(s) for s in segs]


@router.get("/{segment_id}", response_model=SegmentOut)
async def get_segment(segment_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Segment)
        .where(Segment.id == segment_id)
        .options(joinedload(Segment.flight))
    )
    seg = result.scalars().first()
    if not seg:
        raise HTTPException(404, "Segment not found")
    return SegmentOut.from_orm(seg)


@router.delete("/{segment_id}", status_code=204)
async def delete_segment(segment_id: str, db: AsyncSession = Depends(get_db)):
    seg = await db.get(Segment, segment_id)
    if not seg:
        raise HTTPException(404, "Segment not found")
    if seg.csv_path and os.path.exists(seg.csv_path):
        try:
            os.remove(seg.csv_path)
        except OSError:
            pass
    await db.delete(seg)
    await db.commit()
