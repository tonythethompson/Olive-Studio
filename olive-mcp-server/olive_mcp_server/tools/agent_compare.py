"""Phase 3: Multi-job comparison with preference-weighted scoring.

Fetches results for multiple completed optimization jobs, normalizes metrics,
applies preference weighting, and selects a winner. Non-terminal, failed, or
unfetchable jobs are excluded with reasons.

Tools:
  - compare_results
"""

from __future__ import annotations

import logging
import re
from typing import Any

from .studio_loopback import err, studio_request

logger = logging.getLogger(__name__)

_STATUS_PATH = "/api/olive/agent/status"  # + /{job_id}

_VALID_PREFERENCES = frozenset({"latency", "size", "accuracy", "balanced"})
_JOB_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
_TERMINAL_STATES = frozenset({"completed", "failed", "cancelled"})

_MIN_JOBS = 2
_MAX_JOBS = 10


def _is_error(payload: dict[str, Any]) -> bool:
    """Check if a bridge response is an error (has non-empty 'error' key)."""
    err_val = payload.get("error")
    return isinstance(err_val, str) and bool(err_val)


def _extract_metrics(job_response: dict[str, Any]) -> dict[str, float | None]:
    """Extract scoring metrics from a job status response.

    Looks for latency_ms, model_size_mb, and accuracy in the latestMetrics
    field (or latest_metrics fallback).
    """
    raw = job_response.get("latestMetrics") or job_response.get("latest_metrics") or {}
    if not isinstance(raw, dict):
        raw = {}

    def _as_float(val: Any) -> float | None:
        if val is None:
            return None
        try:
            f = float(val)
            # Reject NaN/inf as non-scoreable
            if f != f or f == float("inf") or f == float("-inf"):
                return None
            return f
        except (TypeError, ValueError):
            return None

    return {
        "latency_ms": _as_float(raw.get("latency_ms")),
        "model_size_mb": _as_float(raw.get("model_size_mb")),
        "accuracy": _as_float(raw.get("accuracy")),
    }


def _normalize_and_score(
    scoreable: list[dict[str, Any]],
    preference: str,
) -> list[dict[str, Any]]:
    """Min-max normalize metrics and compute weighted scores.

    For latency and size: lower is better → invert (1 - normalized).
    For accuracy: higher is better → use normalized directly.
    Preference weighting: specified metric gets 2x, others 1x; balanced = all 1x.
    Missing metrics are skipped in the average.
    """
    metric_keys = ["latency_ms", "model_size_mb", "accuracy"]
    # Metrics where lower is better (inverted after normalization)
    invert_set = {"latency_ms", "model_size_mb"}

    # Collect raw metric values across scoreable jobs
    raw_values: dict[str, list[float]] = {k: [] for k in metric_keys}
    for entry in scoreable:
        metrics = entry["metrics"]
        for k in metric_keys:
            val = metrics.get(k)
            if val is not None:
                raw_values[k].append(val)

    # Compute min/max per metric
    metric_min: dict[str, float] = {}
    metric_max: dict[str, float] = {}
    for k in metric_keys:
        vals = raw_values[k]
        if vals:
            metric_min[k] = min(vals)
            metric_max[k] = max(vals)

    # Determine weights
    weights: dict[str, float] = {}
    for k in metric_keys:
        if preference == "balanced":
            weights[k] = 1.0
        elif preference == "latency" and k == "latency_ms":
            weights[k] = 2.0
        elif preference == "size" and k == "model_size_mb":
            weights[k] = 2.0
        elif preference == "accuracy" and k == "accuracy":
            weights[k] = 2.0
        else:
            weights[k] = 1.0

    # Score each job
    results: list[dict[str, Any]] = []
    for entry in scoreable:
        metrics = entry["metrics"]
        weighted_sum = 0.0
        total_weight = 0.0

        for k in metric_keys:
            val = metrics.get(k)
            if val is None:
                continue
            mn = metric_min.get(k)
            mx = metric_max.get(k)
            if mn is None or mx is None:
                continue

            # Normalize to [0, 1]
            if mx == mn:
                normalized = 1.0  # All values equal → full score
            else:
                normalized = (val - mn) / (mx - mn)

            # Invert for lower-is-better metrics
            if k in invert_set:
                normalized = 1.0 - normalized

            w = weights[k]
            weighted_sum += normalized * w
            total_weight += w

        score = weighted_sum / total_weight if total_weight > 0 else 0.0

        results.append({
            "job_id": entry["job_id"],
            "status": entry["status"],
            "metrics": metrics,
            "score": round(score, 6),
        })

    return results


def _generate_reasoning(
    scored: list[dict[str, Any]],
    winner: str | None,
    preference: str,
    excluded_count: int,
) -> str:
    """Generate a human-readable reasoning string for the comparison."""
    parts: list[str] = []

    if not winner:
        if not scored:
            parts.append("No jobs could be scored.")
        else:
            parts.append("Fewer than 2 jobs were scoreable, so no winner could be determined.")
        if excluded_count > 0:
            parts.append(f"{excluded_count} job(s) were excluded from scoring.")
        return " ".join(parts)

    parts.append(f"Winner: {winner} (preference: {preference}).")
    if len(scored) > 1:
        winner_entry = next((s for s in scored if s["job_id"] == winner), None)
        if winner_entry:
            parts.append(f"Score: {winner_entry['score']:.4f}.")
    if excluded_count > 0:
        parts.append(f"{excluded_count} job(s) excluded from scoring.")
    return " ".join(parts)


def compare_results(
    job_ids: list[str],
    preference: str = "balanced",
) -> dict[str, Any]:
    """Compare multiple optimization job results with preference-weighted scoring.

    Args:
        job_ids: List of 2–10 job IDs to compare.
        preference: Scoring preference — "latency", "size", "accuracy", or "balanced".

    Returns:
        Structured comparison with scored jobs, winner, reasoning, excluded jobs,
        and the effective preference. Always includes ``side_effect: False``.
    """
    try:
        # --- Input validation ---
        if not isinstance(job_ids, list) or not (_MIN_JOBS <= len(job_ids) <= _MAX_JOBS):
            return err(
                "invalid_job_count",
                f"job_ids must contain {_MIN_JOBS}\u2013{_MAX_JOBS} entries.",
            )

        # Validate each job_id format
        for jid in job_ids:
            if not isinstance(jid, str) or not _JOB_ID_PATTERN.match(jid):
                return err("invalid_job_id", f"Invalid job_id: {jid}")

        # Normalize preference
        effective_preference = preference if preference in _VALID_PREFERENCES else "balanced"

        # --- Fetch job statuses ---
        excluded_jobs: list[dict[str, str]] = []
        scoreable: list[dict[str, Any]] = []

        for jid in job_ids:
            response = studio_request("GET", f"{_STATUS_PATH}/{jid}")

            if _is_error(response):
                excluded_jobs.append({"job_id": jid, "reason": "fetch_failed"})
                continue

            status = response.get("status", "unknown")

            if status in {"failed", "cancelled"}:
                excluded_jobs.append({"job_id": jid, "reason": f"job_{status}"})
                continue

            if status != "completed":
                reason = f"status_{status}" if status != "unknown" else "status_unknown"
                excluded_jobs.append({"job_id": jid, "reason": reason})
                continue

            # A completed job is comparable only when it exposes at least one
            # optimization metric. latestMetrics is GPU sampling telemetry, so
            # do not treat an empty telemetry payload as a scored result.
            metrics = _extract_metrics(response)
            if not any(value is not None for value in metrics.values()):
                excluded_jobs.append({"job_id": jid, "reason": "no_comparable_metrics"})
                continue
            scoreable.append({
                "job_id": jid,
                "status": status,
                "metrics": metrics,
            })

        # --- Score and select winner ---
        if len(scoreable) < 2:
            # Not enough scoreable jobs for comparison
            comparison = []
            for entry in scoreable:
                comparison.append({
                    "job_id": entry["job_id"],
                    "status": entry["status"],
                    "metrics": entry["metrics"],
                    "score": 0.0,
                })

            return {
                "comparison": comparison,
                "winner": None,
                "reasoning": _generate_reasoning(comparison, None, effective_preference, len(excluded_jobs)),
                "excluded_jobs": excluded_jobs,
                "preference": effective_preference,
                "side_effect": False,
            }

        scored = _normalize_and_score(scoreable, effective_preference)

        # Select winner (highest score)
        winner_entry = max(scored, key=lambda x: x["score"])
        winner = winner_entry["job_id"]

        reasoning = _generate_reasoning(scored, winner, effective_preference, len(excluded_jobs))

        return {
            "comparison": scored,
            "winner": winner,
            "reasoning": reasoning,
            "excluded_jobs": excluded_jobs,
            "preference": effective_preference,
            "side_effect": False,
        }

    except Exception as exc:
        logger.warning("compare_results unexpected error", exc_info=True)
        return {"error": "internal_error", "message": f"{type(exc).__name__}: {exc}"}
