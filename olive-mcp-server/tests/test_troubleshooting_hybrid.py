"""Tests for hybrid semantic+keyword scoring in troubleshoot_olive_error."""

from __future__ import annotations

import numpy as np
import pytest

from olive_mcp_server.tools import troubleshooting as ts
from olive_mcp_server.tools.troubleshooting import (
    reset_frequency_store,
    troubleshoot_olive_error,
)


@pytest.fixture(autouse=True)
def _clean_state():
    reset_frequency_store()
    # Clear embedding index cache between tests
    ts._ts_index_cache = {}
    yield
    reset_frequency_store()
    ts._ts_index_cache = {}


def _mock_embeddings(
    monkeypatch: pytest.MonkeyPatch,
    *,
    scores_by_entry_id: dict[str, float] | None = None,
    default_score: float = 0.0,
):
    """Make cosine scores deterministic without loading the real model."""

    def fake_index(entries=None):
        if entries is None:
            from olive_mcp_server.tools import load_troubleshooting

            entries = load_troubleshooting()
        entries_list = list(entries)
        n = len(entries_list)
        embeddings = np.zeros((n, 384), dtype=np.float32)
        # Stash for cosine lookup by this pool's fingerprint key
        fake_index._last_entries = entries_list  # type: ignore[attr-defined]
        return entries_list, embeddings

    def fake_encode_query(query: str) -> np.ndarray:
        if not query or not str(query).strip():
            return np.zeros((384,), dtype=np.float32)
        return np.ones((384,), dtype=np.float32)

    def fake_cosine(query_vec, index_matrix):
        entries = getattr(fake_index, "_last_entries", []) or []
        n = (
            int(index_matrix.shape[0])
            if index_matrix is not None and getattr(index_matrix, "size", 0)
            else len(entries)
        )
        if query_vec is None or float(np.linalg.norm(query_vec)) == 0.0:
            return np.zeros((n,), dtype=np.float32)
        out = np.full((n,), default_score, dtype=np.float32)
        for i, entry in enumerate(list(entries)[:n]):
            eid = entry.get("id", "")
            if scores_by_entry_id and eid in scores_by_entry_id:
                out[i] = scores_by_entry_id[eid]
        return out

    monkeypatch.setattr(ts, "_get_troubleshooting_index", fake_index)
    monkeypatch.setattr(ts, "encode_query", fake_encode_query)
    monkeypatch.setattr(ts, "cosine_similarity_scores", fake_cosine)


def test_semantic_match_without_exact_pattern(monkeypatch: pytest.MonkeyPatch):
    """High semantic score should match even when no pattern substring hits."""
    _mock_embeddings(
        monkeypatch,
        scores_by_entry_id={"oom-quantization": 0.85},
        default_score=0.05,
    )

    # Avoid exact pattern hits for oom-quantization; use paraphrased wording.
    result = troubleshoot_olive_error(
        error_message="Process killed while running weight-only packing due to insufficient device memory",
        pass_name="OnnxQuantization",
    )
    assert result["matched_entry"] == "oom-quantization"
    assert "root_cause" in result
    assert "workaround" in result


def test_paraphrased_oom_realistic_score_vector(monkeypatch: pytest.MonkeyPatch):
    """Regression: realistic MiniLM-like scores must rank oom-quantization first.

    Freezes approximate cosine values observed when encoding error_message only
    (without pass_name contamination).
    """
    _mock_embeddings(
        monkeypatch,
        scores_by_entry_id={
            "oom-quantization": 0.4037,
            "onnx-export-external-data": 0.3113,
            "int4-perplexity": 0.1989,
            "openvino-fallback": 0.1912,
            "ep-fallback-cpu": 0.1544,
        },
        default_score=0.10,
    )
    result = troubleshoot_olive_error(
        error_message=(
            "Process killed while running weight-only packing "
            "due to insufficient device memory"
        ),
        pass_name="OnnxQuantization",
    )
    assert result["matched_entry"] == "oom-quantization"


@pytest.mark.parametrize(
    "pass_name",
    [
        "OnnxQuantization",
        "TensorRT",
        "AWQ",
        "QNN",
        "LoRA",
        "OpenVINO",
    ],
)
def test_empty_error_with_pass_name_no_match(
    monkeypatch: pytest.MonkeyPatch,
    pass_name: str,
):
    """Empty error_message must not match from pass_name alone (incl. pattern tokens)."""
    _mock_embeddings(
        monkeypatch,
        scores_by_entry_id={
            "ep-fallback-cpu": 0.90,
            "oom-quantization": 0.85,
            "tensorrt-build-slow": 0.95,
            "awq-slow-calibration": 0.95,
            "qnn-layer-not-supported": 0.95,
            "lora-target-modules": 0.95,
            "openvino-fallback": 0.95,
        },
        default_score=0.50,
    )
    result = troubleshoot_olive_error(
        error_message="",
        pass_name=pass_name,
    )
    assert result["matched_entry"] is None
    assert result["title"] == "No exact match found"

    # Whitespace-only is also empty for matching purposes.
    result_ws = troubleshoot_olive_error(error_message="   \t", pass_name=pass_name)
    assert result_ws["matched_entry"] is None


def test_weak_error_with_pass_name_no_false_positive(monkeypatch: pytest.MonkeyPatch):
    """Weak error text + pass_name must not match via pass-name-driven cosine."""
    # Production encodes error_message only; mock returns low scores for weak text.
    _mock_embeddings(monkeypatch, default_score=0.12)
    result = troubleshoot_olive_error(
        error_message="hello world error",
        pass_name="OnnxQuantization",
    )
    assert result["matched_entry"] is None


def test_exact_pattern_still_scores_high(monkeypatch: pytest.MonkeyPatch):
    """Classic keyword/pattern match must still win (or at least match)."""
    # Mild semantic noise on a wrong entry must not beat exact pattern OR=1.0.
    _mock_embeddings(
        monkeypatch,
        scores_by_entry_id={"ep-fallback-cpu": 0.40},
        default_score=0.0,
    )

    result = troubleshoot_olive_error(
        error_message="The ONNX model is larger than 2GB",
        pass_name="OnnxConversion",
    )
    assert result["matched_entry"] == "onnx-export-external-data"
    assert "external" in result["workaround"].lower()


def test_keyword_or_not_diluted():
    """A single pattern hit among many is full keyword evidence (not hits/len)."""
    entry = {
        "patterns": [
            "never-match-alpha",
            "never-match-beta",
            "never-match-gamma",
            "never-match-delta",
            "2GB",
        ],
        "title": "t",
        "root_cause": "r",
        "solution": "s",
    }
    text = "model larger than 2GB".lower()
    assert ts._keyword_normalized(entry, text) == 1.0
    # Not diluted to 1/5 — full OR keyword weight + one-hit bonus
    score = ts._score(entry, "model larger than 2GB", "", "", semantic_score=0.0)
    assert score == pytest.approx(0.4 * 1.0 + ts._HIT_RANK_BONUS * 1)
    # Contrast: diluted formula would be 0.4 * (1/5) = 0.08
    assert score > 0.4 * (1 / 5) + 0.1


def test_keyword_or_beats_mild_semantic():
    """Exact pattern hybrid must beat mild semantic-only neighbors (~0.21)."""
    entry_kw = {
        "id": "kw-hit",
        "patterns": ["exact-unique-token-zz"],
        "title": "keyword entry",
        "root_cause": "r",
        "solution": "s",
    }
    entry_sem = {
        "id": "sem-only",
        "patterns": ["never-matches-this"],
        "title": "semantic entry",
        "root_cause": "r",
        "solution": "s",
    }
    kw = ts._score(entry_kw, "exact-unique-token-zz failed", "", "", semantic_score=0.0)
    sem = ts._score(entry_sem, "exact-unique-token-zz failed", "", "", semantic_score=0.35)
    assert kw >= 0.4
    assert sem == pytest.approx(0.6 * 0.35)
    assert kw > sem


def test_response_shape_preserved(monkeypatch: pytest.MonkeyPatch):
    _mock_embeddings(monkeypatch, default_score=0.0)
    result = troubleshoot_olive_error(
        error_message="The ONNX model is larger than 2GB",
    )
    expected_keys = {
        "matched_entry",
        "title",
        "root_cause",
        "workaround",
        "updated_config",
        "relevant_quirks",
        "frequency",
    }
    assert expected_keys <= set(result.keys())
    assert "occurrence_count" in result["frequency"]
    assert "label" in result["frequency"]
    assert "first_seen" in result["frequency"]
    assert "last_seen" in result["frequency"]


def test_unknown_error_still_unmatched(monkeypatch: pytest.MonkeyPatch):
    """Low semantic noise must not create false-positive matches."""
    _mock_embeddings(monkeypatch, default_score=0.15)  # below DEFAULT_THRESHOLD 0.30

    result = troubleshoot_olive_error(
        error_message="Some random unique unknown failure message 12345",
    )
    assert result["matched_entry"] is None
    assert result["title"] == "No exact match found"


def test_score_returns_float():
    entry = {
        "patterns": ["2GB", "external data"],
        "title": "t",
        "root_cause": "r",
        "solution": "s",
    }
    score = ts._score(
        entry,
        "model larger than 2GB",
        "",
        "",
        semantic_score=0.0,
    )
    assert isinstance(score, float)
    assert score > 0.0


def test_hybrid_weights():
    """Both semantic and keyword components contribute to the score."""
    entry = {
        "patterns": ["exact-token-xyz"],
        "title": "t",
        "root_cause": "r",
        "solution": "s",
    }
    kw_only = ts._score(entry, "exact-token-xyz appeared", "", "", semantic_score=0.0)
    sem_only = ts._score(entry, "totally different wording", "", "", semantic_score=0.80)
    both = ts._score(entry, "exact-token-xyz appeared", "", "", semantic_score=0.80)

    assert kw_only == pytest.approx(0.4 * 1.0 + ts._HIT_RANK_BONUS)
    assert sem_only == pytest.approx(0.6 * 0.80)
    assert both == pytest.approx(0.6 * 0.80 + 0.4 * 1.0 + ts._HIT_RANK_BONUS)
    assert both > kw_only
    assert both > sem_only


def test_index_invalidates_on_reorder(monkeypatch: pytest.MonkeyPatch):
    """Same-length reordered entries must rebuild embeddings (fingerprint)."""
    from olive_mcp_server.tools import load_troubleshooting

    build_calls: list[int] = []

    def counting_build(texts):
        texts = list(texts)
        build_calls.append(len(texts))
        n = len(texts)
        mat = np.zeros((n, 384), dtype=np.float32)
        for i in range(n):
            mat[i, i % 384] = 1.0
        return mat

    monkeypatch.setattr(ts, "build_kb_index", counting_build)
    monkeypatch.setattr(ts, "_troubleshooting_kb_mtime", lambda: 1.0)

    entries = load_troubleshooting()
    e1, _emb1 = ts._get_troubleshooting_index(entries)
    assert len(build_calls) == 1
    e2, _emb2 = ts._get_troubleshooting_index(entries)
    assert len(build_calls) == 1  # cache hit
    assert e1[0].get("id") == e2[0].get("id")

    reversed_entries = list(reversed(entries))
    e3, _emb3 = ts._get_troubleshooting_index(reversed_entries)
    assert len(build_calls) == 2  # fingerprint changed
    assert e3[0].get("id") == reversed_entries[0].get("id")
    assert e3[0].get("id") != e1[0].get("id") or len(entries) <= 1


def test_scoring_uses_index_entry_list(monkeypatch: pytest.MonkeyPatch):
    """_best_match scores the entries returned with embeddings."""
    from olive_mcp_server.tools import load_troubleshooting

    base = load_troubleshooting()
    custom = [
        {
            "id": "custom-first",
            "patterns": ["zz-unique-pattern-99"],
            "title": "Custom first",
            "root_cause": "custom root",
            "solution": "custom solution",
            "updated_config": {},
            "domain": "olive",
            "applyable": False,
        },
        *base,
    ]

    def fake_index(entries=None):
        mat = np.zeros((len(custom), 384), dtype=np.float32)
        return custom, mat

    monkeypatch.setattr(ts, "_get_troubleshooting_index", fake_index)
    monkeypatch.setattr(ts, "encode_query", lambda q: np.zeros((384,), dtype=np.float32))
    monkeypatch.setattr(
        ts,
        "cosine_similarity_scores",
        lambda q, m: np.zeros((m.shape[0],), dtype=np.float32),
    )

    result = troubleshoot_olive_error(error_message="hit zz-unique-pattern-99 now")
    assert result["matched_entry"] == "custom-first"


def test_real_minilm_paraphrased_oom_optional():
    """Real-model check when sentence-transformers is installed: paraphrased OOM."""
    pytest.importorskip("sentence_transformers")
    ts._ts_index_cache = {}

    result = troubleshoot_olive_error(
        error_message=(
            "Process killed while running weight-only packing "
            "due to insufficient device memory"
        ),
        pass_name="OnnxQuantization",
    )
    assert result["matched_entry"] == "oom-quantization"
