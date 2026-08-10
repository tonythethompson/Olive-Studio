"""Phase 3: Autonomous agent job submission with polling to terminal state.

Submits a recipe to Olive Studio via the loopback bridge, then polls until
the job reaches a terminal state (completed / failed / cancelled) or the
effective timeout expires. Returns structured results including logs, metrics,
and artifact path references.

Tools:
  - execute_and_observe
"""

from __future__ import annotations

import logging
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any

from .studio_loopback import err, studio_request

logger = logging.getLogger(__name__)

_SUBMIT_PATH = "/api/olive/jobs/submit"
_STATUS_PATH = "/api/olive/agent/status"  # + /{job_id}

_TERMINAL_STATES = frozenset({"completed", "failed", "cancelled"})

# Poll cadence: start at 2s, double after each wait, cap at 30s.
# At the 1800s ceiling this is ~65 status polls instead of ~900 fixed 2s polls.
_POLL_INTERVAL_SECONDS = 2.0
_POLL_INTERVAL_MAX_SECONDS = 30.0
_POLL_BACKOFF_FACTOR = 2.0
_DEFAULT_TIMEOUT = 600
_MIN_TIMEOUT = 10
_MAX_TIMEOUT = 1800
_MAX_LOG_ENTRIES = 200


def _clamp_timeout(timeout: int | None) -> int:
    """Clamp user-provided timeout to [10, 1800]; default 600 when None."""
    effective = timeout if timeout is not None else _DEFAULT_TIMEOUT
    return min(max(effective, _MIN_TIMEOUT), _MAX_TIMEOUT)


def _next_poll_interval(current: float) -> float:
    """Return the next capped exponential poll interval."""
    return min(current * _POLL_BACKOFF_FACTOR, _POLL_INTERVAL_MAX_SECONDS)


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


@dataclass
class _PollState:
    """Latest observable state accumulated while polling one job."""

    started_at: float
    status: str = "pending"
    logs: list[str] = field(default_factory=list)
    metrics: dict[str, Any] | None = None
    exit_code: int | None = None

    def update(self, response: dict[str, Any]) -> None:
        """Apply one Studio status response to the accumulated state."""
        self.status = response.get("status", self.status)
        poll_logs = response.get("logs")
        if isinstance(poll_logs, list):
            self.logs = [str(line) for line in poll_logs]
        metrics = response.get("latestMetrics") or response.get("latest_metrics")
        if metrics is not None:
            self.metrics = metrics
        exit_code = response.get("exitCode")
        if exit_code is None:
            exit_code = response.get("exit_code")
        if exit_code is not None:
            self.exit_code = exit_code

    def elapsed_ms(self) -> int:
        """Return elapsed polling time in milliseconds."""
        return int((time.monotonic() - self.started_at) * 1000)


def _map_submission_error(response: dict[str, Any]) -> dict[str, Any]:
    """Map Studio submission failures to the public agent error contract."""
    studio_code = response.get("error", "")
    if studio_code in {"validation_error", "invalid_recipe"}:
        return err(
            "invalid_recipe",
            response.get("message", "Recipe validation failed."),
            detail=response.get("detail"),
        )
    if studio_code in {"forbidden", "mcp_access_disabled"}:
        return err(
            "submission_denied",
            response.get("message", "Agent job submission is not allowed by policy."),
            detail=response.get("detail"),
        )
    return response


def _poll_until_terminal(
    job_id: str,
    effective_timeout: int,
) -> tuple[_PollState, bool, dict[str, Any] | None]:
    """Poll a submitted job until it terminates, times out, or polling fails."""
    state = _PollState(started_at=time.monotonic())
    poll_interval = _POLL_INTERVAL_SECONDS

    while True:
        response = studio_request("GET", f"{_STATUS_PATH}/{job_id}")
        if _is_error(response):
            return state, False, response

        state.update(response)
        if state.status in _TERMINAL_STATES:
            return state, False, None

        remaining = effective_timeout - (time.monotonic() - state.started_at)
        if remaining <= 0:
            return state, True, None

        time.sleep(min(poll_interval, remaining))
        poll_interval = _next_poll_interval(poll_interval)


def _artifact_refs_from_logs(logs: list[str]) -> list[str]:
    """Extract up to 20 unique artifact basenames from job logs."""
    artifact_re = re.compile(
        r"(?P<path>(?:[A-Za-z]:)?[^\s\"']+\.(?:onnx|ort|mlpackage|bin|json|pt|safetensors))",
        re.IGNORECASE,
    )
    refs: list[str] = []
    seen: set[str] = set()
    for line in logs:
        for match in artifact_re.finditer(line):
            basename = _artifact_basename(match.group("path"))
            if basename and basename not in seen:
                seen.add(basename)
                refs.append(basename)
                if len(refs) == 20:
                    return refs
    return refs


def _observation_result(
    job_id: str,
    state: _PollState,
    timed_out: bool,
    poll_error: dict[str, Any] | None,
) -> dict[str, Any]:
    """Package accumulated poll state into the public tool response."""
    result: dict[str, Any] = {
        "status": state.status,
        "job_id": job_id,
        "exit_code": state.exit_code,
        "logs": state.logs[-_MAX_LOG_ENTRIES:],
        "metrics": state.metrics,
        "elapsed_ms": state.elapsed_ms(),
        "artifact_path_refs": [] if poll_error else _artifact_refs_from_logs(state.logs),
        "timed_out": timed_out,
        "side_effect": True,
    }
    if poll_error:
        result["poll_error"] = poll_error
    return result


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
            return _map_submission_error(submit_response)

        # --- Extract job_id from submission response ---
        job_id = submit_response.get("job_id") or submit_response.get("jobId")
        if not job_id:
            return err(
                "invalid_bridge_response",
                "Olive Studio submission response missing job_id.",
            )

        state, timed_out, poll_error = _poll_until_terminal(job_id, effective_timeout)
        return _observation_result(job_id, state, timed_out, poll_error)

    except Exception as exc:
        logger.warning("execute_and_observe unexpected error", exc_info=True)
        return {"error": "internal_error", "message": f"{type(exc).__name__}: {exc}"}
