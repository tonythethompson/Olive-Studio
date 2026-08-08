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

# Single shared pool for budgeted semantic work so concurrent auto-mode
# timeouts cannot stack many MiniLM loads (one per abandoned ThreadPoolExecutor).
_SEMANTIC_BUDGET_POOL = concurrent.futures.ThreadPoolExecutor(
    max_workers=1,
    thread_name_prefix="olive-mcp-semantic-budget",
)


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

    On timeout the shared worker is not cancelled mid-flight (MiniLM load may
    still finish); further budgeted work queues behind it (``max_workers=1``)
    so concurrent timeouts do not stack multiple model loads.
    """
    if budget_ms <= 0:
        return fn(), False

    timeout_s = budget_ms / 1000.0
    future = _SEMANTIC_BUDGET_POOL.submit(fn)
    try:
        return future.result(timeout=timeout_s), False
    except concurrent.futures.TimeoutError:
        return None, True


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
