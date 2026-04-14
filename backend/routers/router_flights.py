"""
Router: /api/flights

Endpoints:
  POST   /                  Upload a blackbox CSV and create a flight record
  GET    /                  List all flights
  GET    /{flight_id}       Get a single flight with its segments
  DELETE /{flight_id}       Delete a flight (cascades to segments + metrics)
"""

import uuid
import shutil
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, Field

from core.config import settings
from core.deps import get_db
from db.models import Flight
from services.blackbox_parser import parse_uploaded_csv

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────────

class FlightOut(BaseModel):
    id:                    uuid.UUID
    name:                  str
    craft_name:            str | None
    flown_at:              str | None
    csv_filename:          str | None
    total_loop_iterations: int | None
    sample_rate_hz:        float | None
    duration_s:            float | None
    firmware_version:      str | None
    board_name:            str | None
    notes:                 str | None

    class Config:
        from_attributes = True


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/", response_model=FlightOut, status_code=status.HTTP_201_CREATED)
async def upload_flight(
    file:     UploadFile = File(..., description="Rotorflight blackbox CSV export"),
    name:     str        = Form(..., description="Human-readable flight name"),
    notes:    str        = Form(""),
    db:       AsyncSession = Depends(get_db),
):
    """
    Upload a Rotorflight blackbox CSV.

    - Saves the file to DATA_DIR
    - Parses the preamble to extract sample rate, firmware version, duration
    - Creates a Flight record in the database
    """
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a .csv export")

    # Save file to disk
    flight_id = uuid.uuid4()
    dest_dir  = Path(settings.data_dir) / str(flight_id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / file.filename

    with open(dest_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    # Parse preamble to extract metadata (fast — does not load all rows)
    meta = parse_uploaded_csv(str(dest_path))

    flight = Flight(
        id                    = flight_id,
        name                  = name,
        craft_name            = meta.get("craft_name") or meta.get("Craft name"),
        csv_filename          = file.filename,
        csv_path              = str(dest_path),
        total_loop_iterations = meta.get("total_loop_iterations"),
        sample_rate_hz        = meta.get("sample_rate_hz"),
        duration_s            = meta.get("duration_s"),
        firmware_version      = meta.get("firmwareVersion"),
        board_name            = meta.get("Board information"),
        notes                 = notes or None,
    )
    db.add(flight)
    await db.commit()
    await db.refresh(flight)
    return flight


@router.get("/", response_model=list[FlightOut])
async def list_flights(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Flight).order_by(Flight.created_at.desc()))
    return result.scalars().all()


@router.get("/{flight_id}", response_model=FlightOut)
async def get_flight(flight_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    flight = await db.get(Flight, flight_id)
    if not flight:
        raise HTTPException(status_code=404, detail="Flight not found")
    return flight


@router.delete("/{flight_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_flight(flight_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    flight = await db.get(Flight, flight_id)
    if not flight:
        raise HTTPException(status_code=404, detail="Flight not found")

    # Remove uploaded files
    if flight.csv_path:
        flight_dir = Path(flight.csv_path).parent
        if flight_dir.exists():
            shutil.rmtree(flight_dir, ignore_errors=True)

    await db.delete(flight)
    await db.commit()
