"""Tools: get_model_compatibility and helpers."""

from typing import Any

from . import load_compatibility_matrix, load_json, load_passes
from .normalization import normalize_framework, normalize_hardware, normalize_model

# Dict-indexed cache for O(1) model lookup (keyed by normalized model name).
_model_index: dict[str, dict[str, Any]] | None = None


def _get_model_index() -> dict[str, dict[str, Any]]:
    """Build and cache a dict index of the compatibility matrix."""
    global _model_index
    if _model_index is None:
        models = load_compatibility_matrix()
        _model_index = {normalize_model(m["model"]): m for m in models}
    return _model_index


def _get_version_support() -> dict[str, str]:
    """Return the tested Olive version range from KB metadata."""
    data = load_json("compatibility_matrix.json")
    return data.get("olive_version_support", {})


def get_model_compatibility(
    model_name: str,
    framework: str,
    olive_version: str = "",
    hardware_target: str = "",
) -> dict[str, Any]:
    """Check Olive support for a model/framework combo.

    Args:
        model_name: Model name or path, e.g. "mistralai/Mistral-7B-v0.1".
        framework: Source framework, e.g. "PyTorch", "ONNX", "HuggingFace".
        olive_version: Optional Olive version string.
        hardware_target: Optional hardware target to filter to, e.g. "NVIDIA RTX 4090".

    Returns:
        Compatibility matrix for supported passes, known issues, and expected performance.
    """
    index = _get_model_index()
    key = normalize_model(model_name)
    fw = normalize_framework(framework)
    passes = {p["name"]: p for p in load_passes()}

    model = index.get(key)
    if not model:
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

    # Version compatibility warning
    if olive_version:
        version_support = _get_version_support()
        v_min = version_support.get("min", "")
        v_max = version_support.get("max", "")
        if v_min and v_max:
            if olive_version < v_min or olive_version > v_max:
                result["version_warning"] = (
                    f"Olive {olive_version} is outside the tested range "
                    f"({v_min} – {v_max}). Pass configurations may differ."
                )

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
