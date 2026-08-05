"""Tool: get_quantization_strategy."""

import re
from typing import Any

from . import load_hardware_profiles, load_quirks
from .normalization import normalize_hardware as _normalize_hardware_base


def _normalize_hardware(target: str) -> str:
    """Normalize hardware to category (nvidia/intel/qualcomm/etc) for strategy selection."""
    # Use the base normalization first
    normalized = _normalize_hardware_base(target)

    # Map to strategy categories
    n = normalized.lower()
    if "nvidia" in n or "rtx" in n or "tesla" in n or "t4" in n or "cuda" in n or "tensorrt" in n:
        return "nvidia"
    if "intel" in n or "openvino" in n or "core" in n:
        return "intel"
    if "qualcomm" in n or "qnn" in n or "snapdragon" in n:
        return "qualcomm"
    if "apple" in n or "coreml" in n or "m2" in n or "m3" in n:
        return "apple"
    if "android" in n or "nnapi" in n:
        return "android"
    if "xilinx" in n or "vitis" in n:
        return "xilinx"
    return "generic"


def _normalize_model_type(model_type: str) -> str:
    m = model_type.lower()
    if "llm" in m or any(x in m for x in ["llama", "mistral", "phi", "gpt", "qwen", "falcon"]):
        return "llm"
    if "cnn" in m or any(x in m for x in ["resnet", "mobilenet", "vit", "conv"]):
        return "cnn"
    if "vision" in m or "image" in m:
        return "vision"
    if "speech" in m or "whisper" in m or "audio" in m:
        return "speech"
    return "generic"


def _latency_rank(latency: str) -> int:
    l = latency.lower()
    if "<100" in l or "100ms" in l or "realtime" in l or "real-time" in l:
        return 0
    if "<500" in l or "500ms" in l:
        return 1
    if "<1" in l and "s" in l:
        return 2
    return 3


def get_quantization_strategy(
    model_type: str,
    target_hardware: str,
    latency_budget: str = "<500ms",
    accuracy_threshold: str = "<2% drop",
) -> dict[str, Any]:
    """Recommend a quantization approach for a model + hardware combo.

    Args:
        model_type: e.g. "LLM", "CNN", "Vision", or a model name like "llama-7b".
        target_hardware: e.g. "NVIDIA RTX 4090", "Qualcomm Snapdragon NPU".
        latency_budget: Human-readable latency target, e.g. "<100ms".
        accuracy_threshold: Human-readable accuracy constraint, e.g. "<2% drop".

    Returns:
        Recommended algorithm, calibration strategy, expected outcomes, and risks.
    """
    hw = _normalize_hardware(target_hardware)
    mt = _normalize_model_type(model_type)
    latency_rank_val = _latency_rank(latency_budget)
    quirks = load_quirks()

    # Base recommendations.
    if mt == "llm":
        if hw == "nvidia":
            algorithm = "NVModelOptQuantization (AWQ, int4 weights / int8 activations)"
            calibration = "calibration-light (32-128 samples); AWQ is data-aware"
            expected = {
                "size_reduction": "75-85%",
                "latency_speedup": "8-15x on TensorRT",
                "accuracy_drop": "1-3% for well-calibrated LLMs",
            }
            risks = [
                "AWQ can hurt perplexity on small models; validate with perplexity metric.",
                "TensorRT engine build is slow and device-specific.",
            ]
            pass_chain = ["OnnxConversion", "NVModelOptQuantization"]
        elif hw == "apple":
            algorithm = "CoreML INT8 static quantization (QDQ)"
            calibration = "100-200 representative samples, symmetric per-channel"
            expected = {
                "size_reduction": "65-75%",
                "latency_speedup": "3-7x on Neural Engine",
                "accuracy_drop": "1-4%",
            }
            risks = [
                "CoreML has limited dynamic-shape support; fix sequence length.",
                "Mistral/GQA attention patterns may not map cleanly to CoreML.",
            ]
            pass_chain = ["OnnxConversion", "OnnxModelOptimizer", "OnnxStaticQuantization"]
        else:
            algorithm = "GPTQ or HQQ weight-only int4 (CPU fallback)"
            calibration = "calibration-free (HQQ) or 128 samples (GPTQ)"
            expected = {
                "size_reduction": "70-80%",
                "latency_speedup": "2-5x (CPU), 4-8x (OpenVINO)",
                "accuracy_drop": "2-5%",
            }
            risks = [
                "Weight-only quantization does not speed up all operators on CPU.",
                "GPTQ can be slow to calibrate on large models.",
            ]
            pass_chain = ["OnnxConversion", "OnnxDynamicQuantization"]

    elif mt == "cnn" or mt == "vision":
        if hw == "nvidia":
            algorithm = "TensorRT INT8 static quantization"
            calibration = "200-500 ImageNet-like samples, per-channel symmetric"
            expected = {
                "size_reduction": "70-80%",
                "latency_speedup": "4-8x",
                "accuracy_drop": "<1%",
            }
            risks = [
                "Per-channel quantization improves accuracy but engine build is slower.",
            ]
            pass_chain = ["OnnxConversion", "OnnxModelOptimizer", "OnnxStaticQuantization", "OnnxFloatToFloat16"]
        elif hw == "qualcomm":
            algorithm = "QNN INT8 per-channel symmetric quantization"
            calibration = "128-256 representative samples, symmetric per-channel"
            expected = {
                "size_reduction": "65-75%",
                "latency_speedup": "5-10x on NPU",
                "accuracy_drop": "1-3%",
            }
            risks = [
                "QNN has a narrow operator whitelist; LayerNorm/GELU may fail.",
                "Must use symmetric per-channel quantization for best NPU accuracy.",
            ]
            pass_chain = ["OnnxConversion", "OnnxModelOptimizer", "QNNQuantization"]
        elif hw == "apple":
            algorithm = "CoreML per-channel INT8"
            calibration = "100-200 samples"
            expected = {
                "size_reduction": "60-70%",
                "latency_speedup": "3-6x",
                "accuracy_drop": "1-2%",
            }
            risks = [
                "CoreML requires fixed input shapes; dynamic batch is not supported.",
            ]
            pass_chain = ["OnnxConversion", "OnnxModelOptimizer", "OnnxStaticQuantization"]
        else:
            algorithm = "OpenVINO INT8 or ONNX Runtime static INT8"
            calibration = "100-300 samples"
            expected = {
                "size_reduction": "65-75%",
                "latency_speedup": "2-4x",
                "accuracy_drop": "<2%",
            }
            risks = [
                "OpenVINO may silently fall back to CPUExecutionProvider for unsupported ops.",
            ]
            pass_chain = ["OnnxConversion", "OnnxModelOptimizer", "OnnxStaticQuantization"]

    else:
        # generic / speech
        algorithm = "ONNX Runtime static INT8 (QDQ)"
        calibration = "100-300 representative samples"
        expected = {
            "size_reduction": "65-75%",
            "latency_speedup": "2-4x",
            "accuracy_drop": "1-3%",
        }
        risks = [
            "Speech models often have dynamic sequence lengths; use dynamic_axes and a representative length range.",
        ]
        pass_chain = ["OnnxConversion", "OnnxModelOptimizer", "OnnxStaticQuantization"]

    # Latency aggressiveness overrides.
    if latency_rank_val == 0 and mt == "llm":
        algorithm = algorithm.replace("int4", "int4 (aggressive)") + " + KV-cache quantization recommended"
        risks.append("Aggressive int4 can increase perplexity; evaluate with a held-out set.")
    elif latency_rank_val == 0 and (mt == "cnn" or mt == "vision"):
        algorithm += " + consider pruning 20-30% before quantization"
        risks.append("Pruning + quantization compound accuracy loss; fine-tune if possible.")

    # Accuracy constraint override.
    match = re.search(r"(\d+(?:\.\d+)?)\s*%", accuracy_threshold)
    if match:
        try:
            threshold_value = float(match.group(1))
            if threshold_value <= 1.0:
                algorithm = algorithm.replace("int4", "int8") + " (tight accuracy target)"
                risks.append("Tight accuracy target requires larger calibration set and per-channel weights.")
        except ValueError:
            # Skip override if parsing fails
            pass

    # Pull the top quirks from the most relevant categories.
    candidates = quirks.get("quantization", [])[:2] + quirks.get("pass_ordering", [])[:1]
    relevant_quirks = [title for q in candidates if (title := q.get("title", ""))]

    return {
        "model_type": mt,
        "target_hardware": hw,
        "latency_budget": latency_budget,
        "accuracy_threshold": accuracy_threshold,
        "recommended_algorithm": algorithm,
        "calibration_strategy": calibration,
        "expected_outcomes": expected,
        "risks": risks,
        "pass_chain": pass_chain,
        "relevant_quirks": relevant_quirks,
    }
