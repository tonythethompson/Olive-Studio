"""Tool: get_hardware_optimization_guide."""

from typing import Any

from . import load_hardware_profiles


def _normalize_target(target: str) -> str:
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


def get_hardware_optimization_guide(
    target_hardware: str,
    model_size: str = "medium",
    latency_goal: str = "<100ms",
    throughput_goal: str = "",
) -> dict[str, Any]:
    """Return a hardware-specific optimization path for Olive.

    Args:
        target_hardware: Hardware target, e.g. "NVIDIA RTX 4090" or "Qualcomm NPU".
        model_size: "small", "medium", or "large" (affects batch/calibration).
        latency_goal: Human-readable latency target.
        throughput_goal: Optional inferences/sec or batch target.

    Returns:
        Recommended pass chain, execution provider, speedup, and calibration.
    """
    profiles = {p["target"]: p for p in load_hardware_profiles()}
    key = _normalize_target(target_hardware)
    profile = profiles.get(key)
    if not profile:
        available = sorted(profiles.keys())
        return {
            "error": f"Hardware profile for '{target_hardware}' not found.",
            "available_profiles": available,
        }

    size_factors = {
        "small": {"calibration_factor": 0.75, "batch_factor": 1.0},
        "medium": {"calibration_factor": 1.0, "batch_factor": 1.0},
        "large": {"calibration_factor": 1.5, "batch_factor": 0.5},
    }
    factor = size_factors.get(model_size.lower(), size_factors["medium"])

    calibration_size = int(profile["calibration_size"] * factor["calibration_factor"])
    batch_size = max(1, int(profile["optimal_batch_size"] * factor["batch_factor"]))

    return {
        "target_hardware": profile["target"],
        "accelerator": profile["accelerator"],
        "execution_providers": profile["execution_providers"],
        "recommended_passes": profile["recommended_passes"],
        "typical_speedup": profile["typical_speedup"],
        "calibration_size": calibration_size,
        "optimal_batch_size": batch_size,
        "memory_gb": profile.get("memory_gb"),
        "ops_supported": profile.get("ops_supported", []),
        "known_issues": profile.get("known_issues", []),
        "notes": profile.get("notes", ""),
        "latency_goal": latency_goal,
        "throughput_goal": throughput_goal,
        "model_size": model_size,
    }
