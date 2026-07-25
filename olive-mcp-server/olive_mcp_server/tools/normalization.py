"""Shared normalization helpers for MCP tool inputs.

These map user-supplied strings (which vary in casing and phrasing) to the
canonical values used as keys in the knowledge base JSON files.
"""

from . import load_hardware_profiles

_FRAMEWORK_ALIASES = {
    "torch": "PyTorch",
    "pytorch": "PyTorch",
    "hf": "PyTorch",
    "huggingface": "PyTorch",
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

_EXECUTION_PROVIDER_TO_TARGET = {
    "CPUExecutionProvider": "Intel Core i9 CPU",
    "CUDAExecutionProvider": "NVIDIA RTX 4090",
    "TensorrtExecutionProvider": "NVIDIA RTX 4090",
    "NvTensorRTRTXExecutionProvider": "NVIDIA RTX 4090",
    "OpenVINOExecutionProvider": "Intel Core i9 CPU",
    "QNNExecutionProvider": "Qualcomm Snapdragon NPU",
    "ROCMExecutionProvider": "AMD MI300X / ROCm",
}

_hardware_profiles_cache: list[dict] | None = None


def _get_hardware_profiles() -> list[dict]:
    """Return cached hardware profiles, loading them once."""
    global _hardware_profiles_cache
    if _hardware_profiles_cache is None:
        _hardware_profiles_cache = load_hardware_profiles()
    return _hardware_profiles_cache


def _is_word_boundary(text: str, index: int, length: int) -> bool:
    """Return True when text[index:index+length] is bounded by non-alphanumeric chars or string edges."""
    if index > 0 and text[index - 1].isalnum():
        return False
    end = index + length
    if end < len(text) and text[end].isalnum():
        return False
    return True


def normalize_framework(framework: str) -> str:
    """Canonicalize a framework name, e.g. 'torch' -> 'PyTorch'."""
    name = framework.strip()
    return _FRAMEWORK_ALIASES.get(name.lower(), name)


def normalize_model(model_name: str) -> str:
    """Map a model name or HuggingFace ID to its compatibility-matrix key.

    Falls back to the stripped input if no known alias matches, so callers
    can still detect "not found in the local matrix" cases.
    """
    name = model_name.strip()
    lower = name.lower()
    # Longer aliases first so overlapping names resolve to the most specific match.
    for alias in sorted(_MODEL_ALIASES, key=len, reverse=True):
        start = 0
        while True:
            idx = lower.find(alias, start)
            if idx == -1:
                break
            if _is_word_boundary(lower, idx, len(alias)):
                return _MODEL_ALIASES[alias]
            start = idx + 1
    return name


def normalize_hardware(target_hardware: str) -> str:
    """Match a hardware target to its canonical profile name.

    Falls back to the stripped input if no known hardware profile matches.
    """
    name = target_hardware.strip()
    lower = name.lower()

    # Map ONNX Runtime execution-provider strings to canonical hardware targets
    if name in _EXECUTION_PROVIDER_TO_TARGET:
        name = _EXECUTION_PROVIDER_TO_TARGET[name]
        lower = name.lower()

    profiles = _get_hardware_profiles()

    # Exact match
    for profile in profiles:
        if profile["target"].lower() == lower:
            return profile["target"]

    # Forward substring: profile target is contained in the input
    # (e.g. "NVIDIA RTX 4090" in "NVIDIA RTX 4090 Super").
    forward = [p for p in profiles if p["target"].lower() in lower]
    if forward:
        forward.sort(key=lambda p: len(p["target"]), reverse=True)
        return forward[0]["target"]

    # Reverse substring: input is contained in a profile target
    # (e.g. "RTX 4090" in "NVIDIA RTX 4090").
    reverse = [p for p in profiles if lower in p["target"].lower()]
    if reverse:
        reverse.sort(key=lambda p: len(p["target"]))
        return reverse[0]["target"]

    return name
