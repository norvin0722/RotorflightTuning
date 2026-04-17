from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from core.deps import get_db
from db.models import Segment, SegmentMetric, Flight, ConfigDump
from services.blackbox_parser import load_segment_dataframe
from services.rf_analysis_engine import run_full_analysis
from services.rf_config_parser import parse_dump

router = APIRouter()


async def _run_analysis_task(segment_id: str):
    from db.session import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        seg = await db.get(Segment, segment_id)
        if not seg:
            return
        seg.analysis_status = "running"
        await db.commit()
        try:
            # Load the segment CSV
            df, sample_rate = load_segment_dataframe(seg.csv_path)

            # Load config dump for this flight (for analytical dynamics model)
            config_data = None
            if seg.flight_id:
                result = await db.execute(
                    select(ConfigDump)
                    .where(ConfigDump.flight_id == seg.flight_id)
                    .order_by(ConfigDump.created_at.desc())
                )
                dump = result.scalars().first()
                if dump and dump.raw_text:
                    try:
                        config_data = parse_dump(dump.raw_text)
                    except Exception:
                        config_data = None

            # Run analysis with config context
            results = run_full_analysis(df, sample_rate, config_data=config_data)

            # Clear old metrics
            await db.execute(
                delete(SegmentMetric).where(SegmentMetric.segment_id == segment_id)
            )

            # Store all scalar metrics and array metrics
            for module, metrics in results.items():
                for name, value in metrics.items():
                    if isinstance(value, (int, float)):
                        m = SegmentMetric(
                            segment_id=segment_id, module=module,
                            metric_name=name, value_float=float(value),
                        )
                    else:
                        m = SegmentMetric(
                            segment_id=segment_id, module=module,
                            metric_name=name, value_json=value,
                        )
                    db.add(m)

            seg.analysis_status = "complete"
            await db.commit()

        except Exception as e:
            import traceback
            print(f"Analysis error for segment {segment_id}: {e}\n{traceback.format_exc()}")
            seg.analysis_status = "error"
            await db.commit()
            raise


@router.post("/run/{segment_id}", status_code=202)
async def run_analysis(
    segment_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    seg = await db.get(Segment, segment_id)
    if not seg:
        raise HTTPException(404, "Segment not found")
    if not seg.csv_path:
        raise HTTPException(400, "Segment has no CSV file")
    background_tasks.add_task(_run_analysis_task, segment_id)
    return {"status": "accepted", "segment_id": segment_id}


@router.get("/results/{segment_id}")
async def get_results(segment_id: str, db: AsyncSession = Depends(get_db)):
    seg = await db.get(Segment, segment_id)
    if not seg:
        raise HTTPException(404, "Segment not found")

    result = await db.execute(
        select(SegmentMetric).where(SegmentMetric.segment_id == segment_id)
    )
    metrics_rows = result.scalars().all()

    scalars, arrays = {}, {}
    for m in metrics_rows:
        key = f"{m.module}_{m.metric_name}"
        if m.value_float is not None:
            scalars[key] = m.value_float
        elif m.value_json is not None:
            arrays[key] = m.value_json

    return {
        "segment_id": segment_id,
        "status":     seg.analysis_status,
        "metrics":    scalars,
        "arrays":     arrays,
    }


@router.get("/results/{segment_id}/fft")
async def get_fft(segment_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(SegmentMetric).where(
            SegmentMetric.segment_id == segment_id,
            SegmentMetric.module == "fft",
        )
    )
    out = {}
    for r in result.scalars().all():
        out[r.metric_name] = r.value_json if r.value_json is not None else r.value_float
    return out


@router.get("/results/{segment_id}/bode")
async def get_bode(segment_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(SegmentMetric).where(
            SegmentMetric.segment_id == segment_id,
            SegmentMetric.module == "bode",
        )
    )
    out = {}
    for r in result.scalars().all():
        out[r.metric_name] = r.value_json if r.value_json is not None else r.value_float
    return out


@router.post("/compare")
async def compare_segments(segment_ids: list[str], db: AsyncSession = Depends(get_db)):
    comparison = {}
    for sid in segment_ids:
        result = await db.execute(
            select(SegmentMetric).where(
                SegmentMetric.segment_id == sid,
                SegmentMetric.value_float.isnot(None),
            )
        )
        rows = result.scalars().all()
        comparison[sid] = {f"{r.module}_{r.metric_name}": r.value_float for r in rows}
    return comparison
