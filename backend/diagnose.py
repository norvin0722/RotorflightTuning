#!/usr/bin/env python3
"""
Run this INSIDE the backend container to diagnose the 500 error:
  docker compose exec backend python3 /app/diagnose.py
"""
import sys, traceback, uuid
from datetime import datetime

print("=" * 60)
print("Rotorflight Backend Diagnostics")
print("=" * 60)

# ── 1. Import all modules ────────────────────────────────────────
print("\n[1] Importing modules...")
try:
    from db.models import Flight, Segment, SegmentMetric, ConfigDump
    print("  ✓ db.models")
except Exception as e:
    print(f"  ✗ db.models: {e}")
    traceback.print_exc()
    sys.exit(1)

try:
    from routers.segments import SegmentOut
    print("  ✓ routers.segments")
except Exception as e:
    print(f"  ✗ routers.segments: {e}")
    traceback.print_exc()
    sys.exit(1)

try:
    from routers.flights import FlightCreate, FlightOut
    print("  ✓ routers.flights")
except Exception as e:
    print(f"  ✗ routers.flights: {e}")
    traceback.print_exc()

try:
    from routers.config_dumps import router as cfg_router
    print("  ✓ routers.config_dumps")
except Exception as e:
    print(f"  ✗ routers.config_dumps: {e}")
    traceback.print_exc()

try:
    from routers.analysis import router as analysis_router
    print("  ✓ routers.analysis")
except Exception as e:
    print(f"  ✗ routers.analysis: {e}")
    traceback.print_exc()

try:
    from services.rf_analysis_engine import run_full_analysis
    print("  ✓ services.rf_analysis_engine")
except Exception as e:
    print(f"  ✗ services.rf_analysis_engine: {e}")
    traceback.print_exc()

try:
    from services.rf_config_parser import parse_dump
    print("  ✓ services.rf_config_parser")
except Exception as e:
    print(f"  ✗ services.rf_config_parser: {e}")
    traceback.print_exc()

# ── 2. Test Segment object creation ─────────────────────────────
print("\n[2] Testing Segment model...")
try:
    seg = Segment(
        flight_id=str(uuid.uuid4()),
        label="DiagTest",
        start_iteration=1000,
        end_iteration=5000,
        csv_path="/tmp/test.csv",
        row_count=4000,
        notes=None,
        analysis_status="pending",
    )
    seg.created_at = datetime.utcnow()
    print(f"  ✓ Segment created: id={seg.id}")
    print(f"  ✓ duration_loops = {seg.duration_loops}")
except Exception as e:
    print(f"  ✗ Segment creation failed: {e}")
    traceback.print_exc()

# ── 3. Test SegmentOut serialisation ────────────────────────────
print("\n[3] Testing SegmentOut serialisation...")
try:
    out = SegmentOut.from_orm(seg)
    print(f"  ✓ SegmentOut: id={out.id}, duration_loops={out.duration_loops}")
    print(f"  ✓ JSON: {out.model_dump()}")
except Exception as e:
    print(f"  ✗ SegmentOut failed: {e}")
    traceback.print_exc()

# ── 4. Test Flight model & FlightOut ────────────────────────────
print("\n[4] Testing Flight model...")
try:
    fl = Flight(
        name="DiagFlight",
        craft_name="TestCraft",
        sample_rate_hz=1000.0,
        duration_s=60.0,
        total_loop_iterations=60000,
    )
    fl.created_at = datetime.utcnow()
    out2 = FlightOut.model_validate(fl, from_attributes=True)
    print(f"  ✓ FlightOut: id={out2.id}, name={out2.name}")
except Exception as e:
    print(f"  ✗ Flight/FlightOut failed: {e}")
    traceback.print_exc()

# ── 5. Test DB connection ────────────────────────────────────────
print("\n[5] Testing database connection...")
import asyncio
async def test_db():
    try:
        from db.session import AsyncSessionLocal
        from sqlalchemy import text
        async with AsyncSessionLocal() as db:
            result = await db.execute(text("SELECT 1 AS ok"))
            row = result.fetchone()
            print(f"  ✓ DB connected: SELECT 1 = {row[0]}")

        # Check tables exist
        async with AsyncSessionLocal() as db:
            result = await db.execute(text(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema='public' ORDER BY table_name"
            ))
            tables = [r[0] for r in result.fetchall()]
            print(f"  ✓ Tables in DB: {tables}")

        # Check flights table column types
        async with AsyncSessionLocal() as db:
            result = await db.execute(text(
                "SELECT column_name, data_type FROM information_schema.columns "
                "WHERE table_name='flights' ORDER BY ordinal_position"
            ))
            cols = [(r[0], r[1]) for r in result.fetchall()]
            print(f"  ✓ flights columns: {cols}")

        async with AsyncSessionLocal() as db:
            result = await db.execute(text(
                "SELECT column_name, data_type FROM information_schema.columns "
                "WHERE table_name='segments' ORDER BY ordinal_position"
            ))
            cols = [(r[0], r[1]) for r in result.fetchall()]
            print(f"  ✓ segments columns: {cols}")

    except Exception as e:
        print(f"  ✗ DB error: {e}")
        traceback.print_exc()

asyncio.run(test_db())

# ── 6. Test full insert round-trip ──────────────────────────────
print("\n[6] Testing full DB insert round-trip...")
async def test_insert():
    try:
        from db.session import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            fl = Flight(
                name="DiagFlight_RoundTrip",
                craft_name="TestCraft",
                sample_rate_hz=1000.0,
                total_loop_iterations=60000,
            )
            db.add(fl)
            await db.commit()
            await db.refresh(fl)
            print(f"  ✓ Flight inserted: id={fl.id}")

            seg = Segment(
                flight_id=fl.id,
                label="DiagSeg",
                start_iteration=1000,
                end_iteration=5000,
                csv_path="/tmp/diag.csv",
                row_count=4000,
                analysis_status="pending",
            )
            db.add(seg)
            await db.commit()
            await db.refresh(seg)
            print(f"  ✓ Segment inserted: id={seg.id}, duration_loops={seg.duration_loops}")

            # Clean up
            await db.delete(seg)
            await db.delete(fl)
            await db.commit()
            print("  ✓ Cleanup done")

    except Exception as e:
        print(f"  ✗ Insert failed: {e}")
        traceback.print_exc()

asyncio.run(test_insert())

print("\n" + "=" * 60)
print("Diagnostics complete")
print("=" * 60)
