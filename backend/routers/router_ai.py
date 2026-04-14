"""
Router: /api/ai

Endpoints:
  POST  /analyze/{segment_id}     Request AI analysis of a segment
  GET   /results/{segment_id}     Fetch AI analysis results
  GET   /models                   List available AI models
"""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from core.deps import get_db
from db.models import AiAnalysis, Segment, SegmentMetric, Flight, PidProfile
from services.ai_client import request_ai_analysis

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────────

class AiAnalysisRequest(BaseModel):
    model:           str = "claude-sonnet-4-20250514"
    prompt_template: str = "default"
    # Which analysis modules to include as context for the AI
    include_modules: list[str] = [
        "tracking_error", "step_response", "oscillation",
        "pidf_balance", "control_latency", "governor",
    ]


class AiAnalysisOut(BaseModel):
    id:                uuid.UUID
    segment_id:        uuid.UUID
    model_used:        str
    narrative:         str | None
    structured_output: dict | None
    status:            str
    requested_at:      datetime
    completed_at:      datetime | None

    class Config:
        from_attributes = True


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/analyze/{segment_id}", status_code=status.HTTP_202_ACCEPTED)
async def request_analysis(
    segment_id:       uuid.UUID,
    body:             AiAnalysisRequest,
    background_tasks: BackgroundTasks,
    db:               AsyncSession = Depends(get_db),
):
    segment = await db.get(Segment, segment_id)
    if not segment:
        raise HTTPException(status_code=404, detail="Segment not found")

    # Create a pending record
    ai_rec = AiAnalysis(
        segment_id       = segment_id,
        model_used       = body.model,
        prompt_template  = body.prompt_template,
        status           = "pending",
    )
    db.add(ai_rec)
    await db.commit()
    await db.refresh(ai_rec)

    background_tasks.add_task(
        _run_ai_analysis,
        ai_id           = ai_rec.id,
        segment_id      = segment_id,
        model           = body.model,
        prompt_template = body.prompt_template,
        include_modules = body.include_modules,
    )

    return {"status": "accepted", "analysis_id": str(ai_rec.id)}


@router.get("/results/{segment_id}", response_model=list[AiAnalysisOut])
async def get_ai_results(segment_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(AiAnalysis)
        .where(AiAnalysis.segment_id == segment_id)
        .order_by(AiAnalysis.requested_at.desc())
    )
    return result.scalars().all()


@router.get("/models")
async def list_models():
    return {
        "models": [
            {"id": "claude-opus-4-6",   "name": "Claude Opus 4.6",   "provider": "anthropic"},
            {"id": "claude-sonnet-4-6", "name": "Claude Sonnet 4.6", "provider": "anthropic"},
            {"id": "claude-haiku-4-5-20251001", "name": "Claude Haiku 4.5", "provider": "anthropic"},
        ]
    }


# ── Background task ───────────────────────────────────────────────────────────

async def _run_ai_analysis(
    ai_id:           uuid.UUID,
    segment_id:      uuid.UUID,
    model:           str,
    prompt_template: str,
    include_modules: list[str],
):
    from db.session import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        ai_rec = await db.get(AiAnalysis, ai_id)
        if not ai_rec:
            return

        try:
            # Update status to running
            ai_rec.status = "running"
            await db.commit()

            # Gather segment context
            segment = await db.get(Segment, segment_id)
            flight  = await db.get(Flight, segment.flight_id)

            # Pull computed metrics for context
            metrics_result = await db.execute(
                select(SegmentMetric)
                .where(
                    SegmentMetric.segment_id == segment_id,
                    SegmentMetric.module.in_(include_modules),
                )
            )
            metrics = metrics_result.scalars().all()
            metrics_context = {}
            for m in metrics:
                if m.module not in metrics_context:
                    metrics_context[m.module] = {}
                metrics_context[m.module][m.metric_name] = (
                    m.value_float if m.value_float is not None else m.value_json
                )

            # Pull PID profile context
            pid_context = None
            if segment.pid_profile_id:
                pid = await db.get(PidProfile, segment.pid_profile_id)
                if pid:
                    pid_context = {
                        "profile_index": pid.profile_index,
                        "gov_headspeed_rpm": pid.gov_headspeed_rpm,
                        "pitch_pid": {
                            "p": pid.pitch_p_gain, "i": pid.pitch_i_gain,
                            "d": pid.pitch_d_gain, "f": pid.pitch_f_gain,
                        },
                        "roll_pid": {
                            "p": pid.roll_p_gain, "i": pid.roll_i_gain,
                            "d": pid.roll_d_gain, "f": pid.roll_f_gain,
                        },
                        "yaw_pid": {
                            "p": pid.yaw_p_gain, "i": pid.yaw_i_gain,
                            "d": pid.yaw_d_gain,
                        },
                        "gyro_cutoffs_hz": {
                            "pitch": pid.pitch_gyro_cutoff_hz,
                            "roll":  pid.roll_gyro_cutoff_hz,
                            "yaw":   pid.yaw_gyro_cutoff_hz,
                        },
                    }

            # Build analysis context payload
            context = {
                "craft_name":      flight.craft_name if flight else None,
                "firmware":        flight.firmware_version if flight else None,
                "segment_label":   segment.label,
                "segment_loops":   segment.end_iteration - segment.start_iteration,
                "pid_profile":     pid_context,
                "computed_metrics": metrics_context,
            }

            # Call AI sidecar
            result = await request_ai_analysis(
                context         = context,
                model           = model,
                prompt_template = prompt_template,
            )

            ai_rec.narrative          = result.get("narrative")
            ai_rec.structured_output  = result.get("structured_output")
            ai_rec.status             = "complete"
            ai_rec.completed_at       = datetime.utcnow()

        except Exception as exc:
            ai_rec.status        = "error"
            ai_rec.error_message = str(exc)

        await db.commit()
