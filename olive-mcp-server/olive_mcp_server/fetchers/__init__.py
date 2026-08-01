"""Fetchers for updating the Olive MCP knowledge base from external sources."""

from __future__ import annotations

from typing import Any

from .._lazy import resolve_lazy_attr

_LAZY: dict[str, tuple[str, str]] = {
    "fetch_official_docs": (".official_docs_fetcher", "fetch_official_docs"),
    "fetch_github_issues": (".github_scraper", "fetch_github_issues"),
    "fetch_onnx_runtime_docs": (".onnx_runtime_fetcher", "fetch_onnx_runtime_docs"),
}
_cache: dict[str, Any] = {}


def __getattr__(name: str) -> Any:
    value = resolve_lazy_attr(name, _LAZY, _cache, __name__)
    if value is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    return value


__all__ = ["fetch_github_issues", "fetch_official_docs", "fetch_onnx_runtime_docs"]
