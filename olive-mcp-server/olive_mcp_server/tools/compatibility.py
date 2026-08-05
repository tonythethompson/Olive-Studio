"""Tools: get_model_compatibility and helpers."""

from typing import Any

from . import load_compatibility_matrix, load_passes
from .normalization import normalize_framework, normalize_hardware, normalize_model


def get_model_compatibility(
    model_name: str,
    framework: str,
    olive_version: str = "",
    hardware_target: str = "",
) -> dict[str, Any]:
    """
    Evaluate compatibility for a model and framework, optionally targeting specific hardware.
    
    Args:
        model_name (str): Model name or path, such as "mistralai/Mistral-7B-v0.1".
        framework (str): Source framework, such as "PyTorch", "ONNX", or "HuggingFace".
        olive_version (str): Optional Olive version to include in the result.
        hardware_target (str): Optional hardware target for selecting compatibility details.
    
    Returns:
        dict[str, Any]: Compatibility details, supported passes and workflow suggestions for
            unknown models, or hardware-specific compatibility and warnings when requested.
    """
    models = load_compatibility_matrix()
    key = normalize_model(model_name)
    fw = normalize_framework(framework)
    passes = {p["name"]: p for p in load_passes()}

    matched = [m for m in models if normalize_model(m["model"]) == key]
    if not matched:
        return {
            "note": f"'{model_name}' is not in the local compatibility matrix. Use get_quantization_strategy and get_pass_chain to design a custom workflow.",
            "framework": fw,
            "supported_passes": list(passes.keys()),
            "suggested_first_steps": [
                "Run OnnxConversion (if PyTorch/HF) or load ONNX directly.",
                "Validate with OnnxModelOptimizer.",
                "Try OnnxStaticQuantization with 100 calibration samples.",
            ],
        }

    model = matched[0]
    framework_supported = fw in model.get("frameworks", [])
    hardware_matrix = model.get("hardware", {})

    result: dict[str, Any] = {
        "model": key,
        "framework": fw,
        "framework_supported": framework_supported,
        "olive_version": olive_version or "not specified",
        "hardware_profiles": hardware_matrix,
        "general_notes": model.get("notes", ""),
    }

    if hardware_target:
        target = normalize_hardware(hardware_target)
        if target in hardware_matrix:
            hw_compat = hardware_matrix[target]
            result["selected_hardware"] = target
            result["hardware_compatibility"] = hw_compat
            result["compatibility_warnings"] = [
                {
                    "pass_name": pass_name,
                    "note": pass_info.get("note", ""),
                    "typical_accuracy_drop": pass_info.get("typical_accuracy_drop", ""),
                }
                for pass_name, pass_info in hw_compat.items()
                if pass_info.get("support") == "warning"
            ]
        else:
            result["selected_hardware"] = target
            result["hardware_compatibility"] = {}
            result["compatibility_warnings"] = []
            result["hardware_note"] = f"No compatibility data for {target}"

    return result
