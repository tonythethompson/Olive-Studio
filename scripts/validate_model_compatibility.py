#!/usr/bin/env python3
"""CLI wrapper for MCP server's get_model_compatibility validation.

Called by the Olive Studio server to validate model/hardware compatibility
without requiring a running MCP server.

Usage:
    python scripts/validate_model_compatibility.py "Mistral 7B" "PyTorch" ["NVIDIA RTX 4090"]
"""

import json
import sys
from pathlib import Path

# Add the MCP server package to the path
_MCP_DIR = Path(__file__).resolve().parent.parent / "olive-mcp-server"
if str(_MCP_DIR) not in sys.path:
    sys.path.insert(0, str(_MCP_DIR))

from olive_mcp_server.tools.compatibility import get_model_compatibility


def main() -> None:
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: validate_model_compatibility.py '<model_name>' '<framework>' [hardware_target]"}))
        sys.exit(1)

    model_name = sys.argv[1]
    framework = sys.argv[2]
    hardware_target = sys.argv[3] if len(sys.argv) > 3 else ""

    result = get_model_compatibility(
        model_name=model_name,
        framework=framework,
        hardware_target=hardware_target,
    )

    print(json.dumps(result))


if __name__ == "__main__":
    main()
