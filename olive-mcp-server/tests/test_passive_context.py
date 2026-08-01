"""Tests for get_context_for_pipeline passive context tool."""

from __future__ import annotations

import numpy as np
import pytest

from olive_mcp_server.tools import docs_search
from olive_mcp_server.tools.passive_context import get_context_for_pipeline


@pytest.fixture(autouse=True)
def _reset_kb_cache():
    docs_search._KB_TEXTS = []
    docs_search._KB_EMBEDDINGS = None
    docs_search._KB_INDEX_MTIME = (-1.0, -1)
    yield
    docs_search._KB_TEXTS = []
    docs_search._KB_EMBEDDINGS = None
    docs_search._KB_INDEX_MTIME = (-1.0, -1)


def test_empty_pipeline():
    result = get_context_for_pipeline(pipeline_passes=[], top_k=5)
    assert result["snippet_count"] == 0
    assert result["context_snippets"] == []
    assert result["confidence"] == 0.0
    assert "pipeline_summary" in result


def test_empty_pipeline_none():
    result = get_context_for_pipeline(pipeline_passes=None, top_k=5)
    assert result["snippet_count"] == 0
    assert result["confidence"] == 0.0


def test_quantization_pipeline_returns_relevant_snippets(monkeypatch: pytest.MonkeyPatch):
    fake_results = [
        {
            "source": "passes.OnnxQuantization",
            "snippet": "Post-training static quantization guidance.",
            "relevance": 0.77,
        },
        {
            "source": "quirks.quantization",
            "snippet": "Calibration sample selection tips.",
            "relevance": 0.65,
        },
    ]

    def fake_index():
        texts = [("a", "quant"), ("b", "other")]
        return texts, np.zeros((2, 384), dtype=np.float32)

    def fake_semantic(query, kb_texts, kb_embeddings, top_k, threshold=0.30):
        assert "OnnxQuantization" in query or "quant" in query.lower()
        return fake_results[:top_k]

    monkeypatch.setattr(
        "olive_mcp_server.tools.passive_context.get_or_build_kb_index",
        fake_index,
    )
    monkeypatch.setattr(
        "olive_mcp_server.tools.passive_context.semantic_search",
        fake_semantic,
    )

    result = get_context_for_pipeline(
        pipeline_passes=["OnnxConversion", "OnnxQuantization"],
        model_name="phi-4",
        target_hardware="NVIDIA RTX 4090",
        top_k=5,
    )
    assert result["snippet_count"] == 2
    assert len(result["context_snippets"]) == 2
    assert 0.0 <= result["confidence"] <= 1.0
    assert result["confidence"] == pytest.approx((0.77 + 0.65) / 2)
    assert "OnnxQuantization" in result["pipeline_summary"]
    assert "phi-4" in result["pipeline_summary"]


def test_confidence_bounded_0_1(monkeypatch: pytest.MonkeyPatch):
    def fake_index():
        return [("s", "t")], np.ones((1, 384), dtype=np.float32)

    def fake_semantic(*_a, **_k):
        # Even if relevance is slightly out of range, API clamps confidence.
        return [{"source": "s", "snippet": "t", "relevance": 1.2}]

    monkeypatch.setattr(
        "olive_mcp_server.tools.passive_context.get_or_build_kb_index",
        fake_index,
    )
    monkeypatch.setattr(
        "olive_mcp_server.tools.passive_context.semantic_search",
        fake_semantic,
    )

    result = get_context_for_pipeline(
        pipeline_passes=[{"name": "OnnxQuantization", "type": "quantization"}],
        top_k=3,
    )
    assert 0.0 <= result["confidence"] <= 1.0


def test_dict_and_string_pass_descriptors(monkeypatch: pytest.MonkeyPatch):
    seen_query: dict[str, str] = {}

    def fake_index():
        return [("s", "t")], np.ones((1, 384), dtype=np.float32)

    def fake_semantic(query, *_a, **_k):
        seen_query["q"] = query
        return [{"source": "s", "snippet": "t", "relevance": 0.5}]

    monkeypatch.setattr(
        "olive_mcp_server.tools.passive_context.get_or_build_kb_index",
        fake_index,
    )
    monkeypatch.setattr(
        "olive_mcp_server.tools.passive_context.semantic_search",
        fake_semantic,
    )

    result = get_context_for_pipeline(
        pipeline_passes=[
            "OnnxConversion",
            {"name": "OnnxQuantization", "type": "quantization"},
        ],
        top_k=2,
    )
    assert result["snippet_count"] == 1
    assert "OnnxConversion" in seen_query["q"]
    assert "OnnxQuantization" in seen_query["q"]
    assert "quantization" in seen_query["q"]


def test_return_shape():
    result = get_context_for_pipeline(pipeline_passes=[], top_k=1)
    assert set(result.keys()) == {
        "context_snippets",
        "pipeline_summary",
        "confidence",
        "snippet_count",
    }
