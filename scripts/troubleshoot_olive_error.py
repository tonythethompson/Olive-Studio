#!/usr/bin/env python3
"""CLI wrapper for MCP server's troubleshoot_olive_error tool.

Called by the Olive Studio server to diagnose Olive execution errors
without requiring a running MCP server.

Usage:
    python scripts/troubleshoot_olive_error.py '<error_message>' [pass_name] [config_context]
"""

import json
import sys
from pathlib import Path

# Add the MCP server package to the path
_MCP_DIR = Path(__file__).resolve().parent.parent / "olive-mcp-server"
if str(_MCP_DIR) not in sys.path:
    sys.path.insert(0, str(_MCP_DIR))

from olive_mcp_server.tools.troubleshooting import troubleshoot_olive_error


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: troubleshoot_olive_error.py '<error_message>' [pass_name] [config_context]"}))
        sys.exit(1)

    error_message = sys.argv[1]
    pass_name = sys.argv[2] if len(sys.argv) > 2 else ""
    config_context = sys.argv[3] if len(sys.argv) > 3 else ""

    result = troubleshoot_olive_error(
        error_message=error_message,
        pass_name=pass_name,
        config_context=config_context,
    )
    print(json.dumps(result))


if __name__ == "__main__":
    main()
