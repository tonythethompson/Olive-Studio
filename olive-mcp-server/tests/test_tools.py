"""Unit tests for Olive MCP tools."""

import pytest

from olive_mcp_server.tools.cli_helper import get_cli_command
from olive_mcp_server.tools.compatibility import get_model_compatibility
from olive_mcp_server.tools.config_generator import get_pass_config_template
from olive_mcp_server.tools.data_config import get_data_config_template
from olive_mcp_server.tools.docs_search import search_olive_documentation
from olive_mcp_server.tools.hardware_guide import get_hardware_optimization_guide
from olive_mcp_server.tools.pass_catalog import get_olive_passes
from olive_mcp_server.tools.pass_chain import get_pass_chain
from olive_mcp_server.tools.pass_parameters import get_pass_parameters
from olive_mcp_server.tools.strategy_advisor import get_quantization_strategy
from olive_mcp_server.tools.tradeoff import evaluate_optimization_tradeoff
from olive_mcp_server.tools.troubleshooting import troubleshoot_olive_error


def test_get_olive_passes_no_filter():
    result = get_olive_passes()
    assert "passes" in result
    assert result["count"] > 0
    assert all("name" in p for p in result["passes"])


def test_get_olive_passes_filter_quantization():
    result = get_olive_passes(filter="quantization")
    assert result["filter"] == "quantization"
    assert all(p["type"] == "quantization" for p in result["passes"])


def test_get_pass_config_template_known_pass():
    result = get_pass_config_template(
        pass_name="OnnxQuantization",
        framework="onnx",
        optimization_target="latency",
    )
    assert "error" not in result
    assert result["pass_name"] == "OnnxQuantization"
    assert "config" in result
    assert result["config"]["passes"]["OnnxQuantization"]["params"]["quant_format"] in (
        "QOperator",
        "QDQ",
    )


def test_get_pass_config_template_unknown_pass():
    result = get_pass_config_template(pass_name="NotARealPass")
    assert "error" in result


def test_get_quantization_strategy_llm_nvidia():
    result = get_quantization_strategy(
        model_type="LLM",
        target_hardware="NVIDIA RTX 4090",
        latency_budget="<100ms",
        accuracy_threshold="<2% drop",
    )
    assert "error" not in result
    assert "NVModelOptQuantization" in result["recommended_algorithm"] or "AWQ" in result["recommended_algorithm"]
    assert result["target_hardware"] == "nvidia"
    assert result["model_type"] == "llm"
    assert "pass_chain" in result


def test_get_quantization_strategy_cnn_mobile():
    result = get_quantization_strategy(
        model_type="CNN",
        target_hardware="Qualcomm Snapdragon NPU",
        latency_budget="<50ms",
        accuracy_threshold="<1% drop",
    )
    assert result["model_type"] == "cnn"
    assert result["target_hardware"] == "qualcomm"
    assert "QNN" in result["recommended_algorithm"]


def test_get_hardware_optimization_guide_known():
    result = get_hardware_optimization_guide(
        target_hardware="NVIDIA RTX 4090",
        model_size="large",
        latency_goal="<100ms",
    )
    assert "error" not in result
    assert result["target_hardware"] == "NVIDIA RTX 4090"
    assert "TensorrtExecutionProvider" in result["execution_providers"]
    assert result["calibration_size"] >= 300


def test_get_hardware_optimization_guide_unknown():
    result = get_hardware_optimization_guide(target_hardware="MadeUpChip 9000")
    assert "error" in result


def test_get_pass_chain_valid():
    result = get_pass_chain(["OnnxConversion", "OnnxModelOptimizer", "OnnxQuantization"])
    assert result["valid"] is True
    assert len(result["errors"]) == 0
    assert result["chain"][0]["name"] == "OnnxConversion"


def test_get_pass_chain_invalid_order():
    result = get_pass_chain(["OnnxQuantization", "OnnxConversion"], source_format="PyTorch")
    assert result["valid"] is False
    assert len(result["errors"]) > 0


def test_troubleshoot_known_error():
    result = troubleshoot_olive_error(
        error_message="The ONNX model is larger than 2GB",
        pass_name="OnnxConversion",
    )
    assert "root_cause" in result
    assert "external" in result["workaround"].lower()


def test_get_model_compatibility_known():
    result = get_model_compatibility(
        model_name="Mistral 7B",
        framework="PyTorch",
    )
    assert "hardware_profiles" in result


def test_get_cli_command():
    result = get_cli_command(
        optimization_goal="quantize",
        model="microsoft/phi-4",
        target="gpu",
    )
    assert "olive quantize" in result["command"]
    assert "--config" in result["command"]


def test_get_data_config_template():
    result = get_data_config_template(data_source="huggingface", task="calibration")
    assert result["data_config"]["calibration_data"]["type"] == "HuggingFaceContainer"
    assert "calibration_sampling_size" in result["data_config"]


def test_search_olive_documentation():
    result = search_olive_documentation(query="calibration data", top_k=3)
    assert result["count"] > 0
    assert len(result["results"]) <= 3


def test_get_pass_parameters():
    result = get_pass_parameters(pass_name="OnnxQuantization", parameter_name="quant_format")
    assert result["parameter_name"] == "quant_format"
    assert "QOperator" in result["documentation"]["enum"]


def test_evaluate_optimization_tradeoff():
    result = evaluate_optimization_tradeoff(
        passes=["OnnxConversion", "OnnxQuantization"],
        evaluation_metrics=["accuracy", "latency", "size"],
    )
    assert result["predicted_outcomes"]["size"] < 100
    assert result["predicted_outcomes"]["latency"] < 1.0


def test_get_pass_chain_onnx_source_no_conversion_required():
    result = get_pass_chain(["OnnxQuantization"], source_format="onnx")
    assert result["valid"] is True
    assert len(result["errors"]) == 0
