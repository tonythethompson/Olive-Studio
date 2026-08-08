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
from collections.abc import Callable
from typing import Any, TypeVar

T = TypeVar("T")

VALID_MODES = frozenset({"auto", "keyword", "semantic"})
DEFAULT_MODE = "auto"
DEFAULT_SEMANTIC_BUDGET_MS = 8000


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


def run_with_budget(fn: Callable[[], T], budget_ms: int) -> tuple[T | None, bool]:
    """Run *fn* with an optional wall-clock budget.

    Returns:
        (result, timed_out). On timeout, result is None and timed_out is True.
        On success, timed_out is False. Exceptions from *fn* propagate.

    On timeout the worker is abandoned (``shutdown(wait=False)``) so the tool
    can return immediately; the OS reclaims the thread when work finishes.
    """
    if budget_ms <= 0:
        return fn(), False

    timeout_s = budget_ms / 1000.0
    # Do not use context-manager executor: on TimeoutError, ``__exit__`` would
    # wait for the still-running worker (defeating the budget).
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    future = pool.submit(fn)
    try:
        result = future.result(timeout=timeout_s)
        pool.shutdown(wait=False, cancel_futures=True)
        return result, False
    except concurrent.futures.TimeoutError:
        pool.shutdown(wait=False, cancel_futures=True)
        return None, True
    except Exception:
        pool.shutdown(wait=False, cancel_futures=True)
        raise


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
