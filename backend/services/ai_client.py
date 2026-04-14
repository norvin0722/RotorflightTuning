"""
services/ai_client.py

Builds structured prompts from segment analysis context and calls the
Anthropic API. Returns both a narrative explanation and structured
tuning suggestions.

Prompt templates:
  "default"       — general flight analysis + tuning recommendations
  "oscillation"   — focused on oscillation diagnosis
  "governor"      — focused on headspeed stability
  "filters"       — focused on filter effectiveness
"""

import json
import os
from typing import Any

import httpx

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
DEFAULT_MODEL     = os.getenv("DEFAULT_MODEL", "claude-sonnet-4-20250514")


PROMPT_TEMPLATES = {

"default": """You are an expert Rotorflight helicopter tuning assistant analyzing blackbox flight data.

You have been given computed analysis metrics for a flight segment. Your task is to:
1. Identify any tuning issues visible in the data
2. Provide specific, actionable tuning recommendations
3. Explain what each metric indicates about flight performance

Return your response as a JSON object with this exact structure:
{{
  "narrative": "A clear paragraph explaining the overall flight quality and any issues found",
  "structured_output": {{
    "overall_quality": "excellent|good|acceptable|poor",
    "issues": [
      {{
        "axis": "roll|pitch|yaw|all",
        "category": "oscillation|tracking|latency|governor|filter|pidf_balance",
        "severity": "info|warning|critical",
        "description": "What the issue is",
        "recommendation": "Specific value changes to make"
      }}
    ],
    "pid_adjustments": {{
      "roll":  {{"p": null, "i": null, "d": null, "f": null}},
      "pitch": {{"p": null, "i": null, "d": null, "f": null}},
      "yaw":   {{"p": null, "i": null, "d": null, "f": null}}
    }},
    "filter_adjustments": {{
      "gyro_lpf1_hz": null,
      "dyn_notch_min_hz": null,
      "dyn_notch_max_hz": null
    }},
    "governor_adjustments": {{
      "headspeed_rpm": null,
      "p_gain": null,
      "i_gain": null,
      "f_gain": null
    }}
  }}
}}

Only suggest specific numeric adjustments when the data clearly supports them.
Use null for any adjustment you cannot confidently recommend from the data.
""",

"oscillation": """You are an expert Rotorflight tuning assistant specializing in oscillation diagnosis.

Analyze the provided flight metrics and identify oscillation patterns.
Focus on: P/D oscillation frequencies, I-term wind-up, and filter effectiveness.

Return JSON with structure:
{{
  "narrative": "Oscillation analysis narrative",
  "structured_output": {{
    "oscillation_diagnosis": {{
      "roll":  {{"dominant_hz": null, "severity": null, "likely_cause": null, "fix": null}},
      "pitch": {{"dominant_hz": null, "severity": null, "likely_cause": null, "fix": null}},
      "yaw":   {{"dominant_hz": null, "severity": null, "likely_cause": null, "fix": null}}
    }}
  }}
}}
""",

"governor": """You are an expert Rotorflight governor tuning assistant.

Analyze headspeed stability metrics and provide governor tuning recommendations.

Return JSON with structure:
{{
  "narrative": "Governor analysis narrative",
  "structured_output": {{
    "stability_assessment": "stable|marginal|unstable",
    "mean_deviation_rpm": null,
    "droop_severity": "none|mild|severe",
    "recommendations": {{
      "p_gain_change": null,
      "i_gain_change": null,
      "f_gain_change": null,
      "cyclic_ff_change": null,
      "collective_ff_change": null
    }}
  }}
}}
""",

}


def _build_prompt(
    context: dict[str, Any],
    template: str,
) -> str:
    template_text = PROMPT_TEMPLATES.get(template, PROMPT_TEMPLATES["default"])

    context_block = f"""
## Flight Context
- Craft: {context.get('craft_name', 'Unknown')}
- Firmware: {context.get('firmware', 'Unknown')}
- Segment: {context.get('segment_label', 'Unknown')}
- Duration: {context.get('segment_loops', 'Unknown')} loop iterations

## Active PID Profile
```json
{json.dumps(context.get('pid_profile'), indent=2) if context.get('pid_profile') else 'Not available'}
```

## Computed Analysis Metrics
```json
{json.dumps(context.get('computed_metrics', {}), indent=2)}
```

## Unit Reference
- Gyro / setpoint / error values: deg/s
- PID gains in profile: dimensionless multipliers
- Filter cutoffs: Hz
- Latency: ms
- Headspeed: RPM
- PID term contributions: dimensionless (au)
"""

    return template_text + "\n" + context_block


async def request_ai_analysis(
    context:         dict[str, Any],
    model:           str = DEFAULT_MODEL,
    prompt_template: str = "default",
) -> dict[str, Any]:
    """
    Send analysis context to the Anthropic API and return parsed results.
    """
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise ValueError("ANTHROPIC_API_KEY environment variable not set")

    prompt = _build_prompt(context, prompt_template)

    payload = {
        "model":      model,
        "max_tokens": 2048,
        "messages": [
            {
                "role":    "user",
                "content": prompt,
            }
        ],
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            ANTHROPIC_API_URL,
            headers={
                "x-api-key":         api_key,
                "anthropic-version": "2023-06-01",
                "content-type":      "application/json",
            },
            json=payload,
        )
        response.raise_for_status()

    data = response.json()
    raw_text = data["content"][0]["text"]

    # Parse the JSON response
    try:
        # Strip markdown code fences if present
        clean = raw_text.strip()
        if clean.startswith("```"):
            clean = clean.split("```")[1]
            if clean.startswith("json"):
                clean = clean[4:]
        parsed = json.loads(clean.strip())
        return {
            "narrative":         parsed.get("narrative", raw_text),
            "structured_output": parsed.get("structured_output", {}),
        }
    except (json.JSONDecodeError, KeyError):
        # Fall back to returning raw text as narrative
        return {
            "narrative":         raw_text,
            "structured_output": {},
        }
