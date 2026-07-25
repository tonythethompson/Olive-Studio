"""Tool: troubleshoot_olive_error.

Tracks error frequency patterns using a module-level frequency tracker
inspired by the UI's import error timer pattern. Each call records the
error's matched entry ID (or a normalised prefix of the error message for
unmatched errors), increments its occurrence count, and timestamps the event.
The response includes frequency metadata so callers can distinguish
transient errors from persistent/recurring issues.
"""

import threading
import time
from typing import Any

from . import load_quirks, load_troubleshooting

# ---------------------------------------------------------------------------
# Frequency label thresholds (tuneable constants)
# ---------------------------------------------------------------------------
RECURRING_MAX = 3
FREQUENT_MAX = 10

# ---------------------------------------------------------------------------
# Error frequency tracker (module-level, lives for the process lifetime)
# ---------------------------------------------------------------------------
_lock = threading.Lock()
_frequency_store: dict[str, dict[str, Any]] = {}


def _get_frequency_key(matched_entry: str | None, error_message: str) -> str:
    """Derive a stable key for frequency tracking.

    Matched entries use the entry ID.  Unmatched errors use a normalised
    prefix of the lower-cased error message (first 80 chars) so that minor
    trailing differences don't fragment tracking.
    """
    if matched_entry:
        return f"entry:{matched_entry}"
    prefix = error_message[:80].lower().strip()
    return f"msg:{prefix}"


def _record_occurrence(key: str) -> dict[str, Any]:
    """Record one occurrence and return the updated frequency metadata."""
    now = time.time()
    with _lock:
        entry = _frequency_store.get(key)
        if entry is None:
            entry = {
                "occurrence_count": 1,
                "first_seen": now,
                "last_seen": now,
            }
            _frequency_store[key] = entry
        else:
            entry["occurrence_count"] += 1
            entry["last_seen"] = now
        # Return a shallow copy so callers don't mutate the store
        return dict(entry)


def _frequency_label(count: int) -> str:
    """Human-readable frequency label."""
    if count == 1:
        return "first_occurrence"
    if count <= RECURRING_MAX:
        return "recurring"
    if count <= FREQUENT_MAX:
        return "frequent"
    return "persistent"


def _format_ts(ts: float) -> str:
    """Format an epoch timestamp as an ISO-8601 string."""
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))


# ---------------------------------------------------------------------------
# Core scoring logic (unchanged)
# ---------------------------------------------------------------------------

def _score(entry: dict[str, Any], error_message: str, pass_name: str, config_context: str) -> int:
    text = f"{error_message} {pass_name or ''} {config_context or ''}".lower()
    return sum(1 for p in entry.get("patterns", []) if p.lower() in text)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def troubleshoot_olive_error(
    error_message: str,
    pass_name: str = "",
    config_context: str = "",
) -> dict[str, Any]:
    """Diagnose a common Olive implementation error.

    Args:
        error_message: The error message or traceback snippet.
        pass_name: Pass where the error occurred, if known.
        config_context: Additional configuration context.

    Returns:
        Root cause, workaround, updated config snippet, and frequency metadata.
    """
    entries = load_troubleshooting()

    scored = [(entry, _score(entry, error_message, pass_name, config_context)) for entry in entries]
    scored.sort(key=lambda x: x[1], reverse=True)

    matched_entry = None
    if scored and scored[0][1] > 0:
        best = scored[0][0]
        matched_entry = best.get("id")
    else:
        best = {
            "title": "No exact match found",
            "root_cause": "The error does not match a known entry in the local knowledge base.",
            "solution": "Check official Olive docs and GitHub issues; reduce to a minimal repro and verify input model, pass order, and data config.",
            "updated_config": {},
        }

    # --- frequency tracking (import-error-timer pattern) ---
    freq_key = _get_frequency_key(matched_entry, error_message)
    freq = _record_occurrence(freq_key)

    return {
        "matched_entry": matched_entry,
        "title": best.get("title", ""),
        "root_cause": best.get("root_cause", ""),
        "workaround": best.get("solution", ""),
        "updated_config": best.get("updated_config", {}),
        "relevant_quirks": [q["title"] for q in load_quirks().get("quantization", [])[:2]],
        # --- new frequency fields ---
        "frequency": {
            "occurrence_count": freq["occurrence_count"],
            "first_seen": _format_ts(freq["first_seen"]),
            "last_seen": _format_ts(freq["last_seen"]),
            "label": _frequency_label(freq["occurrence_count"]),
        },
    }


def reset_frequency_store() -> None:
    """Clear the in-memory frequency store (useful for tests)."""
    with _lock:
        _frequency_store.clear()
