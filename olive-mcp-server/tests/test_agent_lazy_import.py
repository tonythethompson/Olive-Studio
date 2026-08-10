"""Test lazy-import isolation for Phase 3 agent tools.

Validates: Requirements 11.2, 11.4
"""
from __future__ import annotations

import importlib
import sys


def test_new_tool_modules_not_in_sys_modules_after_server_import():
    """Importing mcp_server must NOT eagerly load agent tool modules."""
    agent_modules = [
        "olive_mcp_server.tools.agent_execute",
        "olive_mcp_server.tools.agent_planner",
        "olive_mcp_server.tools.agent_diagnosis",
        "olive_mcp_server.tools.agent_compare",
        "olive_mcp_server.tools.agent_model_info",
    ]

    for mod in agent_modules:
        sys.modules.pop(mod, None)

    if "olive_mcp_server.mcp_server" in sys.modules:
        importlib.reload(sys.modules["olive_mcp_server.mcp_server"])
    else:
        import olive_mcp_server.mcp_server  # noqa: F401

    for mod in agent_modules:
        assert mod not in sys.modules, (
            f"{mod} was eagerly imported by mcp_server (should be lazy)"
        )
