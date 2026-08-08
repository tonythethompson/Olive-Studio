"""Phase 2: read-only optimization job inspection via Olive Studio.

MCP never executes Olive. These tools call Studio's in-memory job registry
over the loopback HTTP API (``OLIVE_STUDIO_API_URL`` only).

Tools:
  - list_optimization_jobs
  - get_optimization_job
  - get_optimization_results
"""

from __future__ import annotations

import re
from typing import Any

from .studio_loopback import DEFAULT_TIMEOUT_SECONDS, err, studio_request

_JOBS_PATH = "/api/olive/jobs"
_STATUS_PATH = "/api/olive/status"  # + /{job_id}

# Heuristic paths mentioned in logs (metadata only — never file contents).
_PATH_RE = re.compile(
    r"(?P<path>(?:[A-Za-z]:)?[^\s\"']+\.(?:onnx|ort|mlpackage|bin|json|pt|safetensors))",
    re.IGNORECASE,
)

_TERMINAL = frozenset({"completed", "failed", "cancelled"})


def _is_error(payload: dict[str, Any]) -> bool:
    return isinstance(payload.get("error"), str) and payload["error"]


def list_optimization_jobs(limit: int = 50) -> dict[str, Any]:
    """List recent Olive Studio optimization jobs (read-only).

    Args:
        limit: Max jobs to return (newest first). Clamped to 1..200.

    Returns:
        ``{ jobs, count, total }`` or a structured Studio error.
    """
    if limit < 1:
        limit = 1
    if limit > 200:
        limit = 200

    payload = studio_request("GET", _JOBS_PATH, timeout=DEFAULT_TIMEOUT_SECONDS)
    if _is_error(payload):
        return payload

    if not payload.get("ok") and "jobs" not in payload:
        return err(
            "invalid_bridge_response",
            "Olive Studio job list payload missing jobs array.",
        )

    jobs = payload.get("jobs")
    if not isinstance(jobs, list):
        return err(
            "invalid_bridge_response",
            "Olive Studio job list payload missing jobs array.",
        )

    total = len(jobs)
    sliced = jobs[:limit]
    return {
        "count": len(sliced),
        "total": total if isinstance(payload.get("count"), int) else total,
        "jobs": sliced,
        "side_effect": False,
        "note": "Read-only inspection of Studio's in-memory job registry.",
    }


def get_optimization_job(job_id: str) -> dict[str, Any]:
    """Fetch status for one Studio optimization job (read-only).

    Args:
        job_id: Job id returned by Studio when a run was started.

    Returns:
        Job status projection, or a structured error.
    """
    jid = (job_id or "").strip()
    if not jid:
        return err("invalid_job_id", "job_id is required.")

    payload = studio_request(
        "GET",
        f"{_STATUS_PATH}/{jid}",
        timeout=DEFAULT_TIMEOUT_SECONDS,
    )
    if _is_error(payload):
        # Map 404-style error strings to a stable code when present.
        if payload.get("error") == "Job not found":
            return err("job_not_found", "No job with that id in Studio's registry.", detail=jid)
        return payload

    if "id" not in payload and "status" not in payload:
        return err(
            "invalid_bridge_response",
            "Olive Studio job status payload missing id/status.",
        )

    logs = payload.get("logs") if isinstance(payload.get("logs"), list) else []
    return {
        "id": payload.get("id", jid),
        "status": payload.get("status"),
        "exit_code": payload.get("exitCode", payload.get("exit_code")),
        "finished_at": payload.get("finishedAt", payload.get("finished_at")),
        "logs_truncated": bool(payload.get("logsTruncated", payload.get("logs_truncated"))),
        "log_count": len(logs),
        "has_metrics": payload.get("latestMetrics") is not None
        or payload.get("latest_metrics") is not None,
        "latest_metrics": payload.get("latestMetrics", payload.get("latest_metrics")),
        "terminal": str(payload.get("status") or "") in _TERMINAL,
        "side_effect": False,
    }


def validate_optimization_job(
    recipe: dict[str, Any] | None = None,
    recipe_json: str = "",
    cuda_version: str = "auto",
) -> dict[str, Any]:
    """Validate a recipe via Studio preflight (no Olive spawn).

    Args:
        recipe: Olive recipe object.
        recipe_json: Alternative JSON string form of the recipe.
        cuda_version: Optional CUDA wheel token (default ``auto``).

    Returns:
        ``valid``, ``fingerprint``, ``errors``, ``warnings``, etc.
        Never starts a job.
    """
    body: dict[str, Any] = {"cudaVersion": cuda_version or "auto"}
    if recipe is not None:
        body["recipe"] = recipe
    elif (recipe_json or "").strip():
        body["recipeJson"] = recipe_json
    else:
        return err("invalid_recipe", "recipe or recipe_json is required.")

    payload = studio_request("POST", "/api/olive/jobs/validate", body=body, timeout=DEFAULT_TIMEOUT_SECONDS)
    if _is_error(payload) and "valid" not in payload:
        return payload

    return {
        "valid": bool(payload.get("valid")),
        "fingerprint": payload.get("fingerprint"),
        "provider": payload.get("provider"),
        "errors": payload.get("errors") or [],
        "warnings": payload.get("warnings") or [],
        "cuda_version": payload.get("cudaVersion", cuda_version),
        "recipe_summary": payload.get("recipe_summary"),
        "side_effect": False,
        "note": "Validation only — does not start Olive. Use submit_optimization_job to execute.",
    }


def submit_optimization_job(
    recipe: dict[str, Any] | None = None,
    recipe_json: str = "",
    cuda_version: str = "auto",
    fingerprint: str = "",
    idempotency_key: str = "",
) -> dict[str, Any]:
    """Submit a job through Studio (policy-gated). Always means execute.

    Idempotency: pass ``idempotency_key`` and/or ``fingerprint`` from validate.
    Replays return the same ``job_id`` without starting a second run.
    """
    body: dict[str, Any] = {"cudaVersion": cuda_version or "auto"}
    if recipe is not None:
        body["recipe"] = recipe
    elif (recipe_json or "").strip():
        body["recipeJson"] = recipe_json
    else:
        return err("invalid_recipe", "recipe or recipe_json is required.")
    if (fingerprint or "").strip():
        body["fingerprint"] = fingerprint.strip()
    if (idempotency_key or "").strip():
        body["idempotencyKey"] = idempotency_key.strip()

    payload = studio_request(
        "POST",
        "/api/olive/jobs/submit",
        body=body,
        timeout=120.0,  # env setup may take time before job_id returns
    )
    if _is_error(payload) and not payload.get("ok") and "job_id" not in payload and "jobId" not in payload:
        # 403 policy etc.
        if payload.get("error") in ("forbidden", "mcp_access_disabled"):
            return payload
        if payload.get("error") == "studio_unavailable":
            return payload
        # Keep structured submit failures
        if payload.get("ok") is False:
            return {
                "ok": False,
                "error": payload.get("error") or "submit_failed",
                "message": payload.get("error") or payload.get("message"),
                "job_id": payload.get("jobId") or payload.get("job_id"),
                "fingerprint": payload.get("fingerprint"),
                "side_effect": True,
            }
        return payload

    job_id = payload.get("job_id") or payload.get("jobId")
    return {
        "ok": bool(payload.get("ok", True)),
        "job_id": job_id,
        "state": payload.get("state") or payload.get("status") or "queued",
        "fingerprint": payload.get("fingerprint"),
        "reused": bool(payload.get("reused")),
        "submitted_at": payload.get("submitted_at"),
        "side_effect": True,
        "note": "Job submitted via Studio. Poll get_optimization_job; do not hold this call open for the full run.",
    }


def cancel_optimization_job(job_id: str) -> dict[str, Any]:
    """Cancel a Studio job (policy-gated when called as MCP client)."""
    jid = (job_id or "").strip()
    if not jid:
        return err("invalid_job_id", "job_id is required.")

    payload = studio_request(
        "POST",
        "/api/olive/cancel",
        body={"jobId": jid, "client": "mcp"},
        timeout=DEFAULT_TIMEOUT_SECONDS,
    )
    if _is_error(payload) and payload.get("ok") is not True:
        if payload.get("error") == "Job not found":
            return err("job_not_found", "No job with that id in Studio's registry.", detail=jid)
        return payload

    return {
        "ok": True,
        "job_id": jid,
        "status": payload.get("status"),
        "side_effect": True,
    }


def get_optimization_results(job_id: str, log_tail: int = 40) -> dict[str, Any]:
    """Return metadata-only results for a Studio job (read-only).

    Does **not** return model file bytes. Includes status, metrics, a log tail,
    and path-like references scraped from logs when present.

    Args:
        job_id: Studio job id.
        log_tail: Number of trailing log lines to include (0..200).
    """
    jid = (job_id or "").strip()
    if not jid:
        return err("invalid_job_id", "job_id is required.")

    if log_tail < 0:
        log_tail = 0
    if log_tail > 200:
        log_tail = 200

    payload = studio_request(
        "GET",
        f"{_STATUS_PATH}/{jid}",
        timeout=DEFAULT_TIMEOUT_SECONDS,
    )
    if _is_error(payload):
        if payload.get("error") == "Job not found":
            return err("job_not_found", "No job with that id in Studio's registry.", detail=jid)
        return payload

    logs = payload.get("logs") if isinstance(payload.get("logs"), list) else []
    log_lines = [str(line) for line in logs]
    tail = log_lines[-log_tail:] if log_tail else []

    artifact_refs: list[str] = []
    seen: set[str] = set()
    for line in log_lines:
        for match in _PATH_RE.finditer(line):
            p = match.group("path")
            if p not in seen and len(artifact_refs) < 20:
                seen.add(p)
                artifact_refs.append(p)

    status = payload.get("status")
    return {
        "id": payload.get("id", jid),
        "status": status,
        "exit_code": payload.get("exitCode", payload.get("exit_code")),
        "finished_at": payload.get("finishedAt", payload.get("finished_at")),
        "terminal": str(status or "") in _TERMINAL,
        "logs_truncated": bool(payload.get("logsTruncated", payload.get("logs_truncated"))),
        "log_count": len(log_lines),
        "log_tail": tail,
        "latest_metrics": payload.get("latestMetrics", payload.get("latest_metrics")),
        "artifact_path_refs": artifact_refs,
        "note": (
            "Metadata only — model artifacts and full logs are not transferred over MCP. "
            "Paths are heuristic references from log lines."
        ),
        "side_effect": False,
    }
