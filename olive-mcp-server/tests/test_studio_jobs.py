"""Phase 2 read-only job inspection tools."""

from __future__ import annotations

import pytest

from olive_mcp_server.mcp_server import _TOOL_IMPORTS, call_tool
from olive_mcp_server.tools import studio_jobs


def test_job_tools_registered():
    for name in (
        "list_optimization_jobs",
        "get_optimization_job",
        "get_optimization_results",
    ):
        assert name in _TOOL_IMPORTS


def test_list_jobs_studio_unavailable(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("OLIVE_STUDIO_API_URL", raising=False)
    result = studio_jobs.list_optimization_jobs()
    assert result.get("error") == "studio_unavailable"


def test_list_jobs_ok(monkeypatch: pytest.MonkeyPatch):
    def fake_request(method, path, **_kw):
        assert method == "GET"
        assert path == "/api/olive/jobs"
        return {
            "ok": True,
            "count": 2,
            "jobs": [
                {"id": "a", "status": "completed", "exitCode": 0},
                {"id": "b", "status": "running", "exitCode": None},
            ],
        }

    monkeypatch.setattr(studio_jobs, "studio_request", fake_request)
    result = studio_jobs.list_optimization_jobs(limit=1)
    assert result["count"] == 1
    assert result["total"] == 2
    assert result["jobs"][0]["id"] == "a"
    assert result["side_effect"] is False


def test_get_job_not_found(monkeypatch: pytest.MonkeyPatch):
    def fake_request(method, path, **_kw):
        return {"error": "Job not found"}

    monkeypatch.setattr(studio_jobs, "studio_request", fake_request)
    result = studio_jobs.get_optimization_job("missing")
    assert result["error"] == "job_not_found"


def test_get_job_ok(monkeypatch: pytest.MonkeyPatch):
    def fake_request(method, path, **_kw):
        assert path.endswith("/jid-1")
        return {
            "id": "jid-1",
            "status": "completed",
            "exitCode": 0,
            "logs": ["line1", "line2"],
            "logsTruncated": False,
            "latestMetrics": {"gpu": 1},
            "finishedAt": 123,
        }

    monkeypatch.setattr(studio_jobs, "studio_request", fake_request)
    result = studio_jobs.get_optimization_job("jid-1")
    assert result["id"] == "jid-1"
    assert result["status"] == "completed"
    assert result["terminal"] is True
    assert result["log_count"] == 2
    assert result["side_effect"] is False


def test_get_results_metadata_only(monkeypatch: pytest.MonkeyPatch):
    def fake_request(method, path, **_kw):
        return {
            "id": "jid-2",
            "status": "completed",
            "exitCode": 0,
            "logs": [
                "writing model to D:\\out\\model.onnx",
                "done",
            ],
            "latestMetrics": None,
        }

    monkeypatch.setattr(studio_jobs, "studio_request", fake_request)
    result = studio_jobs.get_optimization_results("jid-2", log_tail=1)
    assert result["log_tail"] == ["done"]
    assert any(p.endswith("model.onnx") for p in result["artifact_path_refs"])
    assert "Metadata only" in result["note"]
    assert result["side_effect"] is False


def test_get_job_empty_id():
    result = studio_jobs.get_optimization_job("  ")
    assert result["error"] == "invalid_job_id"


def test_call_tool_list_jobs_unavailable(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("OLIVE_STUDIO_API_URL", raising=False)
    result = call_tool("list_optimization_jobs", {})
    assert result.get("error") == "studio_unavailable"
