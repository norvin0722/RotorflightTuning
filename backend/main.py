from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import traceback
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("rf_backend")

from routers import flights, segments, analysis, config_dumps, ai

app = FastAPI(title="Rotorflight Tuning API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    tb = traceback.format_exc()
    logger.error(
        "UNHANDLED 500 on %s %s\n%s: %s\n%s",
        request.method, request.url.path,
        type(exc).__name__, exc, tb,
    )
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc), "type": type(exc).__name__},
    )


# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(flights.router,      prefix="/api/flights",      tags=["flights"])
app.include_router(segments.router,     prefix="/api/segments",     tags=["segments"])
app.include_router(analysis.router,     prefix="/api/analysis",     tags=["analysis"])
app.include_router(config_dumps.router, prefix="/api/config-dumps", tags=["config"])
app.include_router(ai.router,           prefix="/api/ai",           tags=["ai"])


# ── Health / diagnostics ──────────────────────────────────────────────────────
@app.get("/health")
async def health():
    """Basic liveness check — no DB required."""
    return {"status": "ok", "service": "rf-tuning-backend"}


@app.get("/health/db")
async def health_db():
    """
    Full DB connectivity + schema check.
    Visit http://localhost:8000/health/db after deploy to verify everything is wired up.
    Returns the column types for the flights and segments tables.
    """
    from db.session import AsyncSessionLocal
    from sqlalchemy import text
    out: dict = {}
    try:
        async with AsyncSessionLocal() as db:
            await db.execute(text("SELECT 1"))
        out["connection"] = "ok"
    except Exception as e:
        out["connection"] = f"FAILED: {e}"
        return JSONResponse(status_code=503, content=out)

    try:
        async with AsyncSessionLocal() as db:
            r = await db.execute(text(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'public' ORDER BY table_name"
            ))
            out["tables"] = [row[0] for row in r.fetchall()]
    except Exception as e:
        out["tables"] = f"FAILED: {e}"

    try:
        async with AsyncSessionLocal() as db:
            r = await db.execute(text(
                "SELECT column_name, data_type "
                "FROM information_schema.columns "
                "WHERE table_name = 'flights' ORDER BY ordinal_position"
            ))
            out["flights_columns"] = {row[0]: row[1] for row in r.fetchall()}

            r2 = await db.execute(text(
                "SELECT column_name, data_type "
                "FROM information_schema.columns "
                "WHERE table_name = 'segments' ORDER BY ordinal_position"
            ))
            out["segments_columns"] = {row[0]: row[1] for row in r2.fetchall()}
    except Exception as e:
        out["schema"] = f"FAILED: {e}"

    return out


@app.get("/api/debug/config/{flight_id}")
async def debug_config(flight_id: str):
    """
    Quick diagnostic: shows exactly what the for-flight/full endpoint returns.
    Visit http://localhost:8000/api/debug/config/{flight_id}
    """
    from db.session import AsyncSessionLocal
    from sqlalchemy import select
    from db.models import ConfigDump
    from services.rf_config_parser import parse_dump

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(ConfigDump).where(ConfigDump.flight_id == flight_id)
            .order_by(ConfigDump.created_at.desc())
        )
        dump = result.scalars().first()
        if not dump:
            return {"found": False, "message": "No config dump for this flight_id"}

        parsed = parse_dump(dump.raw_text or "")
        gf = parsed.get("gyroFilters", {})
        return {
            "found": True,
            "raw_text_length": len(dump.raw_text or ""),
            "gyroFilters": gf,
            "mainGearRatio": parsed.get("mainGearRatio"),
            "tailGearRatio": parsed.get("tailGearRatio"),
            "rpm_source_roll_raw":  gf.get("rpmSourceRoll"),
            "rpm_q_roll_raw":       gf.get("rpmQRoll"),
            "rpm_center_roll_raw":  gf.get("rpmCenterRoll"),
        }
