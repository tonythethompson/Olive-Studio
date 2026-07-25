"""Integration tests: call tools through the MCP server object."""

import asyncio
import json

from olive_mcp_server.mcp_server import mcp


def _run(coro):
    return asyncio.run(coro)


def test_server_lists_all_tools():
    tools = _run(mcp.list_tools())
    names = {t.name for t in tools}
    expected = {
        "get_olive_passes",
        "get_pass_config_template",
        "get_quantization_strategy",
        "get_hardware_optimization_guide",
        "get_pass_chain",
        "troubleshoot_olive_error",
        "get_model_compatibility",
        "get_cli_command",
        "get_data_config_template",
        "search_olive_documentation",
        "get_pass_parameters",
        "evaluate_optimization_tradeoff",
    }
    assert expected <= names


def test_get_olive_passes_via_server():
    result, _ = _run(mcp.call_tool("get_olive_passes", {"filter": "quantization"}))
    data = json.loads(result[0].text)
    assert data["filter"] == "quantization"
    assert all(p["type"] == "quantization" for p in data["passes"])


def test_quantization_strategy_via_server():
    result, _ = _run(
        mcp.call_tool(
            "get_quantization_strategy",
            {
                "model_type": "LLM",
                "target_hardware": "NVIDIA RTX 4090",
                "latency_budget": "<100ms",
                "accuracy_threshold": "<2% drop",
            },
        )
    )
    data = json.loads(result[0].text)
    assert data["target_hardware"] == "nvidia"
    assert "pass_chain" in data


def test_pass_chain_via_server():
    result, _ = _run(
        mcp.call_tool(
            "get_pass_chain",
            {"pass_names": ["OnnxConversion", "OnnxModelOptimizer", "OnnxQuantization"]},
        )
    )
    data = json.loads(result[0].text)
    assert data["valid"] is True
    assert len(data["chain"]) == 3


def test_troubleshoot_olive_error_via_server():
    # Test matched entry
    result, _ = _run(
        mcp.call_tool(
            "troubleshoot_olive_error",
            {
                "error_message": "ValueError: The model file size is larger than 2GB. Please use use_external_data_format=True",
                "pass_name": "OnnxConversion",
            },
        )
    )
    data = json.loads(result[0].text)
    assert data["matched_entry"] == "onnx-export-external-data"
    assert "use_external_data_format" in data["workaround"]

    # Test unmatched entry
    result_unmatched, _ = _run(
        mcp.call_tool(
            "troubleshoot_olive_error",
            {
                "error_message": "Some random unique unknown failure message 12345",
            },
        )
    )
    data_unmatched = json.loads(result_unmatched[0].text)
    assert data_unmatched["matched_entry"] is None
    assert data_unmatched["title"] == "No exact match found"

