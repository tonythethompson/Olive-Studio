"""Tool: plan_optimization — NL intent to UIState patch.

Parses a natural-language optimization intent and produces a partial UIState
patch ready to apply to the Olive Studio frontend store. Uses existing
strategy_advisor, hardware_guide, and pass_chain modules internally.

No module-level network calls; no new pip dependencies.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from .strategy_advisor import get_quantization_strategy, _normalize_model_type
from .hardware_guide import get_hardware_optimization_guide
from .studio_loopback import studio_request, err

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Intent parsing keyword sets
# ---------------------------------------------------------------------------

_HARDWARE_KEYWORDS: list[tuple[str, str]] = [
    # (regex pattern, canonical hardware target string for downstream calls)
    (r"\bnvidia\b", "NVIDIA RTX 4090"),
    (r"\brtx\s*\d{4}", "NVIDIA RTX 4090"),
    (r"\bcuda\b", "NVIDIA RTX 4090"),
    (r"\btensorrt\b", "TensorRT"),
    (r"\bopenvino\b", "Intel Core i9 CPU"),
    (r"\bintel\b", "Intel Core i9 CPU"),
    (r"\bqualcomm\b", "Qualcomm Snapdragon NPU"),
    (r"\bqnn\b", "Qualcomm Snapdragon NPU"),
    (r"\bsnapdragon\b", "Qualcomm Snapdragon NPU"),
    (r"\bapple\b", "Apple M2/M3 (CoreML)"),
    (r"\bcoreml\b", "Apple M2/M3 (CoreML)"),
    (r"\bdirectml\b", "Windows DirectML GPU"),
    (r"\brocm\b", "AMD MI300X / ROCm"),
    (r"\bmi\d{3}", "AMD MI300X / ROCm"),
    (r"\bwebgpu\b", "WebGPU (Browser)"),
    (r"\bcpu\b", "Intel Core i9 CPU"),
    (r"\bnpu\b", "Qualcomm Snapdragon NPU"),
]

_MODEL_PATTERNS: list[re.Pattern[str]] = [
    # HuggingFace org/model style
    re.compile(r"\b[a-zA-Z0-9_-]+/[a-zA-Z0-9._-]+\b"),
    # Known model family names
    re.compile(
        r"\b(?:llama|phi|mistral|qwen|falcon|gpt|bert|resnet|mobilenet|"
        r"whisper|vit|yolo|stable[- ]?diffusion|deepseek|mixtral|"
        r"efficientnet|t5|codellama)\b",
        re.IGNORECASE,
    ),
]

_OPTIMIZATION_KEYWORDS = re.compile(
    r"\b(?:quantiz(?:e|ation)|compress|optimi[sz]e|speed|latency|smaller|"
    r"int4|int8|awq|gptq|hqq|prune|pruning|lora|qlora|fp16|float16|"
    r"convert|onnx|reduce|shrink|accelerate|faster)\b",
    re.IGNORECASE,
)

# Provider mapping for UIState ihvProvider field
_HARDWARE_TO_PROVIDER: dict[str, str] = {
    "nvidia": "nvidia",
    "intel": "intel",
    "qualcomm": "qualcomm",
    "apple": "apple",
    "directml": "directml",
    "rocm": "amd",
    "webgpu": "webgpu",
    "cpu": "cpu",
}


# ---------------------------------------------------------------------------
# Intent parsing
# ---------------------------------------------------------------------------


def _parse_intent(intent: str) -> dict[str, Any]:
    """Extract hardware target, model reference, and optimization goal from intent.

    Returns a dict with keys 'hardware_target', 'model_ref', 'optimization_goal'
    — each is either a non-empty string or None.
    """
    lower = intent.lower()
    result: dict[str, Any] = {
        "hardware_target": None,
        "model_ref": None,
        "optimization_goal": None,
    }

    # Hardware target — first match wins (ordered by specificity)
    for pattern, target in _HARDWARE_KEYWORDS:
        if re.search(pattern, lower):
            result["hardware_target"] = target
            break

    # Model reference
    for pat in _MODEL_PATTERNS:
        m = pat.search(intent)
        if m:
            result["model_ref"] = m.group(0)
            break

    # Optimization goal
    m = _OPTIMIZATION_KEYWORDS.search(intent)
    if m:
        result["optimization_goal"] = m.group(0)

    return result


def _infer_provider(hardware_target: str) -> str | None:
    """Map a hardware target string to a canonical ONNX Runtime provider ID."""
    lower = hardware_target.lower()
    if "tensorrt" in lower:
        return "TensorrtExecutionProvider"
    if "nvidia" in lower or "rtx" in lower or "cuda" in lower:
        return "CUDAExecutionProvider"
    if "directml" in lower:
        return "DmlExecutionProvider"
    if "rocm" in lower or "mi300" in lower:
        return "ROCMExecutionProvider"
    if "apple" in lower or "coreml" in lower:
        return "CoreMLExecutionProvider"
    if "qualcomm" in lower or "qnn" in lower or "snapdragon" in lower:
        return "QNNExecutionProvider"
    if "openvino" in lower or "intel" in lower:
        return "OpenVINOExecutionProvider"
    if "webgpu" in lower:
        return "WebGpuExecutionProvider"
    return None


def _normalize_provider(value: Any) -> str | None:
    """Normalize probe provider labels and preserve canonical provider IDs."""
    if not isinstance(value, str):
        return None
    canonical = {
        "nvidia": "CUDAExecutionProvider", "cuda": "CUDAExecutionProvider",
        "tensorrt": "TensorrtExecutionProvider", "directml": "DmlExecutionProvider",
        "amd": "ROCMExecutionProvider", "rocm": "ROCMExecutionProvider",
        "apple": "CoreMLExecutionProvider", "coreml": "CoreMLExecutionProvider",
        "qualcomm": "QNNExecutionProvider", "qnn": "QNNExecutionProvider",
        "intel": "OpenVINOExecutionProvider", "openvino": "OpenVINOExecutionProvider",
        "webgpu": "WebGpuExecutionProvider",
    }
    return canonical.get(value.lower(), value)


def _infer_cuda_version(intent: str) -> str | None:
    """Extract CUDA version from intent if mentioned."""
    m = re.search(r"cuda\s*(\d{2}(?:\.\d)?)", intent, re.IGNORECASE)
    if m:
        return m.group(1)
    return None


def _compose_ui_state_patch(
    strategy: dict[str, Any],
    guide: dict[str, Any] | None,
    model_id: str,
    model_type: str,
    hardware_target: str,
    hardware_probe: dict[str, Any] | None,
    intent: str,
) -> dict[str, Any]:
    """Compose a UIState patch from strategy and guide results."""
    patch: dict[str, Any] = {}

    # Model source + ID
    if model_id:
        patch["hfModelId"] = model_id
        patch["modelSource"] = "huggingface"

    # Provider
    provider = _infer_provider(hardware_target)
    if provider:
        patch["ihvProvider"] = provider

    # CUDA version
    cuda_ver = _infer_cuda_version(intent)
    if cuda_ver:
        patch["cudaVersion"] = cuda_ver

    # OpenVINO device
    if strategy.get("openvino_device"):
        patch["openvinoTargetDevice"] = strategy["openvino_device"]

    # Passes configuration from strategy
    passes: dict[str, Any] = {}
    algo = strategy.get("recommended_algorithm", "")
    algo_lower = algo.lower()

    # Quantization settings
    if "int4" in algo_lower or "int8" in algo_lower:
        passes["quantization"] = True
        if "int4" in algo_lower:
            passes["quantPrecision"] = "int4"
        elif "int8" in algo_lower:
            passes["quantPrecision"] = "int8"

        # Quantization method
        if "awq" in algo_lower:
            passes["quantMethod"] = "awq"
        elif "gptq" in algo_lower:
            passes["quantMethod"] = "gptq"
        elif "hqq" in algo_lower:
            passes["quantMethod"] = "hqq"
        elif "static" in algo_lower:
            passes["quantMethod"] = "static"
        elif "dynamic" in algo_lower:
            passes["quantMethod"] = "dynamic"
        elif "weight" in algo_lower:
            passes["quantMethod"] = "weight_only"

    # FP16
    if "fp16" in algo_lower or "float16" in algo_lower:
        passes["fp16Conversion"] = True

    # Pass chain from strategy
    if strategy.get("pass_chain"):
        passes["passChain"] = strategy["pass_chain"]

    if passes:
        patch["passes"] = passes

    # Hardware probe overrides
    if hardware_probe:
        if "ihvProvider" in hardware_probe:
            normalized_provider = _normalize_provider(hardware_probe["ihvProvider"])
            if normalized_provider:
                patch["ihvProvider"] = normalized_provider
        elif "provider" in hardware_probe:
            normalized_provider = _normalize_provider(hardware_probe["provider"])
            if normalized_provider:
                patch["ihvProvider"] = normalized_provider
        if "cudaVersion" in hardware_probe:
            patch["cudaVersion"] = hardware_probe["cudaVersion"]
        if "openvinoTargetDevice" in hardware_probe:
            patch["openvinoTargetDevice"] = hardware_probe["openvinoTargetDevice"]

    return patch


def _generate_alternatives(
    strategy: dict[str, Any],
    model_type: str,
    hardware_target: str,
) -> list[dict[str, Any]]:
    """Generate 0-3 alternative optimization approaches."""
    alternatives: list[dict[str, Any]] = []
    algo = strategy.get("recommended_algorithm", "").lower()

    # Alternative 1: Different precision
    if "int4" in algo:
        alt_passes: dict[str, Any] = {"quantization": True, "quantPrecision": "int8"}
        if strategy.get("pass_chain"):
            alt_passes["passChain"] = strategy["pass_chain"]
        alternatives.append({
            "description": "INT8 quantization (higher accuracy, larger model)",
            "ui_state_patch": {"passes": alt_passes},
        })
    elif "int8" in algo:
        alt_passes = {"quantization": True, "quantPrecision": "int4"}
        if strategy.get("pass_chain"):
            alt_passes["passChain"] = strategy["pass_chain"]
        alternatives.append({
            "description": "INT4 quantization (smaller model, potentially lower accuracy)",
            "ui_state_patch": {"passes": alt_passes},
        })

    # Alternative 2: FP16 only (if not already the primary)
    if "fp16" not in algo and "float16" not in algo:
        alternatives.append({
            "description": "FP16 conversion only (minimal accuracy loss, ~50% size reduction)",
            "ui_state_patch": {
                "passes": {
                    "fp16Conversion": True,
                    "passChain": ["OnnxConversion", "OnnxFloatToFloat16"],
                },
            },
        })

    # Alternative 3: Different quant method for LLMs
    if model_type == "llm" and "awq" in algo:
        alternatives.append({
            "description": "GPTQ quantization (alternative to AWQ, better for some models)",
            "ui_state_patch": {
                "passes": {
                    "quantization": True,
                    "quantPrecision": "int4",
                    "quantMethod": "gptq",
                    "passChain": ["OnnxConversion", "GptqQuantizer"],
                },
            },
        })
    elif model_type == "llm" and "gptq" in algo:
        alternatives.append({
            "description": "AWQ quantization (alternative to GPTQ, faster inference)",
            "ui_state_patch": {
                "passes": {
                    "quantization": True,
                    "quantPrecision": "int4",
                    "quantMethod": "awq",
                    "passChain": ["OnnxConversion", "NVModelOptQuantization"],
                },
            },
        })

    return alternatives[:3]


def _validate_patch(patch: dict[str, Any]) -> tuple[bool, str | None]:
    """Validate the UIState patch via Studio bridge (best-effort).

    Returns (validated, validation_note). If Studio is unreachable,
    returns (False, note) rather than failing.
    """
    response = studio_request(
        "POST",
        "/api/mcp/tool",
        body={"toolName": "validate_ui_state_recipe", "args": {"ui_state": patch}},
    )
    if isinstance(response, dict) and response.get("error"):
        error_code = response["error"]
        if error_code == "studio_unavailable":
            return False, "Studio bridge unavailable; patch not validated"
        # Other errors (e.g. validation failure) — still mark as not validated
        return False, f"Validation failed: {response.get('message', 'unknown error')}"
    return True, None


# ---------------------------------------------------------------------------
# Main tool function
# ---------------------------------------------------------------------------


def plan_optimization(
    intent: str,
    hardware_probe: dict[str, Any] | None = None,
    model_id: str = "",
) -> dict[str, Any]:
    """Convert a natural-language optimization intent into a UIState patch.

    Args:
        intent: Natural language description of the desired optimization
                (1-2000 characters).
        hardware_probe: Optional hardware context from the agent's environment
                       (overrides inferred provider/CUDA settings).
        model_id: Optional HuggingFace model ID for model-type inference
                 (1-200 characters).

    Returns:
        A dict containing ui_state_patch, reasoning, alternatives, validated,
        and optionally validation_note. Returns error dict on invalid input
        or unparseable intent.
    """
    try:
        # --- Input validation ---
        if not isinstance(intent, str) or len(intent) == 0:
            return err("invalid_input", "Intent must be a non-empty string (1-2000 characters).")
        if len(intent) > 2000:
            return err(
                "invalid_input",
                "Intent exceeds maximum length of 2000 characters.",
                detail=f"length={len(intent)}",
            )
        if model_id and len(model_id) > 200:
            return err(
                "invalid_input",
                "model_id exceeds maximum length of 200 characters.",
                detail=f"length={len(model_id)}",
            )

        # --- Parse intent ---
        parsed = _parse_intent(intent)
        hardware_target = parsed["hardware_target"]
        model_ref = parsed["model_ref"]
        optimization_goal = parsed["optimization_goal"]

        # If none of the three elements found → unparseable
        if not hardware_target and not model_ref and not optimization_goal:
            return err(
                "unparseable_intent",
                "Could not identify a hardware target, model reference, or "
                "optimization goal in the provided intent.",
            )

        # --- Determine model type ---
        model_type = "generic"
        if model_id:
            model_type = _normalize_model_type(model_id)
        elif model_ref:
            model_type = _normalize_model_type(model_ref)

        # --- Default hardware target if not parsed ---
        if not hardware_target:
            hardware_target = "Intel Core i9 CPU"  # safe default

        # --- Call internal strategy functions ---
        strategy = get_quantization_strategy(
            model_type=model_type,
            target_hardware=hardware_target,
        )

        # get_hardware_optimization_guide may return an error dict for unknown profiles
        guide = get_hardware_optimization_guide(target_hardware=hardware_target)
        if isinstance(guide, dict) and guide.get("error"):
            guide = None  # graceful: proceed without guide

        # --- Compose UIState patch ---
        patch = _compose_ui_state_patch(
            strategy=strategy,
            guide=guide,
            model_id=model_id,
            model_type=model_type,
            hardware_target=hardware_target,
            hardware_probe=hardware_probe,
            intent=intent,
        )

        # --- Build reasoning ---
        reasoning_parts = []
        reasoning_parts.append(
            f"Detected intent: hardware={hardware_target or 'unspecified'}, "
            f"model_type={model_type}, goal={optimization_goal or 'general optimization'}."
        )
        if strategy.get("recommended_algorithm"):
            reasoning_parts.append(
                f"Recommended algorithm: {strategy['recommended_algorithm']}."
            )
        if strategy.get("calibration_strategy"):
            reasoning_parts.append(
                f"Calibration: {strategy['calibration_strategy']}."
            )
        if strategy.get("risks"):
            reasoning_parts.append(
                f"Key risks: {'; '.join(strategy['risks'][:2])}."
            )
        reasoning = " ".join(reasoning_parts)

        # --- Generate alternatives ---
        alternatives = _generate_alternatives(strategy, model_type, hardware_target)

        # --- Validate patch via Studio bridge (best-effort) ---
        validated, validation_note = _validate_patch(patch)

        # --- Build response ---
        result: dict[str, Any] = {
            "ui_state_patch": patch,
            "reasoning": reasoning,
            "alternatives": alternatives,
            "validated": validated,
            "side_effect": False,
        }
        if validation_note is not None:
            result["validation_note"] = validation_note

        return result

    except Exception as exc:
        logger.warning("plan_optimization unexpected error", exc_info=True)
        return {"error": "internal_error", "message": f"{type(exc).__name__}: {exc}"}
