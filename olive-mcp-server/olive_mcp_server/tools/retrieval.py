"""Retrieval mode and semantic budget helpers (Phase 0).

Modes:
  - auto (default): semantic/hybrid when ready within budget; else keyword + degraded
  - keyword: never load embeddings
  - semantic: always attempt semantic (caller opts into wait)

Environment:
  OLIVE_MCP_RETRIEVAL_MODE=auto|keyword|semantic
  OLIVE_MCP_SEMANTIC_BUDGET_MS=8000  (auto mode cold-start budget; 0 = no limit)
"""

from __future__ import annotations

import concurrent.futures
import os
import threading
from collections.abc import Callable
from typing import Any, TypeVar

T = TypeVar("T")

VALID_MODES = frozenset({"auto", "keyword", "semantic"})
DEFAULT_MODE = "auto"
DEFAULT_SEMANTIC_BUDGET_MS = 8000

# Single shared pool for budgeted semantic work so concurrent auto-mode
# timeouts cannot stack many MiniLM loads (one per abandoned ThreadPoolExecutor).
_SEMANTIC_BUDGET_POOL = concurrent.futures.ThreadPoolExecutor(
    max_workers=1,
    thread_name_prefix="olive-mcp-semantic-budget",
)

# Single-flight: at most one budgeted callable is tracked. Timed-out work may
# still be running; further callers get an immediate keyword-fallback signal
# instead of queueing another MiniLM load behind it.
_INFLIGHT_LOCK = threading.Lock()
_INFLIGHT_FUTURE: concurrent.futures.Future[Any] | None = None


def get_retrieval_mode(override: str | None = None) -> str:
    """Return effective retrieval mode from override or environment."""
    if override is not None and str(override).strip():
        raw = str(override).strip().lower()
    else:
        raw = os.environ.get("OLIVE_MCP_RETRIEVAL_MODE", DEFAULT_MODE).strip().lower()
    if raw in VALID_MODES:
        return raw
    return DEFAULT_MODE


def get_semantic_budget_ms() -> int:
    """Max ms for cold semantic work under auto mode (0 = unlimited)."""
    raw = os.environ.get("OLIVE_MCP_SEMANTIC_BUDGET_MS", str(DEFAULT_SEMANTIC_BUDGET_MS))
    try:
        return max(0, int(raw))
    except (TypeError, ValueError):
        return DEFAULT_SEMANTIC_BUDGET_MS


def _clear_inflight_if_current(future: concurrent.futures.Future[Any]) -> None:
    global _INFLIGHT_FUTURE
    with _INFLIGHT_LOCK:
        if _INFLIGHT_FUTURE is future:
            _INFLIGHT_FUTURE = None


def run_with_budget(fn: Callable[[], T], budget_ms: int) -> tuple[T | None, bool]:
    """Run *fn* with an optional wall-clock budget.

    Returns:
        (result, timed_out). On timeout (or while another budgeted call is still
        in flight), result is None and timed_out is True — callers treat that as
        the keyword-fallback signal. On success, timed_out is False. Exceptions
        from *fn* propagate.

    On timeout the shared worker is not cancelled mid-flight (MiniLM load may
    still finish). Only one in-flight future is tracked; additional calls during
    that window do not submit another callable.
    """
    if budget_ms <= 0:
        return fn(), False

    timeout_s = budget_ms / 1000.0
    global _INFLIGHT_FUTURE

    with _INFLIGHT_LOCK:
        if _INFLIGHT_FUTURE is not None and _INFLIGHT_FUTURE.done():
            _INFLIGHT_FUTURE = None
        if _INFLIGHT_FUTURE is not None and not _INFLIGHT_FUTURE.done():
            # Already running (often a prior timeout). Do not queue another load.
            return None, True
        future = _SEMANTIC_BUDGET_POOL.submit(fn)
        _INFLIGHT_FUTURE = future

    try:
        result = future.result(timeout=timeout_s)
    except concurrent.futures.TimeoutError:
        future.add_done_callback(_clear_inflight_if_current)
        return None, True
    except Exception:
        _clear_inflight_if_current(future)
        raise
    else:
        _clear_inflight_if_current(future)
        return result, False


def retrieval_meta(
    *,
    mode: str,
    effective: str,
    degraded: bool = False,
    reason: str | None = None,
) -> dict[str, Any]:
    """Build a stable retrieval metadata object for tool responses."""
    out: dict[str, Any] = {
        "mode": mode,
        "effective": effective,
        "degraded": bool(degraded),
    }
    if reason:
        out["reason"] = reason
    return out
