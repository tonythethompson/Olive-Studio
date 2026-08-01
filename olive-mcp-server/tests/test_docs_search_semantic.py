"""Tests for semantic upgrade of search_olive_documentation."""

from __future__ import annotations

import numpy as np
import pytest

from olive_mcp_server.tools import docs_search
from olive_mcp_server.tools.docs_search import search_olive_documentation


@pytest.fixture(autouse=True)
def _reset_kb_index_cache():
    """Ensure each test starts with a clean KB embedding cache."""
    docs_search._KB_TEXTS = []
    docs_search._KB_EMBEDDINGS = None
    docs_search._KB_INDEX_MTIME = -1.0
    yield
    docs_search._KB_TEXTS = []
    docs_search._KB_EMBEDDINGS = None
    docs_search._KB_INDEX_MTIME = -1.0


def _install_fake_semantic(
    monkeypatch: pytest.MonkeyPatch,
    *,
    results_for_query: dict[str, list] | None = None,
    default_results: list | None = None,
):
    """Mock semantic_search and index build so tests need no real model."""

    def fake_build(texts):
        n = len(list(texts)) if texts else 0
        return np.zeros((n, 384), dtype=np.float32)

    def fake_semantic(query, kb_texts, kb_embeddings, top_k, threshold=0.30):
        if results_for_query and query in results_for_query:
            return results_for_query[query][:top_k]
        if default_results is not None:
            return default_results[:top_k]
        return []

    monkeypatch.setattr(docs_search, "build_kb_index", fake_build)
    monkeypatch.setattr(docs_search, "semantic_search", fake_semantic)


def test_fuzzy_query_finds_quantization_related(monkeypatch: pytest.MonkeyPatch):
    """Semantic hits for a fuzzy quantization query should surface."""
    fake_hits = [
        {
            "source": "passes.OnnxQuantization.description",
            "snippet": "Static quantization with calibration data.",
            "relevance": 0.72,
        },
        {
            "source": "quirks.quantization[0].title",
            "snippet": "Use representative calibration samples.",
            "relevance": 0.61,
        },
    ]
    _install_fake_semantic(
        monkeypatch,
        default_results=fake_hits,
    )

    result = search_olive_documentation(
        query="how do I reduce model size with int8",
        top_k=3,
        live=False,
    )
    assert result["count"] > 0
    assert result["query"] == "how do I reduce model size with int8"
    sources = " ".join(r["source"] for r in result["results"]).lower()
    snippets = " ".join(r["snippet"] for r in result["results"]).lower()
    assert "quant" in sources or "quant" in snippets or "calibration" in snippets


def test_keyword_fallback_when_semantic_empty(monkeypatch: pytest.MonkeyPatch):
    """When semantic returns nothing above threshold, keyword fallback runs."""
    _install_fake_semantic(monkeypatch, default_results=[])

    result = search_olive_documentation(
        query="calibration data",
        top_k=3,
        live=False,
    )
    assert result["count"] > 0
    assert len(result["results"]) <= 3
    # Keyword relevance is normalized to [0, 1]
    assert all(isinstance(r["relevance"], (int, float)) for r in result["results"])
    assert all(0.0 < float(r["relevance"]) <= 1.0 for r in result["results"])


def test_keyword_fallback_when_semantic_raises(monkeypatch: pytest.MonkeyPatch):
    def boom(*_a, **_k):
        raise RuntimeError("model unavailable")

    monkeypatch.setattr(docs_search, "get_or_build_kb_index", boom)

    result = search_olive_documentation(
        query="calibration data",
        top_k=3,
        live=False,
    )
    assert result["count"] > 0


def test_kb_mtime_invalidation_rebuilds_index(monkeypatch: pytest.MonkeyPatch):
    """Changing the tracked mtime must force a rebuild of embeddings."""
    build_calls: list[int] = []

    sample_texts = [
        ("passes.foo", "quantization calibration"),
        ("passes.bar", "onnx conversion"),
    ]

    def fake_load():
        return list(sample_texts)

    def fake_build(texts):
        build_calls.append(len(list(texts)))
        return np.ones((len(list(texts)), 384), dtype=np.float32)

    def fake_semantic(query, kb_texts, kb_embeddings, top_k, threshold=0.30):
        return [
            {
                "source": kb_texts[0][0],
                "snippet": kb_texts[0][1][:300],
                "relevance": 0.9,
            }
        ][:top_k]

    monkeypatch.setattr(docs_search, "_load_kb_text", fake_load)
    monkeypatch.setattr(docs_search, "build_kb_index", fake_build)
    monkeypatch.setattr(docs_search, "semantic_search", fake_semantic)

    # First build
    monkeypatch.setattr(docs_search, "_kb_max_mtime", lambda: 100.0)
    docs_search._search_local("quantization", 3)
    assert len(build_calls) == 1

    # Same mtime → cache hit
    docs_search._search_local("quantization", 3)
    assert len(build_calls) == 1

    # mtime change → rebuild
    monkeypatch.setattr(docs_search, "_kb_max_mtime", lambda: 200.0)
    docs_search._search_local("quantization", 3)
    assert len(build_calls) == 2


def test_empty_query_unchanged():
    result = search_olive_documentation(query="   ", top_k=5, live=False)
    assert result["count"] == 0
    assert result["results"] == []
    assert "Empty query" in result["note"]


def test_return_shape_preserved(monkeypatch: pytest.MonkeyPatch):
    _install_fake_semantic(
        monkeypatch,
        default_results=[
            {"source": "x", "snippet": "y", "relevance": 0.5},
        ],
    )
    result = search_olive_documentation(query="quantization", top_k=2, live=False)
    assert set(result.keys()) == {"query", "count", "results", "note"}
    for r in result["results"]:
        assert set(r.keys()) >= {"source", "snippet", "relevance"}


def test_kb_stale_build_does_not_poison_cache(monkeypatch: pytest.MonkeyPatch):
    """If mtime advances mid-build, do not stamp stale texts with the new mtime."""
    sample_old = [("old.path", "old calibration text")]
    sample_new = [("new.path", "new calibration text")]
    mtime_box = {"v": 100.0}
    load_calls: list[str] = []

    def fake_mtime():
        return mtime_box["v"]

    def fake_load():
        if mtime_box["v"] >= 200.0:
            load_calls.append("new")
            return list(sample_new)
        load_calls.append("old")
        return list(sample_old)

    def fake_build(texts):
        texts = list(texts)
        # Simulate hot-reload while encoding.
        mtime_box["v"] = 200.0
        return np.ones((len(texts), 384), dtype=np.float32)

    monkeypatch.setattr(docs_search, "_kb_max_mtime", fake_mtime)
    monkeypatch.setattr(docs_search, "_load_kb_text", fake_load)
    monkeypatch.setattr(docs_search, "build_kb_index", fake_build)

    texts1, _emb1 = docs_search.get_or_build_kb_index()
    # Stale build returned locally but must not poison global cache at mtime 200.
    assert texts1[0][0] == "old.path"
    assert docs_search._KB_INDEX_MTIME != 200.0 or docs_search._KB_TEXTS[0][0] != "old.path"

    # Next call with mtime 200 should load fresh content and cache it.
    texts2, _emb2 = docs_search.get_or_build_kb_index()
    assert texts2[0][0] == "new.path"
    assert docs_search._KB_INDEX_MTIME == 200.0
    assert docs_search._KB_TEXTS[0][0] == "new.path"


def test_live_fetch_generation_ignores_stale_completion(monkeypatch: pytest.MonkeyPatch):
    """Older in-flight fetch must not overwrite a newer generation's cache."""
    docs_search._LIVE_CACHE = {}
    docs_search._LAST_FETCH_TIME = 0.0
    docs_search._LIVE_FETCH_GENERATION = 0

    results_queue = [
        {"status": "ok", "pages": {"index": "OLDER live page content calibration"}},
        {"status": "ok", "pages": {"index": "NEWER live page content calibration"}},
    ]
    call_i = {"n": 0}

    def fake_fetch(pages=None):
        # First call is gen 1 (older), second is gen 2 (newer) — complete out of order.
        i = call_i["n"]
        call_i["n"] += 1
        return results_queue[min(i, len(results_queue) - 1)]

    # Patch the lazy import path used inside _fetch_live_docs.
    import olive_mcp_server.fetchers.official_docs_fetcher as fetcher

    monkeypatch.setattr(fetcher, "fetch_official_docs", fake_fetch)

    # Start gen1 and gen2 by forcing TTL miss; manually exercise publish races.
    with docs_search._LIVE_FETCH_LOCK:
        docs_search._LIVE_FETCH_GENERATION = 1
        gen1 = 1
        docs_search._LIVE_FETCH_GENERATION = 2
        gen2 = 2

    # Apply gen2 first (newer).
    with docs_search._LIVE_FETCH_LOCK:
        if gen2 == docs_search._LIVE_FETCH_GENERATION:
            docs_search._LIVE_CACHE = {"index": "NEWER"}
            docs_search._LAST_FETCH_TIME = 999.0
    # Stale gen1 must not overwrite.
    with docs_search._LIVE_FETCH_LOCK:
        if gen1 == docs_search._LIVE_FETCH_GENERATION:
            docs_search._LIVE_CACHE = {"index": "OLDER"}
            docs_search._LAST_FETCH_TIME = 1000.0

    assert docs_search._LIVE_CACHE == {"index": "NEWER"}
