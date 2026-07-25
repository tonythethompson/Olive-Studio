"""Shared normalization helpers for MCP tool inputs.

These map user-supplied strings (which vary in casing and phrasing) to the
canonical values used as keys in the knowledge base JSON files.
"""

from . import load_hardware_profiles

_FRAMEWORK_ALIASES = {
    "torch": "PyTorch",
    "pytorch": "PyTorch",
    "hf": "HuggingFace",
    "huggingface": "HuggingFace",
    "onnx": "ONNX",
    "tf": "TensorFlow",
    "tensorflow": "TensorFlow",
}

_MODEL_ALIASES = {
    "mistral": "Mistral 7B",
    "phi-3": "Phi-3-mini",
    "phi3": "Phi-3-mini",
    "resnet": "ResNet-50",
    "whisper": "Whisper",
}


def normalize_framework(framework: str) -> str:
    """Canonicalize a framework name, e.g. "torch" -> "PyTorch"."""
    name = framework.strip()
    return _FRAMEWORK_ALIASES.get(name.lower(), name)


def normalize_model(model_name: str) -> str:
    """Map a model name or HuggingFace ID to its compatibility-matrix key.

    Falls back to the stripped input if no known alias matches, so callers
    can still detect "not found in the local matrix" cases.
    """
    name = model_name.strip()
    lower = name.lower()
    for alias, canonical in _MODEL_ALIASES.items():
        if alias in lower:
            return canonical
    return name


def normalize_hardware(target_hardware: str) -> str:
    """Case-insensitively match a hardware target to its canonical profile name.

    Falls back to the stripped input if no known hardware profile matches.
    """
    name = target_hardware.strip()
    lower = name.lower()
    for profile in load_hardware_profiles():
        if profile["target"].lower() == lower:
            return profile["target"]
    return name
