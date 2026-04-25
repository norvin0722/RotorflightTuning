from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime

from core.config import settings
from core.deps import get_db
from db.models import AIAnalysis, SegmentMetric, Segment
from services.ai_client import request_ai_analysis

router = APIRouter()


async def _run_ai_task(segment_id: str):
    from db.session import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        analysis = AIAnalysis(segment_id=segment_id, status="running", model_used=settings.lm_studio_model)
        db.add(analysis)
        await db.commit()
        await db.refresh(analysis)

        try:
            # Gather scalar metrics for context
            result = await db.execute(
                select(SegmentMetric).where(
                    SegmentMetric.segment_id == segment_id,
                    SegmentMetric.value_float.isnot(None),
                )
            )
            metrics = {f"{r.module}_{r.metric_name}": r.value_float for r in result.scalars().all()}

            narrative, structured = await request_ai_analysis(segment_id, metrics)
            analysis.narrative = narrative
            analysis.structured_output = structured
            analysis.status = "complete"
            analysis.completed_at = datetime.utcnow()
        except Exception as e:
            analysis.status = "error"
            analysis.narrative = str(e)

        await db.commit()


@router.post("/analyze/{segment_id}", status_code=202)
async def analyze(
    segment_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    seg = await db.get(Segment, segment_id)
    if not seg:
        raise HTTPException(404, "Segment not found")
    background_tasks.add_task(_run_ai_task, segment_id)
    return {"status": "accepted", "segment_id": segment_id}


@router.get("/results/{segment_id}")
async def get_ai_results(segment_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(AIAnalysis)
        .where(AIAnalysis.segment_id == segment_id)
        .order_by(AIAnalysis.requested_at.desc())
    )
    analysis = result.scalars().first()
    if not analysis:
        return {"status": "not_started", "segment_id": segment_id}
    return {
        "status": analysis.status,
        "model": analysis.model_used,
        "narrative": analysis.narrative,
        "structured": analysis.structured_output,
        "completed_at": analysis.completed_at,
    }


@router.get("/models")
async def list_models():
    return {"models": [settings.lm_studio_model]}
