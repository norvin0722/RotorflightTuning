"""
Router: /api/flights

Flight records are now metadata-only — no CSV upload.
The browser parses the full CSV and sends only segment slices.

Endpoints:
  POST   /                  Create a flight record from browser-parsed metadata
  GET    /                  List all flights
  GET    /{flight_id}       Get a single flight
  DELETE /{flight_id}       Delete a flight + cascade
"""

import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from core.deps import get_db
from db.models import Flight

router = APIRouter()


class FlightCreate(BaseModel):
    name:                  str
    craft_name:            str | None = None
    firmware_version:      str | None = None
    board_name:            str | None = None
    sample_rate_hz:        float | None = None
    total_loop_iterations: int | None = None
    duration_s:            float | None = None
    original_filename:     str | None = None
    notes:                 str | None = None


class FlightOut(BaseModel):
    id:                    uuid.UUID
    name:                  str
    craft_name:            str | None
    firmware_version:      str | None
    board_name:            str | None
    sample_rate_hz:        float | None
    total_loop_iterations: int | None
    duration_s:            float | None
    csv_filename:          str | None
    notes:                 str | None
    created_at:            datetime

    class Config:
        from_attributes = True


@router.post("/", response_model=FlightOut, status_code=status.HTTP_201_CREATED)
async def create_flight(body: FlightCreate, db: AsyncSession = Depends(get_db)):
    """
    Create a flight record from metadata parsed in the browser.
    No file is uploaded — the browser handles all CSV parsing.
    """
    flight = Flight(
        id                    = uuid.uuid4(),
        name                  = body.name,
        craft_name            = body.craft_name,
        csv_filename          = body.original_filename,
        csv_path              = None,           # no server-side file
        total_loop_iterations = body.total_loop_iterations,
        sample_rate_hz        = body.sample_rate_hz,
        duration_s            = body.duration_s,
        firmware_version      = body.firmware_version,
        board_name            = body.board_name,
        notes                 = body.notes,
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
    await db.delete(flight)
    await db.commit()
