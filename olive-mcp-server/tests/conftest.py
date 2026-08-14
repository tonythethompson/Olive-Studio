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


@pytest.fixture(scope="session", autouse=True)
def _warm_embedding_model_once() -> None:
    """
    Load the real embedding model once, outside any single test's budget.

    Whichever test first triggers an unmocked "auto"-mode semantic call pays
    for the model's first-use load (network fetch + weights load), which is
    a real network/disk-bound operation that can take longer than the
    per-test inflight-drain ceiling (``_INFLIGHT_DRAIN_TIMEOUT_S``). Loading
    it once, up front, with no timeout budget, means every test's own
    "auto"-mode calls only pay for fast inference afterwards, whichever test
    happens to run first.
    """
    try:
        from olive_mcp_server.tools.embeddings import _get_model

        _get_model()
    except Exception:
        # Offline/sandboxed environments: leave lazy-load behavior as-is;
        # individual tests that need semantic mode already mock it out.
        pass
