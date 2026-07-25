"""Olive optimization MCP server entry point.

This server exposes tools that help AI agents query, configure, and
troubleshoot Microsoft Olive model optimization workflows.

Usage:
    python -m olive_mcp_server
    olive-mcp-server
"""

from mcp.server.fastmcp import FastMCP

from olive_mcp_server.tools.cli_helper import get_cli_command
from olive_mcp_server.tools.compatibility import get_model_compatibility
from olive_mcp_server.tools.config_generator import get_pass_config_template
from olive_mcp_server.tools.data_config import get_data_config_template
from olive_mcp_server.tools.docs_search import search_olive_documentation
from olive_mcp_server.tools.hardware_guide import get_hardware_optimization_guide
from olive_mcp_server.tools.integration_recipes import get_integration_recipe
from olive_mcp_server.tools.pass_catalog import get_olive_passes
from olive_mcp_server.tools.pass_chain import get_pass_chain
from olive_mcp_server.tools.pass_parameters import get_pass_parameters
from olive_mcp_server.tools.strategy_advisor import get_quantization_strategy
from olive_mcp_server.tools.tradeoff import evaluate_optimization_tradeoff
from olive_mcp_server.tools.troubleshooting import troubleshoot_olive_error

mcp = FastMCP("olive-mcp-server")

TOOLS = [
    get_olive_passes,
    get_pass_config_template,
    get_quantization_strategy,
    get_hardware_optimization_guide,
    get_pass_chain,
    troubleshoot_olive_error,
    get_model_compatibility,
    get_cli_command,
    get_data_config_template,
    search_olive_documentation,
    get_integration_recipe,
    get_pass_parameters,
    evaluate_optimization_tradeoff,
]

for tool in TOOLS:
    mcp.tool()(tool)


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
