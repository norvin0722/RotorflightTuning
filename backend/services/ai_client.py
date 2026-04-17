"""
AI client: sends segment metrics to Anthropic Claude for narrative analysis.
"""
import json
from typing import Tuple
import anthropic
from core.config import settings


async def request_ai_analysis(segment_id: str, metrics: dict) -> Tuple[str, dict]:
    """Call Claude to generate a tuning narrative from scalar metrics."""
    if not settings.anthropic_api_key:
        return "AI analysis requires ANTHROPIC_API_KEY to be set.", {}

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    # Build a concise metrics summary for the prompt
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

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = message.content[0].text.strip()
    # Strip markdown fences if present
    raw = raw.replace("```json", "").replace("```", "").strip()

    try:
        parsed = json.loads(raw)
        narrative = parsed.get("narrative", raw)
        structured = {"recommendations": parsed.get("recommendations", [])}
    except json.JSONDecodeError:
        narrative = raw
        structured = {}

    return narrative, structured
