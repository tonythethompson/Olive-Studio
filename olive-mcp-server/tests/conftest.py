"""Shared pytest fixtures for olive-mcp-server tests."""

from __future__ import annotations

import time
from collections.abc import Callable, Iterator

import pytest

from olive_mcp_server.tools import retrieval

# Generous ceiling for abandoned budget workers (tests use ≤0.55s sleeps today).
_INFLIGHT_DRAIN_TIMEOUT_S = 5.0


def wait_for_inflight_semantic_clear(
    *,
    timeout_s: float = _INFLIGHT_DRAIN_TIMEOUT_S,
) -> None:
    """
    Poll retrieval single-flight state until the tracked future is idle.

    Clears a done future so the next ``run_with_budget`` call is not stuck on
    a stale handle. Fails if work is still active after ``timeout_s``.
    """
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        with retrieval._INFLIGHT_LOCK:
            fut = retrieval._INFLIGHT_FUTURE
            if fut is None or fut.done():
                retrieval._INFLIGHT_FUTURE = None
                return
        time.sleep(0.05)
    with retrieval._INFLIGHT_LOCK:
        fut = retrieval._INFLIGHT_FUTURE
    raise AssertionError(
        f"semantic budget worker still in flight after {timeout_s}s "
        f"(future={fut!r})"
    )


@pytest.fixture
def wait_inflight_semantic_clear() -> Callable[..., None]:
    """Expose the drain helper to tests that must wait mid-body."""
    return wait_for_inflight_semantic_clear


@pytest.fixture(autouse=True)
def _drain_semantic_inflight_between_tests() -> Iterator[None]:
    """Ensure no abandoned ``run_with_budget`` worker leaks across tests."""
    wait_for_inflight_semantic_clear()
    yield
    wait_for_inflight_semantic_clear()
