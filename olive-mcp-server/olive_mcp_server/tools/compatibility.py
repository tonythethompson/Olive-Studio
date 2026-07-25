"""Tools: get_model_compatibility and helpers."""

from typing import Any

from . import load_compatibility_matrix, load_passes


def _normalize_model(name: str) -> str:
    """
    Normalize a model name to a canonical identifier when it matches a known model family.
    
    Parameters:
        name (str): Model name to normalize.
    
    Returns:
        str: Canonical model identifier for recognized model families; otherwise, the original name.
    """
    n = name.lower()
    if "mistral" in n:
        return "Mistral 7B"
    if "phi" in n:
        return "Phi-3-mini"
    if "resnet" in n:
        return "ResNet-50"
    if "whisper" in n:
        return "Whisper"
    return name


def _normalize_framework(framework: str) -> str:
    """
    Normalize a framework identifier to its canonical name.
    
    Parameters:
        framework (str): Framework name or alias to normalize.
    
    Returns:
        str: Canonical framework name for recognized aliases; otherwise, the original identifier.
    """
    f = framework.lower()
    if f in ("pytorch", "torch", "hf", "huggingface"):
        return "PyTorch"
    if f in ("onnx",):
        return "ONNX"
    if f in ("tf", "tensorflow"):
        return "TensorFlow"
    return framework


def get_model_compatibility(
    model_name: str,
    framework: str,
    olive_version: str = "",
) -> dict[str, Any]:
    """
    Check compatibility for a model and framework using the local compatibility matrix.
    
    Args:
        model_name: Model name or path to normalize and look up.
        framework: Source framework identifier, including supported aliases.
        olive_version: Optional Olive version to include in the compatibility result.
    
    Returns:
        A compatibility summary containing normalized identifiers, framework support,
        hardware profiles, notes, and Olive version for known models. For unknown
        models, contains the normalized framework, available pass names, and
        suggested workflow steps.
    """
    models = load_compatibility_matrix()
    key = _normalize_model(model_name)
    fw = _normalize_framework(framework)
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
