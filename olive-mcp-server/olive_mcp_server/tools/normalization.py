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
    "phi-4": "Phi-4",
    "phi4": "Phi-4",
    "resnet": "ResNet-50",
    "whisper": "Whisper",
    "meta-llama/Meta-Llama-3-8B": "Llama 3 8B",
    "llama-3-8b": "Llama 3 8B",
    "llama3-8b": "Llama 3 8B",
    "llama 3": "Llama 3 8B",
    "llama-3": "Llama 3 8B",
    "llama3": "Llama 3 8B",
    "meta-llama/Llama-2-7b-hf": "Llama 2 7B",
    "llama-2-7b": "Llama 2 7B",
    "llama2-7b": "Llama 2 7B",
    "llama 2": "Llama 2 7B",
    "llama-2": "Llama 2 7B",
    "llama2": "Llama 2 7B",
    "codellama/CodeLlama-7b-Instruct-hf": "CodeLlama 7B",
    "codellama-7b": "CodeLlama 7B",
    "code-llama": "CodeLlama 7B",
    "codellama": "CodeLlama 7B",
    "deepseek-ai/DeepSeek-R1-Distill-Llama-8B": "DeepSeek-R1-Distill-Llama 8B",
    "deepseek-r1-distill-llama-8b": "DeepSeek-R1-Distill-Llama 8B",
    "deepseek-r1": "DeepSeek-R1-Distill-Llama 8B",
    "deepseek": "DeepSeek-R1-Distill-Llama 8B",
    "compvis/stable-diffusion-v1-4": "Stable Diffusion v1.4",
    "stable-diffusion-v1-4": "Stable Diffusion v1.4",
    "stable diffusion": "Stable Diffusion v1.4",
    "stable-diffusion": "Stable Diffusion v1.4",
    "google-bert/bert-base-uncased": "BERT-base",
    "bert-base": "BERT-base",
    "bert": "BERT-base",
    "mobilenetv2": "MobileNetV2",
    "mobilenet v2": "MobileNetV2",
    "efficientnet-b0": "EfficientNet-B0",
    "efficientnet b0": "EfficientNet-B0",
    "google/vit-base-patch16-224": "ViT-base",
    "vit-base": "ViT-base",
    "vit base": "ViT-base",
    "t5-small": "T5-small",
    "t5 small": "T5-small",
    "openai-gpt/gpt2": "GPT-2",
    "gpt2": "GPT-2",
    "gpt-2": "GPT-2",
    "tiiuae/falcon-7b": "Falcon 7B",
    "falcon-7b": "Falcon 7B",
    "falcon 7b": "Falcon 7B",
    "ultralytics/yolov8": "YOLOv8",
    "yolov8": "YOLOv8",
    "yolo v8": "YOLOv8",
    "mistralai/Mixtral-8x7B-Instruct-v0.1": "Mixtral 8x7B",
    "mixtral-8x7b": "Mixtral 8x7B",
    "mixtral 8x7b": "Mixtral 8x7B",
    "azure openai whisper": "Azure OpenAI Whisper",
}

_EXECUTION_PROVIDER_TO_TARGET = {
    "CPUExecutionProvider": "Intel Core i9 CPU",
    "CUDAExecutionProvider": "NVIDIA RTX 4090",
    "TensorrtExecutionProvider": "NVIDIA RTX 4090",
    "NvTensorRTRTXExecutionProvider": "NVIDIA TensorRT RTX",
    "OpenVINOExecutionProvider": "Intel Core i9 CPU",  # default CPU/OV; NPU via aliases
    "QNNExecutionProvider": "Qualcomm Snapdragon NPU",
    "ROCMExecutionProvider": "AMD MI300X / ROCm",
    "DmlExecutionProvider": "Windows DirectML GPU",
    "DirectMLExecutionProvider": "Windows DirectML GPU",  # passes.json spelling
    "WebGpuExecutionProvider": "WebGPU (Browser)",
}

# Exact lowercase keys only (full stripped input). Applied after EP map, before
# profile exact/substring match. Do not use loose substrings (e.g. bare "rtx").
_HARDWARE_ALIASES = {
    "tensorrt rtx": "NVIDIA TensorRT RTX",
    "trt rtx": "NVIDIA TensorRT RTX",
    "nvtensorrtrtx": "NVIDIA TensorRT RTX",
    "tensorrt-rtx": "NVIDIA TensorRT RTX",
    "openvino npu": "Intel Core Ultra NPU (OpenVINO)",
    "intel npu": "Intel Core Ultra NPU (OpenVINO)",
    "core ultra npu": "Intel Core Ultra NPU (OpenVINO)",
    "openvinoexecutionprovider:npu": "Intel Core Ultra NPU (OpenVINO)",
    "openvino+npu": "Intel Core Ultra NPU (OpenVINO)",
    "directml": "Windows DirectML GPU",
    "dml": "Windows DirectML GPU",
    "webgpu": "WebGPU (Browser)",
    "web gpu": "WebGPU (Browser)",
    "ort web": "WebGPU (Browser)",
}

_hardware_profiles_cache: list[dict] | None = None


def clear_hardware_profiles_cache() -> None:
    """Drop the module-level hardware profile cache (tests / reload)."""
    global _hardware_profiles_cache
    _hardware_profiles_cache = None


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

    # Exact alias match on the full lowercased input (after EP map).
    alias_target = _HARDWARE_ALIASES.get(lower)
    if alias_target is not None:
        name = alias_target
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
    # Shortest match first so bare "npu" stays Qualcomm Snapdragon NPU
    # (shorter than "Intel Core Ultra NPU (OpenVINO)").
    reverse = [p for p in profiles if lower in p["target"].lower()]
    if reverse:
        reverse.sort(key=lambda p: len(p["target"]))
        return reverse[0]["target"]

    return name
