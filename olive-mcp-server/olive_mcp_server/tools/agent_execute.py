"""Phase 3: Autonomous agent job submission with polling to terminal state.

Submits a recipe to Olive Studio via the loopback bridge, then polls until
the job reaches a terminal state (completed / failed / cancelled) or the
effective timeout expires. Returns structured results including logs, metrics,
and artifact path references.

Tools:
  - execute_and_observe
"""

from __future__ import annotations

import os
import re
import time
from typing import Any

from .studio_loopback import err, studio_request

_SUBMIT_PATH = "/api/olive/jobs/submit"
_STATUS_PATH = "/api/olive/agent/status"  # + /{job_id}

_TERMINAL_STATES = frozenset({"completed", "failed", "cancelled"})

_POLL_INTERVAL_SECONDS = 2
_DEFAULT_TIMEOUT = 600
_MIN_TIMEOUT = 10
_MAX_TIMEOUT = 1800
_MAX_LOG_ENTRIES = 200


def _clamp_timeout(timeout: int | None) -> int:
    """Clamp user-provided timeout to [10, 1800]; default 600 when None."""
    effective = timeout if timeout is not None else _DEFAULT_TIMEOUT
    return min(max(effective, _MIN_TIMEOUT), _MAX_TIMEOUT)


def _is_error(payload: dict[str, Any]) -> bool:
    """Check if a bridge response is an error (has non-empty 'error' key)."""
    err_val = payload.get("error")
    return isinstance(err_val, str) and bool(err_val)


def _artifact_basename(path: str) -> str:
    """Extract basename from an artifact path reference."""
    if not path:
        return path
    normalized = path.replace("\\", "/")
    return os.path.basename(normalized) or path


def execute_and_observe(
    recipe: dict[str, Any],
    timeout: int | None = None,
) -> dict[str, Any]:
    """Submit a recipe to Olive Studio and poll until terminal state or timeout.

    Args:
        recipe: A complete Olive optimization configuration JSON.
        timeout: Polling timeout in seconds, clamped to [10, 1800]. Default 600.

    Returns:
        Structured result with job status, logs, metrics, and artifact refs on
        success (includes ``side_effect: True``). On pre-submission errors,
        returns a structured error without the ``side_effect`` field.
    """
    try:
        effective_timeout = _clamp_timeout(timeout)

        # --- Submit the recipe ---
        submit_response = studio_request(
            "POST",
            _SUBMIT_PATH,
            body={"recipe": recipe},
            timeout=120.0,  # submission may take time (env setup)
        )

        if _is_error(submit_response):
            # Map known Studio error codes to agent-facing codes
            studio_code = submit_response.get("error", "")
            if studio_code in ("validation_error", "invalid_recipe"):
                return err(
                    "invalid_recipe",
                    submit_response.get("message", "Recipe validation failed."),
                    detail=submit_response.get("detail"),
                )
            if studio_code == "submission_denied":
                return submit_response
            if studio_code == "studio_unavailable":
                return submit_response
            if studio_code in ("forbidden", "mcp_access_disabled"):
                return err(
                    "submission_denied",
                    submit_response.get("message", "Agent job submission is not allowed by policy."),
                    detail=submit_response.get("detail"),
                )
            # Pass through other structured errors from Studio
            return submit_response

        # --- Extract job_id from submission response ---
        job_id = submit_response.get("job_id") or submit_response.get("jobId")
        if not job_id:
            return err(
                "invalid_bridge_response",
                "Olive Studio submission response missing job_id.",
            )

        # --- Poll until terminal state or timeout ---
        start_time = time.monotonic()
        last_status: str = "pending"
        all_logs: list[str] = []
        last_metrics: dict[str, Any] | None = None
        last_exit_code: int | None = None
        last_artifact_paths: list[str] = []
        timed_out = False

        while True:
            elapsed_seconds = time.monotonic() - start_time

            status_response = studio_request(
                "GET",
                f"{_STATUS_PATH}/{job_id}",
            )

            if _is_error(status_response):
                # If we can't poll, return what we have with the error context
                return {
                    "status": last_status,
                    "job_id": job_id,
                    "exit_code": last_exit_code,
                    "logs": all_logs[-_MAX_LOG_ENTRIES:],
                    "metrics": last_metrics,
                    "elapsed_ms": int((time.monotonic() - start_time) * 1000),
                    "artifact_path_refs": last_artifact_paths,
                    "timed_out": False,
                    "side_effect": True,
                    "poll_error": status_response,
                }

            # Update state from poll response
            current_status = status_response.get("status", last_status)
            last_status = current_status

            # Collect logs (deduplicated by accumulating all)
            poll_logs = status_response.get("logs")
            if isinstance(poll_logs, list):
                all_logs = [str(line) for line in poll_logs]

            # Capture metrics
            metrics = status_response.get("latestMetrics") or status_response.get("latest_metrics")
            if metrics is not None:
                last_metrics = metrics

            # Capture exit code, preserving a successful zero value
            exit_code = status_response.get("exitCode")
            if exit_code is None:
                exit_code = status_response.get("exit_code")
            if exit_code is not None:
                last_exit_code = exit_code

            # Check for terminal state
            if current_status in _TERMINAL_STATES:
                break

            # Check timeout (terminal state at boundary wins)
            elapsed_seconds = time.monotonic() - start_time
            if elapsed_seconds >= effective_timeout:
                timed_out = True
                break

            # Wait before next poll
            time.sleep(_POLL_INTERVAL_SECONDS)

        # --- Extract artifact path refs from logs (basenames only) ---
        artifact_refs: list[str] = []
        seen: set[str] = set()
        # Simple heuristic: look for common model artifact extensions in log lines
        artifact_re = re.compile(
            r"(?P<path>(?:[A-Za-z]:)?[^\s\"']+\.(?:onnx|ort|mlpackage|bin|json|pt|safetensors))",
            re.IGNORECASE,
        )
        for line in all_logs:
            for match in artifact_re.finditer(line):
                basename = _artifact_basename(match.group("path"))
                if basename and basename not in seen and len(artifact_refs) < 20:
                    seen.add(basename)
                    artifact_refs.append(basename)

        return {
            "status": last_status,
            "job_id": job_id,
            "exit_code": last_exit_code,
            "logs": all_logs[-_MAX_LOG_ENTRIES:],
            "metrics": last_metrics,
            "elapsed_ms": int((time.monotonic() - start_time) * 1000),
            "artifact_path_refs": artifact_refs,
            "timed_out": timed_out,
            "side_effect": True,
        }

    except Exception as exc:
        return {"error": "internal_error", "message": f"{type(exc).__name__}: {exc}"}
