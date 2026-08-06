"""Hardware EP profile resolution and strategy coverage for new targets."""

from __future__ import annotations

import pytest

from olive_mcp_server.tools.hardware_guide import get_hardware_optimization_guide
from olive_mcp_server.tools.strategy_advisor import get_quantization_strategy


@pytest.mark.parametrize(
    ("query", "expected_target", "expected_ep"),
    [
        ("NvTensorRTRTXExecutionProvider", "NVIDIA TensorRT RTX", "NvTensorRTRTXExecutionProvider"),
        ("DmlExecutionProvider", "Windows DirectML GPU", "DmlExecutionProvider"),
        ("WebGpuExecutionProvider", "WebGPU (Browser)", "WebGpuExecutionProvider"),
        ("openvino npu", "Intel Core Ultra NPU (OpenVINO)", "OpenVINOExecutionProvider"),
        ("directml", "Windows DirectML GPU", "DmlExecutionProvider"),
        ("webgpu", "WebGPU (Browser)", "WebGpuExecutionProvider"),
        ("tensorrt rtx", "NVIDIA TensorRT RTX", "NvTensorRTRTXExecutionProvider"),
    ],
)
def test_hardware_guide_resolves_new_eps(
    query: str, expected_target: str, expected_ep: str
) -> None:
    result = get_hardware_optimization_guide(target_hardware=query)
    assert "error" not in result, result
    assert result["target_hardware"] == expected_target
    assert expected_ep in result["execution_providers"]


def test_bare_npu_still_qualcomm_via_guide() -> None:
    result = get_hardware_optimization_guide(target_hardware="npu")
    assert "error" not in result
    assert result["target_hardware"] == "Qualcomm Snapdragon NPU"
    assert "QNNExecutionProvider" in result["execution_providers"]


@pytest.mark.parametrize(
    ("hardware", "model_type", "expected_category", "algo_substr"),
    [
        ("webgpu", "LLM", "webgpu", "FP16"),
        ("WebGpuExecutionProvider", "CNN", "webgpu", "FP16"),
        ("directml", "LLM", "directml", "INT8"),
        ("DmlExecutionProvider", "CNN", "directml", "INT8"),
        ("Windows DirectML GPU", "vision", "directml", "DirectML"),
        ("openvino npu", "LLM", "intel", "OpenVINO"),
        ("NVIDIA TensorRT RTX", "LLM", "nvidia", "AWQ"),
    ],
)
def test_quantization_strategy_new_categories(
    hardware: str,
    model_type: str,
    expected_category: str,
    algo_substr: str,
) -> None:
    result = get_quantization_strategy(model_type=model_type, target_hardware=hardware)
    assert "error" not in result
    assert result["target_hardware"] == expected_category
    assert algo_substr.lower() in result["recommended_algorithm"].lower()
    assert result["pass_chain"]
