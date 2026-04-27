"""
AI client: sends segment metrics to LM Studio (OpenAI-compatible API) for narrative analysis.
"""
import json
import re
from typing import Tuple
from openai import AsyncOpenAI
from core.config import settings


def _clean_ai_result(narrative: str, structured: dict) -> Tuple[str, dict]:
    """Extract clean narrative/recommendations from a raw model response.

    Handles complete JSON, JSON with trailing text, and truncated JSON
    (model output cut off mid-string by a token limit).
    """
    text = (narrative or "").strip()
    recs = (structured or {}).get("recommendations") or []

    if text.startswith("{"):
        # First try: full valid JSON (possibly with trailing prose)
        try:
            parsed, _ = json.JSONDecoder().raw_decode(text)
            if parsed.get("narrative"):
                text = parsed["narrative"]
            if not recs and parsed.get("recommendations"):
                recs = parsed["recommendations"]
            return text, {"recommendations": recs}
        except (json.JSONDecodeError, ValueError):
            pass

        # Second try: truncated JSON — extract narrative value via regex.
        # Matches the string content after "narrative": " even without a
        # closing quote (model output cut off mid-sentence).
        m = re.search(r'"narrative"\s*:\s*"((?:[^"\\]|\\.)*)', text)
        if m:
            text = m.group(1).strip()

    return text, {"recommendations": recs}


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
    metrics_text = "\n".join(metric_lines[:30])  # cap at 30 lines to stay within context window

    prompt = (
        f"Rotorflight tuning expert. Analyze these flight metrics.\n"
        f"Reply with ONLY valid JSON, no markdown, no LaTeX:\n"
        f'{{"narrative":"2-3 sentence plain-text summary",'
        f'"recommendations":[{{"priority":1,"title":"...","detail":"...","action":"..."}},'
        f'{{"priority":2,"title":"...","detail":"...","action":"..."}},'
        f'{{"priority":3,"title":"...","detail":"...","action":"..."}}]}}\n\n'
        f"Metrics:\n{metrics_text}"
    )

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
        narrative = parsed.get("narrative") or raw  # fall back to raw if null/empty
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

    # Clean up any raw-JSON narrative before using it as context
    clean_narrative, clean_structured = _clean_ai_result(narrative, structured)

    recs = clean_structured.get("recommendations", [])
    recs_text = "\n".join(
        f"  {r.get('priority')}. {r.get('title')}: {r.get('detail')} → {r.get('action')}"
        for r in recs
    ) if recs else "  (none)"

    # Single user message works more reliably across models than system/assistant roles
    prompt = (
        "You are an expert Rotorflight helicopter tuning assistant.\n\n"
        "A flight segment was already analyzed with the following results:\n\n"
        f"Narrative: {clean_narrative}\n\n"
        f"Top recommendations:\n{recs_text}\n\n"
        f"The pilot now asks: {question}\n\n"
        "Provide a concise, specific answer based on the analysis above. "
        "Write all values in plain text (e.g. '88 degrees' not '$88^\\circ$', '5 Hz' not '$5\\text{ Hz}$'). "
        "Do not use LaTeX or special math notation. You may use **bold** and numbered lists."
    )

    response = await client.chat.completions.create(
        model=settings.lm_studio_model,
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )

    return response.choices[0].message.content.strip()
