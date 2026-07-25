"""Shared normalization helpers for Olive MCP tools."""


def normalize_model(name: str) -> str:
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


def normalize_framework(framework: str) -> str:
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


def normalize_hardware(target: str) -> str:
    """
    Normalize a hardware target description to its canonical profile name.

    Parameters:
        target (str): User-provided hardware target description.

    Returns:
        str: Canonical hardware profile name, or the original target when no profile matches.
    """
    t = target.lower()
    if "rtx 4090" in t:
        return "NVIDIA RTX 4090"
    if "t4" in t:
        return "NVIDIA T4"
    if "intel" in t and "cpu" in t:
        return "Intel Core i9 CPU"
    if "qualcomm" in t or "snapdragon" in t or "qnn" in t:
        return "Qualcomm Snapdragon NPU"
    if "apple" in t or "coreml" in t or "m2" in t or "m3" in t:
        return "Apple M2/M3 (CoreML)"
    if "android" in t or "nnapi" in t:
        return "Android NNAPI"
    if "openvino" in t:
        return "Intel iGPU / OpenVINO"
    if "xilinx" in t or "vitis" in t:
        return "Xilinx Vitis AI DPU"
    return target
