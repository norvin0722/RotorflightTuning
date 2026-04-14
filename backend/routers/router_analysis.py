"""
Router: /api/analysis

Endpoints:
  POST  /run/{segment_id}           Run all analysis modules on a segment
  GET   /results/{segment_id}       Fetch all stored metrics for a segment
  GET   /results/{segment_id}/fft   Fetch FFT-specific results (large arrays)
  GET   /results/{segment_id}/bode  Fetch Bode/coherence results (large arrays)
  POST  /compare                    Compare metrics across multiple segment IDs
"""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from pydantic import BaseModel

from core.deps import get_db
from db.models import Flight, Segment, SegmentMetric, PidProfile, ConfigDump, FilterSetting
from services.analysis_engine import run_segment_analysis
from services.blackbox_parser import load_segment_dataframe

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────────

class FFTConfig(BaseModel):
    nperseg:     int   = 1024
    overlap_pct: float = 0.75
    window:      str   = "hann"
    db_scale:    bool  = True


class RunAnalysisRequest(BaseModel):
    fft:       FFTConfig = FFTConfig()
    modules:   list[str] | None = None  # None = run all


class MetricOut(BaseModel):
    metric_name: str
    value_float: float | None
    value_json:  Any | None
    unit:        str | None
    module:      str


class CompareRequest(BaseModel):
    segment_ids: list[uuid.UUID]
    module:      str = "tracking_error"


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post(
    "/run/{segment_id}",
    status_code=status.HTTP_202_ACCEPTED,
)
async def run_analysis(
    segment_id: uuid.UUID,
    body:       RunAnalysisRequest,
    background_tasks: BackgroundTasks,
    db:         AsyncSession = Depends(get_db),
):
    """
    Trigger analysis for a segment. Runs in the background.
    Poll GET /results/{segment_id} to check for completion.
    """
    segment = await db.get(Segment, segment_id)
    if not segment:
        raise HTTPException(status_code=404, detail="Segment not found")

    flight = await db.get(Flight, segment.flight_id)
    if not flight or not flight.csv_path:
        raise HTTPException(status_code=400, detail="Flight has no associated CSV file")

    # Resolve PID profile and filter settings for context
    pid_params = None
    global_filters = None

    if segment.pid_profile_id:
        pid_profile = await db.get(PidProfile, segment.pid_profile_id)
        if pid_profile:
            pid_params = {
                "pitch_gyro_cutoff": pid_profile.pitch_gyro_cutoff_hz,
                "roll_gyro_cutoff":  pid_profile.roll_gyro_cutoff_hz,
                "yaw_gyro_cutoff":   pid_profile.yaw_gyro_cutoff_hz,
                "pitch_d_cutoff":    pid_profile.pitch_d_cutoff_hz,
                "roll_d_cutoff":     pid_profile.roll_d_cutoff_hz,
                "yaw_d_cutoff":      pid_profile.yaw_d_cutoff_hz,
                "gov_headspeed":     pid_profile.gov_headspeed_rpm,
            }
            # Get filter settings from the same config dump
            fs_result = await db.execute(
                select(FilterSetting).where(
                    FilterSetting.config_dump_id == pid_profile.config_dump_id
                )
            )
            fs = fs_result.scalar_one_or_none()
            if fs:
                global_filters = {
                    "gyro_lpf1_type":      fs.gyro_lpf1_type,
                    "gyro_lpf1_static_hz": fs.gyro_lpf1_static_hz,
                    "gyro_lpf2_type":      fs.gyro_lpf2_type,
                    "gyro_lpf2_static_hz": fs.gyro_lpf2_static_hz,
                    "dyn_notch_min_hz":    fs.dyn_notch_min_hz,
                    "dyn_notch_max_hz":    fs.dyn_notch_max_hz,
                }

    background_tasks.add_task(
        _run_and_store,
        segment_id       = segment_id,
        csv_path         = flight.csv_path,
        start_iteration  = segment.start_iteration,
        end_iteration    = segment.end_iteration,
        sample_rate_hz   = flight.sample_rate_hz or 2000.0,
        pid_params       = pid_params,
        global_filters   = global_filters,
        target_headspeed = pid_params.get("gov_headspeed") if pid_params else None,
        fft_cfg          = body.fft,
        requested_modules= body.modules,
    )

    return {"status": "accepted", "segment_id": str(segment_id)}


@router.get("/results/{segment_id}", response_model=list[MetricOut])
async def get_results(
    segment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Return all scalar metrics. Excludes large FFT/Bode arrays."""
    result = await db.execute(
        select(SegmentMetric)
        .where(
            SegmentMetric.segment_id == segment_id,
            SegmentMetric.module.notin_(["fft_vibration", "bode_coherence"]),
        )
        .order_by(SegmentMetric.module, SegmentMetric.metric_name)
    )
    metrics = result.scalars().all()
    return [
        MetricOut(
            metric_name = m.metric_name,
            value_float = m.value_float,
            value_json  = m.value_json,
            unit        = m.unit,
            module      = m.module,
        )
        for m in metrics
    ]


@router.get("/results/{segment_id}/fft")
async def get_fft_results(
    segment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Return FFT data arrays for the charting layer."""
    result = await db.execute(
        select(SegmentMetric)
        .where(
            SegmentMetric.segment_id == segment_id,
            SegmentMetric.module == "fft_vibration",
        )
    )
    metrics = result.scalars().all()
    if not metrics:
        raise HTTPException(status_code=404, detail="No FFT results found. Run analysis first.")
    return {m.metric_name: m.value_json or m.value_float for m in metrics}


@router.get("/results/{segment_id}/bode")
async def get_bode_results(
    segment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """Return Bode + coherence arrays for the charting layer."""
    result = await db.execute(
        select(SegmentMetric)
        .where(
            SegmentMetric.segment_id == segment_id,
            SegmentMetric.module == "bode_coherence",
        )
    )
    metrics = result.scalars().all()
    if not metrics:
        raise HTTPException(status_code=404, detail="No Bode results found. Run analysis first.")
    return {m.metric_name: m.value_json or m.value_float for m in metrics}


@router.post("/compare")
async def compare_segments(
    body: CompareRequest,
    db:   AsyncSession = Depends(get_db),
):
    """
    Return metrics for the given module across multiple segments,
    keyed by segment_id — for the comparison table dashboard.
    """
    result = await db.execute(
        select(SegmentMetric)
        .where(
            SegmentMetric.segment_id.in_(body.segment_ids),
            SegmentMetric.module == body.module,
        )
        .order_by(SegmentMetric.segment_id, SegmentMetric.metric_name)
    )
    metrics = result.scalars().all()

    out: dict[str, dict] = {}
    for m in metrics:
        seg_key = str(m.segment_id)
        if seg_key not in out:
            out[seg_key] = {}
        out[seg_key][m.metric_name] = {
            "value": m.value_float if m.value_float is not None else m.value_json,
            "unit":  m.unit,
        }
    return out


# ── Background task ───────────────────────────────────────────────────────────

async def _run_and_store(
    segment_id:        uuid.UUID,
    csv_path:          str,
    start_iteration:   int,
    end_iteration:     int,
    sample_rate_hz:    float,
    pid_params:        dict | None,
    global_filters:    dict | None,
    target_headspeed:  int | None,
    fft_cfg,
    requested_modules: list[str] | None,
):
    """
    Background task: load segment DataFrame, run analysis engine,
    persist results to segment_metrics table.
    """
    from db.session import AsyncSessionLocal

    # Load just the segment rows from disk
    seg_df, col = load_segment_dataframe(csv_path, start_iteration, end_iteration)

    # Run analysis
    results = run_segment_analysis(
        df               = seg_df,
        col              = col,
        sample_rate_hz   = sample_rate_hz,
        pid_profile      = pid_params,
        global_filters   = global_filters,
        target_headspeed = target_headspeed,
        fft_cfg          = fft_cfg,
        modules          = requested_modules,
    )

    # Persist to DB
    async with AsyncSessionLocal() as db:
        # Clear existing metrics for this segment so re-runs replace stale data
        await db.execute(
            delete(SegmentMetric).where(SegmentMetric.segment_id == segment_id)
        )

        # Unit map for labeling
        UNIT_MAP = {
            "tracking_error":  "deg/s",
            "step_response":   "ms/%",
            "oscillation":     "Hz/au",
            "fft_vibration":   "dB",
            "bode_coherence":  "deg/dB",
            "governor":        "RPM",
            "pidf_balance":    "au",
            "control_latency": "ms",
            "servo":           "µs/%",
        }

        rows = []
        for module_name, module_data in results.items():
            unit_default = UNIT_MAP.get(module_name, "au")
            for key, value in module_data.items():
                if key.startswith("_"):
                    continue   # skip internal metadata keys

                if isinstance(value, (list, dict)):
                    rows.append(SegmentMetric(
                        segment_id  = segment_id,
                        module      = module_name,
                        metric_name = key,
                        value_json  = value,
                        unit        = unit_default,
                    ))
                elif isinstance(value, (int, float)):
                    rows.append(SegmentMetric(
                        segment_id  = segment_id,
                        module      = module_name,
                        metric_name = key,
                        value_float = float(value),
                        unit        = unit_default,
                    ))
                elif isinstance(value, str):
                    rows.append(SegmentMetric(
                        segment_id  = segment_id,
                        module      = module_name,
                        metric_name = key,
                        value_json  = value,
                        unit        = None,
                    ))
                elif isinstance(value, bool):
                    rows.append(SegmentMetric(
                        segment_id  = segment_id,
                        module      = module_name,
                        metric_name = key,
                        value_float = float(value),
                        unit        = None,
                    ))

        db.add_all(rows)
        await db.commit()
