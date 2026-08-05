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
    docs_search._KB_INDEX_MTIME = (-1.0, -1)
    docs_search._LIVE_CACHE = {}
    docs_search._LAST_FETCH_TIME = 0.0
    docs_search._LIVE_FETCH_GENERATION = 0
    docs_search._LIVE_SNIPPETS = []
    docs_search._LIVE_EMBEDDINGS = None
    docs_search._LIVE_EMBED_CACHE_TIME = -1.0
    yield
    docs_search._KB_TEXTS = []
    docs_search._KB_EMBEDDINGS = None
    docs_search._KB_INDEX_MTIME = (-1.0, -1)
    docs_search._LIVE_CACHE = {}
    docs_search._LAST_FETCH_TIME = 0.0
    docs_search._LIVE_FETCH_GENERATION = 0
    docs_search._LIVE_SNIPPETS = []
    docs_search._LIVE_EMBEDDINGS = None
    docs_search._LIVE_EMBED_CACHE_TIME = -1.0


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


_FIXED_KB_TEXTS = [
    ("passes.foo", "quantization calibration data"),
    ("passes.bar", "onnx conversion"),
]


def test_keyword_fallback_when_semantic_empty(monkeypatch: pytest.MonkeyPatch):
    """When semantic returns nothing above threshold, keyword fallback runs."""
    monkeypatch.setattr(docs_search, "_load_kb_text", lambda: list(_FIXED_KB_TEXTS))
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
    monkeypatch.setattr(docs_search, "_load_kb_text", lambda: list(_FIXED_KB_TEXTS))

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
    monkeypatch.setattr(docs_search, "_kb_max_mtime", lambda: (100.0, 2))
    docs_search._search_local("quantization", 3)
    assert len(build_calls) == 1

    # Same mtime → cache hit
    docs_search._search_local("quantization", 3)
    assert len(build_calls) == 1

    # mtime change → rebuild
    monkeypatch.setattr(docs_search, "_kb_max_mtime", lambda: (200.0, 2))
    docs_search._search_local("quantization", 3)
    assert len(build_calls) == 2


def test_weak_live_result_does_not_displace_strong_local_top1(monkeypatch: pytest.MonkeyPatch):
    """A weak live hit must not evict the single strongest local result at top_k=1."""
    strong_local = [{"source": "passes.foo", "snippet": "strong", "relevance": 0.85}]
    weak_live = [{"source": "live:index", "snippet": "weak", "relevance": 0.31}]

    monkeypatch.setattr(docs_search, "_search_local", lambda query, top_k: strong_local[:top_k])
    monkeypatch.setattr(docs_search, "_search_live", lambda query, top_k: weak_live[:top_k])

    result = search_olive_documentation(query="quantization", top_k=1, live=True)
    assert result["results"] == [strong_local[0]]


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

    def fake_mtime():
        return (mtime_box["v"], 1)

    def fake_load():
        if mtime_box["v"] >= 200.0:
            return list(sample_new)
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
    # Cache must remain unpublished (still the pre-test sentinel) rather than
    # stamped with the newer mtime for stale content.
    assert docs_search._KB_INDEX_MTIME == (-1.0, -1)
    assert docs_search._KB_TEXTS == []

    # Next call with mtime 200 should load fresh content and cache it.
    texts2, _emb2 = docs_search.get_or_build_kb_index()
    assert texts2[0][0] == "new.path"
    assert docs_search._KB_INDEX_MTIME == (200.0, 1)
    assert docs_search._KB_TEXTS[0][0] == "new.path"


def test_live_fetch_generation_ignores_stale_completion(monkeypatch: pytest.MonkeyPatch):
    """An older in-flight fetch completing after a newer one must not win.

    Drives the real ``_fetch_live_docs`` through two threads so the
    generation-token guard inside the function itself is exercised, not
    re-implemented in the test.
    """
    import threading as _threading

    started_gen1 = _threading.Event()
    release_gen1 = _threading.Event()
    call_i = {"n": 0}

    def fake_fetch(pages=None):
        i = call_i["n"]
        call_i["n"] += 1
        if i == 0:
            # gen1: signal it has started, then block until gen2 finishes.
            started_gen1.set()
            release_gen1.wait(timeout=5)
            return {"status": "ok", "pages": {"index": "OLDER live page content calibration"}}
        return {"status": "ok", "pages": {"index": "NEWER live page content calibration"}}

    import olive_mcp_server.fetchers.official_docs_fetcher as fetcher

    monkeypatch.setattr(fetcher, "fetch_official_docs", fake_fetch)

    result_gen1: dict = {}
    t1 = _threading.Thread(
        target=lambda: result_gen1.update(pages=docs_search._fetch_live_docs()[0])
    )
    t1.start()
    assert started_gen1.wait(timeout=5)

    # gen2 runs to completion while gen1 is still blocked.
    pages_gen2, _ = docs_search._fetch_live_docs()
    assert "NEWER" in next(iter(pages_gen2.values()))

    # Now let the stale gen1 completion land; it must not clobber gen2's cache.
    release_gen1.set()
    t1.join(timeout=5)
    assert not t1.is_alive(), "stale generation-1 fetch did not complete"
    assert result_gen1.get("pages"), "generation-1 thread raised before returning"

    assert "NEWER" in next(iter(docs_search._LIVE_CACHE.values()))


def test_live_index_does_not_overwrite_newer_generation(monkeypatch: pytest.MonkeyPatch):
    """A stale (older fetch_time) live-index build must not clobber a newer one.

    Simulates: build for fetch_time=100 starts, a newer fetch_time=200 build
    completes and publishes first, then the stale build's publish attempt
    must be discarded rather than roll the cache back to fetch_time=100.
    """

    def fake_build(texts):
        return np.ones((len(list(texts)), 384), dtype=np.float32)

    monkeypatch.setattr(docs_search, "build_kb_index", fake_build)

    # Newer generation publishes first.
    monkeypatch.setattr(
        docs_search, "_fetch_live_docs", lambda: ({"index": "newer content"}, 200.0)
    )
    docs_search._get_live_index()
    assert docs_search._LIVE_EMBED_CACHE_TIME == 200.0

    # Stale generation (older fetch_time) attempts to publish after.
    monkeypatch.setattr(
        docs_search, "_fetch_live_docs", lambda: ({"index": "older content"}, 100.0)
    )
    docs_search._get_live_index()
    assert docs_search._LIVE_EMBED_CACHE_TIME == 200.0
    assert docs_search._LIVE_SNIPPETS[0][1] == "newer content"
