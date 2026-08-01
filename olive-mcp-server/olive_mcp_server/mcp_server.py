"""Olive optimization MCP server entry point.

This server exposes tools that help AI agents query, configure, and
troubleshoot Microsoft Olive model optimization workflows.

Usage:
    python -m olive_mcp_server
    olive-mcp-server
"""

from __future__ import annotations

import importlib
from typing import Any

# name → (module path, attribute). Lazy so HTTP diagnosis does not pull in
# optional deps like BeautifulSoup just to troubleshoot an Olive traceback.
_TOOL_IMPORTS: dict[str, tuple[str, str]] = {
    "get_olive_passes": ("olive_mcp_server.tools.pass_catalog", "get_olive_passes"),
    "get_pass_config_template": ("olive_mcp_server.tools.config_generator", "get_pass_config_template"),
    "get_quantization_strategy": ("olive_mcp_server.tools.strategy_advisor", "get_quantization_strategy"),
    "get_hardware_optimization_guide": (
        "olive_mcp_server.tools.hardware_guide",
        "get_hardware_optimization_guide",
    ),
    "get_pass_chain": ("olive_mcp_server.tools.pass_chain", "get_pass_chain"),
    "troubleshoot_olive_error": ("olive_mcp_server.tools.troubleshooting", "troubleshoot_olive_error"),
    "diagnose_error": ("olive_mcp_server.tools.troubleshooting", "diagnose_error"),
    "get_error_frequency_summary": (
        "olive_mcp_server.tools.troubleshooting",
        "get_error_frequency_summary",
    ),
    "get_model_compatibility": ("olive_mcp_server.tools.compatibility", "get_model_compatibility"),
    "get_cli_command": ("olive_mcp_server.tools.cli_helper", "get_cli_command"),
    "get_data_config_template": ("olive_mcp_server.tools.data_config", "get_data_config_template"),
    "search_olive_documentation": ("olive_mcp_server.tools.docs_search", "search_olive_documentation"),
    "get_integration_recipe": ("olive_mcp_server.tools.integration_recipes", "get_integration_recipe"),
    "get_pass_parameters": ("olive_mcp_server.tools.pass_parameters", "get_pass_parameters"),
    "evaluate_optimization_tradeoff": (
        "olive_mcp_server.tools.tradeoff",
        "evaluate_optimization_tradeoff",
    ),
}

_mcp_instance: Any | None = None
_resolved_tools: dict[str, Any] = {}


def _resolve_tool(name: str):
    if name in _resolved_tools:
        return _resolved_tools[name]
    target = _TOOL_IMPORTS.get(name)
    if target is None:
        return None
    module_name, attr = target
    module = importlib.import_module(module_name)
    fn = getattr(module, attr)
    _resolved_tools[name] = fn
    return fn


def call_tool(name: str, args: dict | None = None):
    """Invoke a registered tool by function name.

    Used by Olive Studio's HTTP proxy (`POST /api/mcp/tool`), which cannot speak
    the MCP stdio protocol. Tools are imported lazily so optional deps (bs4,
    requests, mcp) are only required when that specific tool runs.
    """
    payload = args if isinstance(args, dict) else {}
    tool = _resolve_tool(name)
    if tool is None:
        return {"error": f"Unknown tool: {name}"}
    return tool(**payload)


def _iter_tools():
    for name in _TOOL_IMPORTS:
        fn = _resolve_tool(name)
        if fn is not None:
            yield fn


def _build_mcp():
    """Create the FastMCP server (requires the optional ``mcp`` package)."""
    from mcp.server.fastmcp import FastMCP

    instance = FastMCP("olive-mcp-server")
    for tool in _iter_tools():
        instance.tool()(tool)
    return instance


def __getattr__(name: str):
    """Lazy ``mcp`` / ``TOOLS`` exports so optional deps stay optional."""
    global _mcp_instance
    if name == "mcp":
        if _mcp_instance is None:
            _mcp_instance = _build_mcp()
        return _mcp_instance
    if name == "TOOLS":
        return list(_iter_tools())
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def main() -> None:
    mcp = _build_mcp()
    mcp.run()


if __name__ == "__main__":
    main()
