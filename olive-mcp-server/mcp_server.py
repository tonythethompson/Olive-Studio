"""Olive optimization MCP server entry point.

This server exposes tools that help AI agents query, configure, and
troubleshoot Microsoft Olive model optimization workflows.

Usage:
    python mcp_server.py
"""

from mcp.server.fastmcp import FastMCP

from tools.cli_helper import get_cli_command
from tools.compatibility import get_model_compatibility
from tools.config_generator import get_pass_config_template
from tools.data_config import get_data_config_template
from tools.docs_search import search_olive_documentation
from tools.hardware_guide import get_hardware_optimization_guide
from tools.pass_catalog import get_olive_passes
from tools.pass_chain import get_pass_chain
from tools.pass_parameters import get_pass_parameters
from tools.strategy_advisor import get_quantization_strategy
from tools.tradeoff import evaluate_optimization_tradeoff
from tools.troubleshooting import troubleshoot_olive_error

mcp = FastMCP("olive-mcp-server")

mcp.tool()(get_olive_passes)
mcp.tool()(get_pass_config_template)
mcp.tool()(get_quantization_strategy)
mcp.tool()(get_hardware_optimization_guide)
mcp.tool()(get_pass_chain)
mcp.tool()(troubleshoot_olive_error)
mcp.tool()(get_model_compatibility)
mcp.tool()(get_cli_command)
mcp.tool()(get_data_config_template)
mcp.tool()(search_olive_documentation)
mcp.tool()(get_pass_parameters)
mcp.tool()(evaluate_optimization_tradeoff)


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
