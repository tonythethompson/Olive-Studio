"""Tests for get_mcp_capabilities and retrieval mode helpers."""

from __future__ import annotations

import os

import pytest

from olive_mcp_server.mcp_server import _TOOL_IMPORTS, call_tool
from olive_mcp_server.tools.capabilities import TOOLSET_VERSION, get_mcp_capabilities
from olive_mcp_server.tools.retrieval import get_retrieval_mode, get_semantic_budget_ms, run_with_budget


def test_get_mcp_capabilities_registered():
    assert "get_mcp_capabilities" in _TOOL_IMPORTS


def test_get_mcp_capabilities_shape():
    caps = get_mcp_capabilities()
    assert caps["server"]["name"] == "olive-mcp-server"
    assert "version" in caps["server"]
    assert "version" in caps["kb"]
    # Phase 1 ships precomputed indexes with the package.
    assert "shipped" in caps["kb"]["index"]
    assert "available" in caps["semantic"]
    assert "ready" in caps["semantic"]
    assert caps["retrieval"]["default_mode"] in ("auto", "keyword", "semantic")
    assert caps["job_control"]["supported"] is True
    assert caps["job_control"]["inspection"] is True
    assert caps["job_control"]["submission"] is False
    assert caps["toolset"]["version"] == TOOLSET_VERSION


def test_call_tool_capabilities():
    result = call_tool("get_mcp_capabilities", {})
    assert isinstance(result, dict)
    assert result["job_control"]["supported"] is True
    assert result["job_control"]["submission"] is False


def test_retrieval_mode_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OLIVE_MCP_RETRIEVAL_MODE", "keyword")
    assert get_retrieval_mode() == "keyword"
    assert get_retrieval_mode("semantic") == "semantic"
    monkeypatch.setenv("OLIVE_MCP_RETRIEVAL_MODE", "nope")
    assert get_retrieval_mode() == "auto"


def test_semantic_budget_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OLIVE_MCP_SEMANTIC_BUDGET_MS", "1234")
    assert get_semantic_budget_ms() == 1234
    monkeypatch.setenv("OLIVE_MCP_SEMANTIC_BUDGET_MS", "not-int")
    assert get_semantic_budget_ms() == 8000


def test_run_with_budget_timeout():
    def slow():
        import time

        time.sleep(0.5)
        return "done"

    result, timed_out = run_with_budget(slow, budget_ms=50)
    assert timed_out is True
    assert result is None


def test_run_with_budget_ok():
    result, timed_out = run_with_budget(lambda: 42, budget_ms=5000)
    assert timed_out is False
    assert result == 42


def test_troubleshoot_keyword_mode_has_retrieval():
    result = call_tool(
        "troubleshoot_olive_error",
        {
            "error_message": "CUDA out of memory during quantization",
            "mode": "keyword",
        },
    )
    assert "retrieval" in result
    assert result["retrieval"]["mode"] == "keyword"
    assert result["retrieval"]["effective"] == "keyword"
    assert result["retrieval"]["degraded"] is False


def test_troubleshoot_auto_budget_degraded(monkeypatch: pytest.MonkeyPatch):
    """Force budget timeout path when model is not loaded."""
    import numpy as np

    import olive_mcp_server.tools.embeddings as emb
    import olive_mcp_server.tools.troubleshooting as ts

    emb._model = None
    monkeypatch.setenv("OLIVE_MCP_SEMANTIC_BUDGET_MS", "50")

    def slow_scores(entries, error_only):
        import time

        time.sleep(2)
        n = len(list(entries))
        return list(entries), np.zeros((n, 384), dtype=np.float32)

    monkeypatch.setattr(ts, "_semantic_scores_for_entries", slow_scores)

    result = call_tool(
        "troubleshoot_olive_error",
        {
            "error_message": "CUDA out of memory during quantization",
            "mode": "auto",
        },
    )
    assert result["retrieval"]["degraded"] is True
    assert result["retrieval"]["reason"] == "semantic_budget_exceeded"
    assert result["retrieval"]["effective"] == "keyword"
    # Keyword path should still diagnose OOM (may match oom-quantization)
    assert isinstance(result.get("title"), str)
