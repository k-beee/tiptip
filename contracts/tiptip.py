# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
import json
import typing

def _coerce_bool(value: typing.Any) -> bool:
    """Normalize whatever the model emits for `verified` into a real bool."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in ("true", "yes", "y", "1", "approve", "approved", "pass", "verified", "verify")
    return False

def _coerce_score(value: typing.Any) -> int:
    """Normalize `quality_score` into an int clamped to 1..10."""
    try:
        score = int(round(float(value)))
    except (TypeError, ValueError):
        score = 0
    if score < 1:
        score = 1
    if score > 10:
        score = 10
    return score

def _parse_verdict(raw: str) -> dict:
    """Sanitize and normalize raw LLM output into a canonical verdict dictionary.
    
    This ensures that validators compare structured, sanitized data rather than 
    raw text that might contain minor formatting differences (e.g. JSON markdown tags).
    """
    text = (raw or "").strip()

    # Strip a ```json ... ``` (or plain ``` ... ```) markdown fence if present.
    if "```" in text:
        start = text.find("```") + 3
        rest = text[start:]
        end = rest.find("```")
        if end != -1:
            rest = rest[:end]
        newline = rest.find("\n")
        if newline != -1 and rest[:newline].strip().isalpha():
            rest = rest[newline + 1:]
        text = rest.strip()

    # Keep only the outermost JSON object, dropping any surrounding prose.
    lo = text.find("{")
    hi = text.rfind("}")
    if lo != -1 and hi != -1 and hi > lo:
        text = text[lo:hi + 1]

    try:
        data = json.loads(text)
    except (ValueError, TypeError):
        data = {}
    if not isinstance(data, dict):
        data = {}

    return {
        "verified": _coerce_bool(data.get("verified", data.get("approved", False))),
        "quality_score": _coerce_score(data.get("quality_score", 0)),
        "reasoning": str(data.get("reasoning", "")).strip()[:500],
    }


class TipTip(gl.Contract):
    tip_count: i32
    tips: TreeMap[str, str] # Maps tip_id (str) -> JSON serialized tip details

    def __init__(self):
        """Initialize the contract state with a zero tip counter."""
        self.tip_count = i32(0)
