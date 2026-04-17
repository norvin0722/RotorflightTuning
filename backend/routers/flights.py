from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from core.deps import get_db
from db.models import Flight

router = APIRouter()


class FlightCreate(BaseModel):
    name: str
    craft_name: Optional[str] = None
    flown_at: Optional[datetime] = None
    csv_filename: Optional[str] = None
    total_loop_iterations: Optional[int] = None
    sample_rate_hz: Optional[float] = None
    duration_s: Optional[float] = None
    firmware_version: Optional[str] = None
    board_name: Optional[str] = None
    notes: Optional[str] = None


class FlightOut(BaseModel):
    id: str
    name: str
    craft_name: Optional[str]
    flown_at: Optional[datetime]
    csv_filename: Optional[str]
    total_loop_iterations: Optional[int]
    sample_rate_hz: Optional[float]
    duration_s: Optional[float]
    firmware_version: Optional[str]
    board_name: Optional[str]
    notes: Optional[str]
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


@router.post("", response_model=FlightOut, status_code=201)
async def create_flight(payload: FlightCreate, db: AsyncSession = Depends(get_db)):
    flight = Flight(**payload.model_dump())
    db.add(flight)
    await db.commit()
    await db.refresh(flight)
    return flight


@router.get("", response_model=list[FlightOut])
async def list_flights(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Flight).order_by(Flight.created_at.desc()))
    return result.scalars().all()


@router.get("/{flight_id}", response_model=FlightOut)
async def get_flight(flight_id: str, db: AsyncSession = Depends(get_db)):
    flight = await db.get(Flight, flight_id)
    if not flight:
        raise HTTPException(404, "Flight not found")
    return flight


@router.delete("/{flight_id}", status_code=204)
async def delete_flight(flight_id: str, db: AsyncSession = Depends(get_db)):
    flight = await db.get(Flight, flight_id)
    if not flight:
        raise HTTPException(404, "Flight not found")
    await db.delete(flight)
    await db.commit()
