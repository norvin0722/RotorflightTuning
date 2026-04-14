"""
Rotorflight Analyzer — FastAPI backend entry point.

Project layout:
  backend/
  ├── main.py                  ← this file
  ├── Dockerfile
  ├── requirements.txt
  ├── db/
  │   ├── session.py           ← async SQLAlchemy engine + session
  │   ├── models.py            ← ORM models (mirrors init.sql)
  │   └── init.sql             ← schema (run by Postgres on first start)
  ├── routers/
  │   ├── flights.py           ← upload CSV, list/get flights
  │   ├── config_dumps.py      ← upload dump all, parse, store
  │   ├── segments.py          ← create/list/delete segments
  │   ├── analysis.py          ← trigger analysis, fetch results
  │   └── ai.py                ← trigger AI analysis, fetch results
  ├── services/
  │   ├── blackbox_parser.py   ← wraps rf_blackbox_parser.py
  │   ├── config_parser.py     ← wraps rf_config_parser.py
  │   ├── analysis_engine.py   ← wraps rf_analysis_engine.py
  │   └── ai_client.py         ← calls AI sidecar service
  └── core/
      ├── config.py            ← settings from env vars
      └── deps.py              ← FastAPI dependency injection
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import settings
from db.session import engine, Base
from routers import flights, config_dumps, segments, analysis, ai


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create tables if they don't exist (init.sql handles schema on first run;
    # this is a safety net for dev environments without Docker)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield


app = FastAPI(
    title="Rotorflight Blackbox Analyzer",
    version="0.1.0",
    description="Ingest, segment, and analyze Rotorflight blackbox logs.",
    lifespan=lifespan,
)

# Allow the Vite dev server to call the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # open in dev; restrict to frontend_url in production
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(flights.router,       prefix="/api/flights",       tags=["flights"])
app.include_router(config_dumps.router,  prefix="/api/config-dumps",  tags=["config"])
app.include_router(segments.router,      prefix="/api/segments",      tags=["segments"])
app.include_router(analysis.router,      prefix="/api/analysis",      tags=["analysis"])
app.include_router(ai.router,            prefix="/api/ai",            tags=["ai"])


@app.get("/health")
async def health():
    return {"status": "ok"}
