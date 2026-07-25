#!/usr/bin/env python3
"""CLI wrapper for MCP server's get_pass_chain validation.

Called by the Olive Studio server to validate a recipe's pass ordering
without requiring a running MCP server.

Usage:
    python scripts/validate_pass_chain.py '["OnnxConversion","OnnxQuantization"]' [source_format]
"""

import json
import sys
from pathlib import Path

# Add the MCP server package to the path
_MCP_DIR = Path(__file__).resolve().parent.parent / "olive-mcp-server"
if str(_MCP_DIR) not in sys.path:
    sys.path.insert(0, str(_MCP_DIR))

from olive_mcp_server.tools.pass_chain import get_pass_chain


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: validate_pass_chain.py '<pass_names_json>' [source_format]"}))
        sys.exit(1)

    try:
        pass_names = json.loads(sys.argv[1])
    except json.JSONDecodeError as exc:
        print(json.dumps({"error": f"Invalid JSON for pass_names: {exc}"}))
        sys.exit(1)

    source_format = sys.argv[2] if len(sys.argv) > 2 else ""

    result = get_pass_chain(pass_names, source_format=source_format)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
