"""Tools: get_model_compatibility and helpers."""

from typing import Any

from . import load_compatibility_matrix, load_passes
from .normalization import normalize_framework, normalize_model


def get_model_compatibility(
    model_name: str,
    framework: str,
    olive_version: str = "",
) -> dict[str, Any]:
    """Check Olive support for a model/framework combo.

    Args:
        model_name: Model name or path, e.g. "mistralai/Mistral-7B-v0.1".
        framework: Source framework, e.g. "PyTorch", "ONNX", "HuggingFace".
        olive_version: Optional Olive version string.

    Returns:
        Compatibility matrix for supported passes, known issues, and expected performance.
    """
    models = load_compatibility_matrix()
    key = normalize_model(model_name)
    fw = normalize_framework(framework)
    passes = {p["name"]: p for p in load_passes()}

    matched = [m for m in models if m["model"] == key]
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

    return {
        "model": key,
        "framework": fw,
        "framework_supported": framework_supported,
        "olive_version": olive_version or "not specified",
        "hardware_profiles": hardware_matrix,
        "general_notes": model.get("notes", ""),
    }
