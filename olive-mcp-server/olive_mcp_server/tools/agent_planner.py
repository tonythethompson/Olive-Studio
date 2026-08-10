"""Intent-to-UIState planning tool for agent-driven optimization."""

from __future__ import annotations

from typing import Any

from .studio_loopback import studio_request


def _invalid(message: str) -> dict[str, str]:
    return {"error": "invalid_input", "message": message}


def plan_optimization(
    intent: str, model_id: str | None = None, hardware_probe: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Translate a natural-language optimization request into a UIState patch."""
    if not isinstance(intent, str) or not intent.strip() or len(intent) > 2000:
        return _invalid("intent must be a non-empty string of at most 2000 characters")
    if model_id is not None and (not isinstance(model_id, str) or len(model_id) > 200):
        return _invalid("model_id must be at most 200 characters")

    text = intent.lower()
    patch: dict[str, Any] = {}
    recognized = False

    provider = None
    if hardware_probe and hardware_probe.get("ihvProvider"):
        provider = str(hardware_probe["ihvProvider"]).lower()
    elif any(word in text for word in ("nvidia", "cuda", "tensorrt")):
        provider = "nvidia"
    elif any(word in text for word in ("intel", "openvino")):
        provider = "intel"
    elif any(word in text for word in ("amd", "rocm")):
        provider = "amd"
    if provider:
        recognized = True
        patch["ihvProvider"] = {"nvidia": "CUDAExecutionProvider", "intel": "OpenVINOExecutionProvider", "amd": "ROCMExecutionProvider"}.get(provider, provider)

    precision = next((p for p in ("int4", "int8", "fp16", "fp32") if p in text), None)
    if precision or any(word in text for word in ("quantiz", "quantis")):
        recognized = True
        passes = patch.setdefault("passes", {})
        passes["quantization"] = True
        if precision:
            passes["quantPrecision"] = precision

    if any(word in text for word in ("llama", "bert", "resnet", "cnn", "model", "optimize", "quantiz")):
        recognized = True
    if not recognized:
        return {"error": "unparseable_intent", "message": "Could not identify an optimization intent"}

    if hardware_probe:
        for key in ("cudaVersion", "hfModelId", "modelSource"):
            if key in hardware_probe:
                patch[key] = hardware_probe[key]
    if model_id:
        patch["hfModelId"] = model_id
        patch["modelSource"] = "huggingface"

    validation = studio_request("POST", "/api/mcp/studio-recipe", body={"uiState": patch})
    validated = not bool(validation.get("error"))
    result: dict[str, Any] = {
        "ui_state_patch": patch,
        "reasoning": "Parsed the requested hardware and optimization settings from the intent.",
        "alternatives": [],
        "validated": validated,
        "side_effect": False,
    }
    if not validated:
        result["validation_note"] = "Studio validation unavailable; returning an unvalidated plan."
    return result
