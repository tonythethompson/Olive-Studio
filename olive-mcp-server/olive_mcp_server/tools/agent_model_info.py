"""Tool: get_model_info — HuggingFace model metadata lookup with heuristic fallback.

Provides parameter count, architecture, model type, VRAM estimate, and
recommended quantization for a given HuggingFace model ID.  Falls back to
regex heuristics (ported from src/lib/vramEstimate.ts) when the HF API is
unreachable.

No module-level network I/O or heavy imports — only stdlib + project internals.
"""

from __future__ import annotations

import json
import re
import urllib.request
import urllib.error
from typing import Any

from .studio_loopback import err
from .strategy_advisor import _normalize_model_type

# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------

# HuggingFace repo IDs follow the pattern: owner/model-name
# Allow alphanumeric, hyphens, underscores, dots, and exactly one slash.
# Reject path traversal (..), query strings (?), fragments (#), control chars,
# and whitespace.
_VALID_MODEL_ID_RE = re.compile(
    r"^[A-Za-z0-9][\w.\-]*/[\w.\-]+$"
)


def _is_valid_model_id(model_id: str) -> bool:
    """Return True if model_id matches HuggingFace repo-id grammar."""
    if ".." in model_id:
        return False
    if any(c in model_id for c in "?#\n\r\t\x00"):
        return False
    return _VALID_MODEL_ID_RE.match(model_id) is not None


# ---------------------------------------------------------------------------
# Heuristic: inferParamBillions (port from src/lib/vramEstimate.ts)
# ---------------------------------------------------------------------------

_WHISPER_PARAMS_B: dict[str, float] = {
    "tiny": 0.039,
    "base": 0.074,
    "small": 0.244,
    "medium": 0.769,
    "large": 1.55,
    "large-v3": 1.55,
}

# Regex: match explicit size tokens like "7B", "1.5B", "70B", etc.
# Ported from TS: /(?:^|[/\-_\s])(\d+(?:\.\d+)?)\s*b(?:illion)?(?=[^a-z]|$)/gi
_SIZE_TOKEN_RE = re.compile(
    r"(?:^|[/\-_\s])(\d+(?:\.\d+)?)\s*b(?:illion)?(?=[^a-z]|$)",
    re.IGNORECASE,
)


def _infer_param_billions(identifier: str) -> tuple[float, str]:
    """Infer parameter count (billions) from a model identifier string.

    Returns:
        (params_b, confidence) where confidence is "medium" or "low".
    """
    model_id = identifier.lower()

    # 1. Prefer explicit size tokens (e.g. "7B", "1.5B")
    all_matches = _SIZE_TOKEN_RE.findall(model_id)
    if all_matches:
        sizes = []
        for m in all_matches:
            try:
                val = float(m)
                if 0 < val < 1000:
                    sizes.append(val)
            except (ValueError, TypeError):
                continue
        if sizes:
            return (min(sizes), "medium")

    # 2. Whisper model sizes
    for key, params in _WHISPER_PARAMS_B.items():
        if f"whisper-{key}" in model_id or f"whisper_{key}" in model_id:
            return (params, "medium")
    if "whisper" in model_id:
        return (0.244, "low")

    # 3. Known distill / small models
    if "deepseek" in model_id and "distill" in model_id and "1.5" in model_id:
        return (1.5, "medium")

    # 4. Family defaults
    if "phi-3.5" in model_id or "phi3.5" in model_id:
        return (3.8, "low")
    if "phi-3" in model_id or "phi3" in model_id:
        return (3.8, "low")
    if "phi-2" in model_id:
        return (2.7, "low")
    if "llama-3.2" in model_id or "llama3.2" in model_id:
        return (1.0, "low")
    if "llama-3" in model_id or "llama3" in model_id:
        return (8.0, "low")
    if "llama-2" in model_id or "llama2" in model_id:
        return (7.0, "low")
    if "mistral" in model_id or "mixtral" in model_id:
        return (7.0, "low")
    if "qwen2.5" in model_id or "qwen2" in model_id:
        return (7.0, "medium")
    if "qwen" in model_id:
        return (7.0, "low")
    if "sdxl" in model_id or "stable-diffusion-xl" in model_id:
        return (2.6, "low")
    if "stable-diffusion" in model_id or "sd15" in model_id:
        return (0.9, "low")
    if "bert-base" in model_id:
        return (0.11, "medium")
    if "resnet" in model_id:
        return (0.025, "low")
    if "mobilenet" in model_id:
        return (0.004, "low")

    # 5. Ultimate fallback
    return (7.0, "low")


# ---------------------------------------------------------------------------
# HuggingFace API helpers
# ---------------------------------------------------------------------------

_HF_API_BASE = "https://huggingface.co/api/models"
_HF_TIMEOUT_SECONDS = 3


def _fetch_hf_metadata(model_id: str) -> dict[str, Any] | None:
    """Fetch model metadata from the HuggingFace API.

    Returns parsed JSON dict on success, None on any failure.
    """
    url = f"{_HF_API_BASE}/{model_id}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=_HF_TIMEOUT_SECONDS) as resp:  # noqa: S310
            raw = resp.read()
            result = json.loads(raw)
            # Only accept dict responses; arrays/scalars are unexpected
            if not isinstance(result, dict):
                return None
            return result
    except Exception:  # noqa: BLE001 — any failure triggers heuristic fallback
        return None


def _extract_params_from_hf(data: dict[str, Any]) -> float | None:
    """Extract parameter count (in billions) from HF API response.

    Checks safetensors.total first, then config.num_parameters.
    """
    # safetensors.total (parameter count as integer)
    safetensors = data.get("safetensors")
    if isinstance(safetensors, dict):
        total = safetensors.get("total")
        if isinstance(total, (int, float)) and total > 0:
            return total / 1e9

    # config.num_parameters
    config = data.get("config")
    if isinstance(config, dict):
        num_params = config.get("num_parameters")
        if isinstance(num_params, (int, float)) and num_params > 0:
            return num_params / 1e9

    return None


def _extract_architecture(data: dict[str, Any]) -> str:
    """Extract architecture name from HF API response."""
    config = data.get("config")
    if isinstance(config, dict):
        archs = config.get("architectures")
        if isinstance(archs, list) and len(archs) > 0 and isinstance(archs[0], str):
            return archs[0]
    return "unknown"


# ---------------------------------------------------------------------------
# Main tool function
# ---------------------------------------------------------------------------

def get_model_info(model_id: str) -> dict[str, Any]:
    """Look up model metadata by HuggingFace ID.

    Returns parameter count, architecture, model type classification,
    VRAM estimate, and recommended quantization method.

    Parameters:
        model_id: HuggingFace model identifier (e.g. "meta-llama/Llama-3-8B").

    Returns:
        Structured result dict or error dict.
    """
    try:
        # --- Input validation ---
        if not isinstance(model_id, str) or len(model_id) < 1 or len(model_id) > 256:
            return err(
                "invalid_model_id",
                "model_id must be a string of 1 to 256 characters.",
            )

        if not _is_valid_model_id(model_id):
            return err(
                "invalid_model_id",
                "model_id must be a valid HuggingFace repo ID (owner/name), "
                "without path traversal, query strings, or control characters.",
            )

        # --- Attempt HF API ---
        hf_data = _fetch_hf_metadata(model_id)

        params_b: float
        architecture: str
        source: str
        confidence: str

        if hf_data is not None:
            extracted_params = _extract_params_from_hf(hf_data)
            if extracted_params is not None:
                params_b = extracted_params
                architecture = _extract_architecture(hf_data)
                source = "huggingface_api"
                confidence = "high"
            else:
                # HF returned data but no extractable param count — fall back
                architecture = _extract_architecture(hf_data)
                params_b, confidence = _infer_param_billions(model_id)
                source = "heuristic"
        else:
            # HF API failed entirely — full heuristic fallback
            params_b, confidence = _infer_param_billions(model_id)
            architecture = "unknown"
            source = "heuristic"

        # --- Compute derived fields ---
        estimated_vram_gb = params_b * 2.0
        model_type = _normalize_model_type(model_id)
        recommended_quant = "int4" if params_b >= 6.0 else "int8"

        return {
            "params_b": params_b,
            "architecture": architecture,
            "model_type": model_type,
            "estimated_vram_gb": estimated_vram_gb,
            "recommended_quant": recommended_quant,
            "source": source,
            "confidence": confidence,
            "side_effect": False,
        }

    except Exception as exc:
        return {"error": "internal_error", "message": f"{type(exc).__name__}: {exc}"}
