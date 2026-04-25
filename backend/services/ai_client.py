"""
AI client: sends segment metrics to LM Studio (OpenAI-compatible API) for narrative analysis.
"""
import json
from typing import Tuple
from openai import AsyncOpenAI
from core.config import settings


async def request_ai_analysis(segment_id: str, metrics: dict) -> Tuple[str, dict]:
    """Call the local LM Studio model to generate a tuning narrative from scalar metrics."""
    client = AsyncOpenAI(
        base_url=settings.lm_studio_base_url,
        api_key="lm-studio",  # LM Studio ignores the key but the SDK requires a non-empty value
    )

    metric_lines = []
    for k, v in sorted(metrics.items()):
        if isinstance(v, float):
            metric_lines.append(f"  {k}: {v:.3f}")
        else:
            metric_lines.append(f"  {k}: {v}")
    metrics_text = "\n".join(metric_lines[:80])  # cap at 80 lines

    prompt = f"""You are an expert Rotorflight helicopter tuning assistant.
Analyze the following flight segment metrics and provide:
1. A concise narrative summary (3-5 sentences) of the flight quality and key findings.
2. The top 3 most important tuning recommendations in order of priority.

Segment ID: {segment_id}

Metrics:
{metrics_text}

Respond ONLY with valid JSON in this exact format (no markdown, no preamble):
{{
  "narrative": "...",
  "recommendations": [
    {{"priority": 1, "title": "...", "detail": "...", "action": "..."}},
    {{"priority": 2, "title": "...", "detail": "...", "action": "..."}},
    {{"priority": 3, "title": "...", "detail": "...", "action": "..."}}
  ]
}}"""

    response = await client.chat.completions.create(
        model=settings.lm_studio_model,
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = response.choices[0].message.content.strip()
    # Strip markdown fences (case-insensitive) if present
    raw = raw.replace("```json", "").replace("```JSON", "").replace("```", "").strip()

    try:
        # raw_decode tolerates trailing text after the JSON object
        parsed, _ = json.JSONDecoder().raw_decode(raw)
        narrative = parsed.get("narrative", raw)
        structured = {"recommendations": parsed.get("recommendations", [])}
    except (json.JSONDecodeError, ValueError):
        narrative = raw
        structured = {}

    return narrative, structured


async def ask_followup_question(question: str, narrative: str, structured: dict) -> str:
    """Send a follow-up question with prior analysis as context."""
    client = AsyncOpenAI(
        base_url=settings.lm_studio_base_url,
        api_key="lm-studio",
    )

    recs = structured.get("recommendations", [])
    recs_text = "\n".join(
        f"  {r.get('priority')}. {r.get('title')}: {r.get('detail')} → {r.get('action')}"
        for r in recs
    ) if recs else "  (none)"

    system_msg = (
        "You are an expert Rotorflight helicopter tuning assistant. "
        "Answer the user's follow-up question based on the flight analysis already provided. "
        "Be concise and specific."
    )
    assistant_context = (
        f"I analyzed this flight segment and provided the following results:\n\n"
        f"Narrative: {narrative}\n\n"
        f"Top recommendations:\n{recs_text}"
    )

    response = await client.chat.completions.create(
        model=settings.lm_studio_model,
        max_tokens=512,
        messages=[
            {"role": "system",    "content": system_msg},
            {"role": "assistant", "content": assistant_context},
            {"role": "user",      "content": question},
        ],
    )

    return response.choices[0].message.content.strip()
