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
# Maximum number of quirks to return (generous upper bound to prevent unbounded growth).
# ---------------------------------------------------------------------------
MAX_RELEVANT_QUIRKS = 20

# ---------------------------------------------------------------------------
# Map each troubleshooting entry to the quirk categories most relevant to its root cause.
# Categories list *all* quirks from that bucket (no per-category truncation).
# ---------------------------------------------------------------------------
_ENTRY_QUIRK_CATEGORIES: dict[str, list[str]] = {
    "onnx-export-shape": ["onnx_export", "pass_ordering"],
    "onnx-export-external-data": ["onnx_export"],
    "quant-accuracy-collapse": ["quantization", "pass_ordering"],
    "ep-fallback-cpu": ["hardware"],
    "oom-quantization": ["quantization", "onnx_export"],
    "calibration-data-mismatch": ["quantization"],
    "lora-target-modules": ["lora"],
    "tensorrt-build-slow": ["quantization", "hardware", "onnx_export"],
    "awq-slow-calibration": ["quantization"],
    "qnn-layer-not-supported": ["hardware", "quantization", "pass_ordering"],
    "coreml-dynamic-shape": ["onnx_export"],
    "lora-merge-fail": ["lora", "quantization"],
    "openvino-fallback": ["hardware"],
    "transformer-fusion-missing-dims": ["pass_ordering", "onnx_export"],
    "int4-perplexity": ["quantization", "pass_ordering"],
    "onnx-fp16-nan": ["onnx_export", "pass_ordering"],
    "calibration-distribution-mismatch": ["quantization"],
    "multi-pass-cache-overwrite": ["pass_ordering", "quantization", "onnx_export"],
    "search-local-optima": ["pass_ordering"],
    "torchscript-export-fail": ["onnx_export"],
}

# Stable presentation order (actionable pipeline guidance first).
_QUIRK_CATEGORY_ORDER: tuple[str, ...] = (
    "pass_ordering",
    "quantization",
    "onnx_export",
    "lora",
    "hardware",
)


def _infer_quirk_categories(entry_id: str | None, pass_name: str) -> set[str]:
    """Combine entry-specific and pass-name heuristics to pick relevant quirk categories."""
    categories: set[str] = set()

    if entry_id:
        categories.update(_ENTRY_QUIRK_CATEGORIES.get(entry_id, []))

    p = (pass_name or "").lower()
    if any(k in p for k in ("quant", "awq", "qat", "int4", "int8", "nvfp4", "hqq", "gptq")):
        categories.add("quantization")
        # Quant pipelines almost always need convert/order guidance too.
        categories.add("pass_ordering")
    if any(k in p for k in ("onnx", "conversion", "export", "coreml", "float16", "fp16")):
        categories.add("onnx_export")
    if any(k in p for k in ("lora", "peft", "qlora")):
        categories.add("lora")
    if any(k in p for k in ("tensorrt", "qnn", "openvino", "execution", "provider", "cuda", "rocm")):
        categories.add("hardware")
    if any(k in p for k in ("transform", "optimize", "order", "cache", "search", "fusion", "split")):
        categories.add("pass_ordering")

    if not categories:
        # Unknown errors still get full default guidance sets (not a truncated sample).
        categories = {"pass_ordering", "quantization"}

    return categories


def _build_relevant_quirks(entry_id: str | None, pass_name: str) -> list[str]:
    """Return quirk titles from every inferred relevant category, up to MAX_RELEVANT_QUIRKS.

    Historically this returned only the first 2 quirks per category (max 6),
    which hid actionable guidance such as External Data Format, Graph Optimize
    Before Quantization, Symmetric quantization, and QLoRA + Quantization.

    Now returns all quirks from the inferred categories, enforcing a generous
    upper bound (MAX_RELEVANT_QUIRKS) across the combined result to prevent
    unbounded growth as the quirks database expands.
    """
    categories = _infer_quirk_categories(entry_id, pass_name)
    quirks_db = load_quirks()
    titles: list[str] = []
    seen: set[str] = set()

    ordered_cats = [c for c in _QUIRK_CATEGORY_ORDER if c in categories]
    # Include any unexpected category keys after the known order.
    ordered_cats.extend(sorted(c for c in categories if c not in _QUIRK_CATEGORY_ORDER))

    for category in ordered_cats:
        for quirk in quirks_db.get(category, []):
            if len(titles) >= MAX_RELEVANT_QUIRKS:
                return titles
            title = quirk.get("title") if isinstance(quirk, dict) else None
            if not title or title in seen:
                continue
            seen.add(title)
            titles.append(title)
    return titles

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
        "relevant_quirks": _build_relevant_quirks(matched_entry, pass_name),
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


def get_error_frequency_summary(limit: int = 10) -> dict[str, Any]:
    """Return a summary of the most frequently occurring Olive errors.

    Args:
        limit: Maximum number of entries to return (default 10).

    Returns:
        Object containing the total number of tracked errors and the top entries.

    Raises:
        ValueError: If limit is negative.
    """
    if limit < 0:
        raise ValueError("limit must be non-negative")

    # Snapshot keys and data copies while holding the lock so subsequent
    # _record_occurrence mutations cannot affect this summary.
    with _lock:
        items: list[tuple[str, dict[str, Any]]] = [
            (key, dict(data)) for key, data in _frequency_store.items()
        ]

    # Sort by occurrence count descending, then by last seen descending
    items.sort(key=lambda kv: (kv[1]["occurrence_count"], kv[1]["last_seen"]), reverse=True)

    entries = []
    for key, data in items[:limit]:
        if key.startswith("entry:"):
            matched_entry = key.split(":", 1)[1]
            message_prefix = ""
        else:
            matched_entry = None
            message_prefix = key.split(":", 1)[1]

        entries.append(
            {
                "matched_entry": matched_entry,
                "message_prefix": message_prefix,
                "occurrence_count": data["occurrence_count"],
                "first_seen": _format_ts(data["first_seen"]),
                "last_seen": _format_ts(data["last_seen"]),
                "label": _frequency_label(data["occurrence_count"]),
            }
        )

    return {
        "total_tracked": len(items),
        "limit": limit,
        "entries": entries,
    }
