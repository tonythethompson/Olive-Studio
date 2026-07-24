"""Integration tests: call tools through the MCP server object."""

import asyncio
import json

from mcp_server import mcp


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
