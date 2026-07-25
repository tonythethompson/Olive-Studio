"""Tool: troubleshoot_olive_error."""

from typing import Any

from . import load_quirks, load_troubleshooting


def _score(entry: dict[str, Any], error_message: str, pass_name: str, config_context: str) -> int:
    text = f"{error_message} {pass_name or ''} {config_context or ''}".lower()
    return sum(1 for p in entry.get("patterns", []) if p.lower() in text)


# Map each troubleshooting entry to the quirk categories most relevant to its root cause.
_ENTRY_QUIRK_CATEGORIES: dict[str, list[str]] = {
    "onnx-export-shape": ["onnx_export"],
    "onnx-export-external-data": ["onnx_export"],
    "quant-accuracy-collapse": ["quantization"],
    "ep-fallback-cpu": ["hardware"],
    "oom-quantization": ["quantization"],
    "calibration-data-mismatch": ["quantization"],
    "lora-target-modules": ["lora"],
    "tensorrt-build-slow": ["quantization", "hardware"],
    "awq-slow-calibration": ["quantization"],
    "qnn-layer-not-supported": ["hardware"],
    "coreml-dynamic-shape": ["onnx_export"],
    "lora-merge-fail": ["lora"],
    "openvino-fallback": ["hardware"],
    "transformer-fusion-missing-dims": ["pass_ordering"],
    "int4-perplexity": ["quantization"],
    "onnx-fp16-nan": ["onnx_export"],
    "calibration-distribution-mismatch": ["quantization"],
    "multi-pass-cache-overwrite": ["pass_ordering"],
    "search-local-optima": ["pass_ordering"],
    "torchscript-export-fail": ["onnx_export"],
}


def _infer_quirk_categories(entry_id: str | None, pass_name: str) -> set[str]:
    """Combine entry-specific and pass-name heuristics to pick relevant quirk categories."""
    categories: set[str] = set()

    if entry_id:
        categories.update(_ENTRY_QUIRK_CATEGORIES.get(entry_id, []))

    p = (pass_name or "").lower()
    if any(k in p for k in ("quant", "awq", "qat", "int4", "int8", "nvfp4")):
        categories.add("quantization")
    if any(k in p for k in ("onnx", "conversion", "export", "coreml", "float16")):
        categories.add("onnx_export")
    if any(k in p for k in ("lora", "peft")):
        categories.add("lora")
    if any(k in p for k in ("tensorrt", "qnn", "openvino", "execution", "provider", "cuda", "rocm")):
        categories.add("hardware")
    if any(k in p for k in ("transform", "optimize", "order", "cache", "search", "fusion")):
        categories.add("pass_ordering")

    if not categories:
        categories = {"quantization", "pass_ordering"}

    return categories


def _build_relevant_quirks(entry_id: str | None, pass_name: str) -> list[str]:
    """Return quirk titles from the most relevant categories, limited to a handful."""
    categories = _infer_quirk_categories(entry_id, pass_name)
    quirks_db = load_quirks()
    titles: list[str] = []
    for category in categories:
        for quirk in quirks_db.get(category, [])[:2]:
            titles.append(quirk["title"])
    return titles[:6]


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
        Root cause, workaround, and updated config snippet.
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

    return {
        "matched_entry": matched_entry,
        "title": best.get("title", ""),
        "root_cause": best.get("root_cause", ""),
        "workaround": best.get("solution", ""),
        "updated_config": best.get("updated_config", {}),
        "relevant_quirks": _build_relevant_quirks(matched_entry, pass_name),
    }
