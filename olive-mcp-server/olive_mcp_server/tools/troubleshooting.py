"""Tool: troubleshoot_olive_error.

Diagnoses Olive runtime and Olive Studio errors using domain-tagged KB
entries. Tracks error frequency with a module-level store.
"""

from __future__ import annotations

import threading
import time
from typing import Any, Literal

from . import load_quirks, load_studio_troubleshooting, load_troubleshooting

DomainName = Literal["auto", "olive", "studio"]

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
    """Derive a stable key for frequency tracking."""
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


def _score(entry: dict[str, Any], error_message: str, pass_name: str, config_context: str) -> int:
    """Calculate how many configured entry patterns appear in the error context.
    
    Parameters:
    	entry (dict[str, Any]): Knowledge-base entry containing optional matching patterns.
    	error_message (str): Error message to search.
    	pass_name (str): Pass name to search.
    	config_context (str): Configuration context to search.
    
    Returns:
    	int: Number of configured patterns found in the combined error context.
    """
    text = f"{error_message} {pass_name or ''} {config_context or ''}".lower()
    return sum(1 for p in entry.get("patterns", []) if p.lower() in text)


MAX_RELEVANT_QUIRKS = 20

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
    # New olive-domain entries
    "olive-module-not-found": ["pass_ordering"],
    "olive-ort-cuda-ep-missing": ["hardware"],
    "olive-hf-auth-401": ["pass_ordering"],
    "olive-model-path-missing": ["pass_ordering"],
    "olive-disk-full": ["onnx_export"],
    "olive-cudnn-cuda-mismatch": ["hardware"],
    "olive-safetensors-missing": ["pass_ordering"],
    "olive-bitsandbytes-cuda": ["lora", "hardware"],
    "olive-triton-missing": ["quantization", "hardware"],
    "olive-ssl-huggingface": ["pass_ordering"],
    "olive-pass-config-validation": ["pass_ordering"],
    "olive-accelerator-device-busy": ["hardware", "quantization"],
    # Studio-domain entries
    "studio-pytorch-hf-config": ["studio", "onnx_export"],
    "studio-apply-fix-empty": ["studio"],
    "studio-venv-mcp-pin": ["studio"],
    "studio-ai-provider-inactive": ["studio"],
    "studio-diagnose-wiring": ["studio"],
    "studio-tensorrt-pip-invalid-requirement": ["studio", "hardware"],
    "studio-recipe-not-parsed": ["studio"],
    "studio-unique-cache-dir": ["studio", "pass_ordering"],
}

_QUIRK_CATEGORY_ORDER: tuple[str, ...] = (
    "pass_ordering",
    "quantization",
    "onnx_export",
    "lora",
    "hardware",
    "studio",
)


def _infer_quirk_categories(entry_id: str | None, pass_name: str, domain: str | None) -> set[str]:
    """
    Infer relevant quirk categories from the matched entry, domain, and pass name.
    
    Parameters:
        entry_id (str | None): Identifier of the matched knowledge-base entry.
        pass_name (str): Name of the processing pass associated with the error.
        domain (str | None): Troubleshooting domain used to select domain-specific categories.
    
    Returns:
        set[str]: Inferred quirk categories, including applicable default categories when no specific categories match.
    """
    categories: set[str] = set()

    if entry_id:
        categories.update(_ENTRY_QUIRK_CATEGORIES.get(entry_id, []))

    if domain == "studio":
        categories.add("studio")

    p = (pass_name or "").lower()
    if any(k in p for k in ("quant", "awq", "qat", "int4", "int8", "nvfp4", "hqq", "gptq")):
        categories.add("quantization")
        categories.add("pass_ordering")
    if any(k in p for k in ("onnx", "conversion", "export", "coreml", "float16", "fp16")):
        categories.add("onnx_export")
    if any(k in p for k in ("lora", "peft", "qlora")):
        categories.add("lora")
    if any(k in p for k in ("tensorrt", "qnn", "openvino", "execution", "provider", "cuda", "rocm")):
        categories.add("hardware")
    if any(k in p for k in ("transform", "optimize", "order", "cache", "search", "fusion", "split")):
        categories.add("pass_ordering")
    if any(k in p for k in ("studio", "venv", "diagnose", "apply", "sidebar", "recipe builder")):
        categories.add("studio")

    if not categories:
        categories = {"pass_ordering", "quantization", "studio"} if domain == "studio" else {"pass_ordering", "quantization"}

    return categories


def _build_relevant_quirks(
    entry_id: str | None,
    pass_name: str,
    domain: str | None = None,
) -> list[str]:
    """
    Builds a deduplicated list of relevant quirk titles for an error context.
    
    Parameters:
    	entry_id (str | None): Knowledge-base entry identifier associated with the error.
    	pass_name (str): Name of the processing pass associated with the error.
    	domain (str | None): Troubleshooting domain used to infer relevant quirk categories.
    
    Returns:
    	list[str]: Relevant quirk titles, limited to the configured maximum.
    """
    categories = _infer_quirk_categories(entry_id, pass_name, domain)
    quirks_db = load_quirks()
    titles: list[str] = []
    seen: set[str] = set()

    ordered_cats = [c for c in _QUIRK_CATEGORY_ORDER if c in categories]
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


def _pool_for_domain(domain: DomainName) -> list[dict[str, Any]]:
    """Load troubleshooting entries for the requested domain only (auto loads both, Olive first)."""
    if domain == "olive":
        return load_troubleshooting()
    if domain == "studio":
        return load_studio_troubleshooting()
    # auto: olive first for stable olive-first scoring when ties break by search order
    return load_troubleshooting() + load_studio_troubleshooting()


def _best_match(
    entries: list[dict[str, Any]],
    error_message: str,
    pass_name: str,
    config_context: str,
) -> tuple[dict[str, Any] | None, int]:
    """Selects the highest-scoring troubleshooting entry for the provided error context.
    
    Parameters:
    	entries (list[dict[str, Any]]): Candidate troubleshooting entries.
    	error_message (str): Error message to match.
    	pass_name (str): Pass associated with the error.
    	config_context (str): Configuration context associated with the error.
    
    Returns:
    	tuple[dict[str, Any] | None, int]: The best matching entry and its score, or `(None, 0)` when no entry matches.
    """
    if not entries:
        return None, 0
    scored = [(entry, _score(entry, error_message, pass_name, config_context)) for entry in entries]
    scored.sort(key=lambda x: x[1], reverse=True)
    best_entry, best_score = scored[0]
    if best_score <= 0:
        return None, 0
    return best_entry, best_score


def _resolve_domain(domain: str | None) -> DomainName:
    """Resolve a requested troubleshooting domain to a supported domain.
    
    Parameters:
    	domain (str | None): The requested domain name.
    
    Returns:
    	DomainName: The requested domain when supported; otherwise, ``"auto"``.
    """
    if domain in ("olive", "studio", "auto"):
        return domain  # type: ignore[return-value]
    return "auto"


def _no_match_payload() -> dict[str, Any]:
    """Provide generic troubleshooting guidance when no knowledge-base entry matches."""
    return {
        "matched_entry": None,
        "domain": None,
        "applyable": False,
        "title": "No exact match found",
        "root_cause": "The error does not match a known entry in the Olive or Olive Studio knowledge base.",
        "solution": (
            "Check official Olive docs and GitHub issues; reduce to a minimal repro and verify "
            "input model, pass order, and data config. For Olive Studio UI/builder issues, confirm "
            "recipe rebuild, provider settings, and MCP install (mcp<2)."
        ),
        "updated_config": {},
    }


def troubleshoot_olive_error(
    error_message: str,
    pass_name: str = "",
    config_context: str = "",
    domain: str = "auto",
) -> dict[str, Any]:
    """
    Diagnose an Olive or Olive Studio error using the selected knowledge base.
    
    Args:
        error_message: Error message or traceback snippet to diagnose.
        pass_name: Name of the pass where the error occurred, if known.
        config_context: Additional configuration context used for matching.
        domain: Knowledge-base domain to search: ``"auto"``, ``"olive"``, or
            ``"studio"``. Invalid values default to ``"auto"``.
    
    Returns:
        A diagnosis containing the matched entry, domain, title, root cause,
        workaround, updated configuration, applicability, related entry,
        relevant quirks, and occurrence frequency metadata. If no entry matches,
        the response contains generic guidance and is marked non-applicable.
    """
    resolved = _resolve_domain(domain)

    best: dict[str, Any] | None = None
    matched_domain: str | None = None

    if resolved == "auto":
        olive_best, olive_score = _best_match(
            load_troubleshooting(), error_message, pass_name, config_context
        )
        studio_best, studio_score = _best_match(
            load_studio_troubleshooting(), error_message, pass_name, config_context
        )
        # Score both pools; Olive wins ties so generic Olive guidance stays stable.
        if studio_score > olive_score and studio_best is not None and studio_score > 0:
            best = studio_best
            matched_domain = "studio"
        elif olive_best is not None and olive_score > 0:
            best = olive_best
            matched_domain = "olive"
        elif studio_best is not None and studio_score > 0:
            best = studio_best
            matched_domain = "studio"
    else:
        pool = _pool_for_domain(resolved)
        hit, score = _best_match(pool, error_message, pass_name, config_context)
        if hit is not None and score > 0:
            best = hit
            matched_domain = str(hit.get("domain") or resolved)

    if best is None:
        best = _no_match_payload()
        matched_entry = None
        matched_domain = None
        applyable = False
    else:
        matched_entry = best.get("id")
        matched_domain = matched_domain or best.get("domain") or "olive"
        applyable = bool(best.get("applyable"))

    freq_key = _get_frequency_key(matched_entry, error_message)
    freq = _record_occurrence(freq_key)

    # Keep updated_config for display even when applyable is false (UI Apply stays gated by applyable).
    updated_config = best.get("updated_config", {}) or {}

    return {
        "matched_entry": matched_entry,
        "domain": matched_domain,
        "applyable": applyable if matched_entry else False,
        "title": best.get("title", ""),
        "root_cause": best.get("root_cause", ""),
        "workaround": best.get("solution", ""),
        "updated_config": updated_config if isinstance(updated_config, dict) else {},
        "relevant_quirks": _build_relevant_quirks(matched_entry, pass_name, matched_domain),
        "related_olive_entry": best.get("related_olive_entry"),
        "frequency": {
            "occurrence_count": freq["occurrence_count"],
            "first_seen": _format_ts(freq["first_seen"]),
            "last_seen": _format_ts(freq["last_seen"]),
            "label": _frequency_label(freq["occurrence_count"]),
        },
    }


def diagnose_error(
    error_message: str,
    pass_name: str = "",
    config_context: str = "",
    domain: str = "auto",
) -> dict[str, Any]:
    """
    Diagnose an Olive or Olive Studio error using the configured knowledge base.
    
    Parameters:
    	error_message (str): The error message to diagnose
    	pass_name (str): The processing pass associated with the error
    	config_context (str): Configuration context relevant to the error
    	domain (str): The domain to search: "auto", "olive", or "studio"
    
    Returns:
    	dict[str, Any]: Diagnosis details, including the root cause, workaround, applicability, relevant quirks, and frequency metadata
    """
    return troubleshoot_olive_error(
        error_message=error_message,
        pass_name=pass_name,
        config_context=config_context,
        domain=domain,
    )


def reset_frequency_store() -> None:
    """Clear the in-memory frequency store (useful for tests)."""
    with _lock:
        _frequency_store.clear()


def get_error_frequency_summary(limit: int = 10) -> dict[str, Any]:
    """
    Summarize tracked errors by occurrence frequency.
    
    Parameters:
        limit (int): Maximum number of error entries to include. Must be greater than or equal to zero.
    
    Returns:
        dict[str, Any]: A summary containing the total tracked count, requested limit, and error entries with occurrence counts, timestamps, frequency labels, and identifiers.
    
    Raises:
        ValueError: If `limit` is negative.
    """
    if limit < 0:
        raise ValueError("limit must be non-negative")

    with _lock:
        items: list[tuple[str, dict[str, Any]]] = [
            (key, dict(data)) for key, data in _frequency_store.items()
        ]

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
