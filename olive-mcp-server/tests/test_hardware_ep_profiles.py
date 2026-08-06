"""Hardware EP profile resolution and strategy coverage for new targets."""

from __future__ import annotations

import pytest

from olive_mcp_server.tools.compatibility import get_model_compatibility
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
    assert "openvino_device" not in result


@pytest.mark.parametrize(
    ("query", "expected_device"),
    [
        ("OpenVINOExecutionProvider", "CPU"),
        ("openvino", "CPU"),
        ("openvino npu", "NPU"),
        ("openvino:npu", "NPU"),
        ("openvino+npu", "NPU"),
        ("OpenVINOExecutionProvider:NPU", "NPU"),
        ("intel npu", "NPU"),
        ("openvino gpu", "GPU"),
        ("openvino:gpu", "GPU"),
        ("intel gpu", "GPU"),
        ("igpu", "GPU"),
        ("openvino arc", "GPU"),
        ("intel arc", "GPU"),
    ],
)
def test_hardware_guide_returns_openvino_device(query: str, expected_device: str) -> None:
    result = get_hardware_optimization_guide(target_hardware=query)
    assert "error" not in result, result
    assert result.get("openvino_device") == expected_device


def test_hardware_guide_invalid_ov_device_errors() -> None:
    result = get_hardware_optimization_guide(target_hardware="openvino:tpu")
    assert "error" in result
    assert "tpu" in result["error"].lower()
    assert "openvino_device" not in result
    assert "target_hardware" not in result


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


def test_quantization_strategy_openvino_npu_uses_device_not_string_sniff() -> None:
    result = get_quantization_strategy(model_type="LLM", target_hardware="openvino:npu")
    assert "error" not in result
    assert result["target_hardware"] == "intel"
    assert result.get("openvino_device") == "NPU"
    assert "npu" in result["recommended_algorithm"].lower()


def test_quantization_strategy_canonical_ov_npu_profile() -> None:
    """Direct canonical profile name still selects the OpenVINO NPU path."""
    result = get_quantization_strategy(
        model_type="LLM",
        target_hardware="Intel Core Ultra NPU (OpenVINO)",
    )
    assert "error" not in result
    assert result["target_hardware"] == "intel"
    assert "npu" in result["recommended_algorithm"].lower()
    assert "OpenVINOWeightCompression" in result["pass_chain"]


def test_quantization_strategy_invalid_ov_device_fails_loud() -> None:
    result = get_quantization_strategy(model_type="LLM", target_hardware="openvino:tpu")
    assert "error" in result
    assert "tpu" in result["error"].lower()
    assert "recommended_algorithm" not in result


def test_compatibility_openvino_device_on_success() -> None:
    result = get_model_compatibility(
        model_name="resnet-50",
        framework="PyTorch",
        hardware_target="openvino:gpu",
    )
    assert "error" not in result
    assert result.get("openvino_device") == "GPU"
    assert result.get("selected_hardware") == "Intel iGPU / OpenVINO"


def test_compatibility_invalid_ov_device_errors() -> None:
    result = get_model_compatibility(
        model_name="resnet-50",
        framework="PyTorch",
        hardware_target="openvino:tpu",
    )
    assert "error" in result
    assert "tpu" in result["error"].lower()
    assert "openvino_device" not in result
    assert "selected_hardware" not in result
