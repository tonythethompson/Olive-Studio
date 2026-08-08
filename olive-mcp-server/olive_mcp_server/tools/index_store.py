"""Shipped precomputed embedding indexes for the Olive MCP knowledge base.

Phase 1: document embeddings are built at package/release time so cold
processes only load arrays + embed the query (when semantic is used).

Layout under ``knowledge_base/indexes/``::

    manifest.json
    docs_kb.npz          # embeddings (N, dim) float32
    docs_kb.meta.json    # sources, texts, content_hash, model
    ts_olive.npz / ts_olive.meta.json
    ts_studio.npz / ts_studio.meta.json
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from pathlib import Path
from typing import Any

import numpy as np

from olive_mcp_server.tools import KB_DIR
from olive_mcp_server.tools.embeddings import EMBEDDING_DIM, MODEL_NAME

logger = logging.getLogger(__name__)

INDEX_DIR = KB_DIR / "indexes"
MANIFEST_NAME = "manifest.json"


def _truthy(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


def force_rebuild() -> bool:
    """When true, ignore shipped indexes and re-encode at runtime."""
    return _truthy("OLIVE_MCP_REBUILD_INDEX")


def _normalize_text(text: str) -> str:
    """Normalize line endings so Windows-built indexes match Linux hashes."""
    return str(text).replace("\r\n", "\n").replace("\r", "\n")


def content_hash_pairs(pairs: list[tuple[str, str]]) -> str:
    """SHA-256 of ordered (source, text) pairs (LF-normalized text)."""
    h = hashlib.sha256()
    for source, text in pairs:
        h.update(str(source).encode("utf-8"))
        h.update(b"\0")
        h.update(_normalize_text(text).encode("utf-8"))
        h.update(b"\0")
    return h.hexdigest()


def content_hash_texts(texts: list[str]) -> str:
    h = hashlib.sha256()
    for t in texts:
        h.update(_normalize_text(t).encode("utf-8"))
        h.update(b"\0")
    return h.hexdigest()


def ensure_index_dir() -> Path:
    INDEX_DIR.mkdir(parents=True, exist_ok=True)
    return INDEX_DIR


def _meta_path(stem: str) -> Path:
    return INDEX_DIR / f"{stem}.meta.json"


def _npz_path(stem: str) -> Path:
    return INDEX_DIR / f"{stem}.npz"


def save_pair_index(
    stem: str,
    pairs: list[tuple[str, str]],
    embeddings: np.ndarray,
    *,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Persist (source, text) pairs + embeddings for docs-style indexes."""
    ensure_index_dir()
    emb = np.asarray(embeddings, dtype=np.float32)
    if emb.ndim == 1:
        emb = emb.reshape(1, -1)
    if len(pairs) != emb.shape[0]:
        raise ValueError(f"pairs/embeddings length mismatch: {len(pairs)} vs {emb.shape[0]}")

    chash = content_hash_pairs(pairs)
    meta: dict[str, Any] = {
        "stem": stem,
        "kind": "pairs",
        "model": MODEL_NAME,
        "dim": int(emb.shape[1]) if emb.size else EMBEDDING_DIM,
        "count": len(pairs),
        "content_hash": chash,
        "sources": [p[0] for p in pairs],
        "texts": [p[1] for p in pairs],
    }
    if extra:
        meta.update(extra)

    np.savez_compressed(_npz_path(stem), embeddings=emb)
    _meta_path(stem).write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return meta


def save_entry_index(
    stem: str,
    entry_ids: list[str],
    embed_texts: list[str],
    embeddings: np.ndarray,
    *,
    content_hash: str,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Persist troubleshooting-style indexes (aligned by entry id / embed text)."""
    ensure_index_dir()
    emb = np.asarray(embeddings, dtype=np.float32)
    if emb.ndim == 1:
        emb = emb.reshape(1, -1)
    if not (len(entry_ids) == len(embed_texts) == emb.shape[0]):
        raise ValueError("entry_ids, embed_texts, embeddings must share length")

    meta: dict[str, Any] = {
        "stem": stem,
        "kind": "entries",
        "model": MODEL_NAME,
        "dim": int(emb.shape[1]) if emb.size else EMBEDDING_DIM,
        "count": len(entry_ids),
        "content_hash": content_hash,
        "entry_ids": entry_ids,
        "embed_texts": embed_texts,
    }
    if extra:
        meta.update(extra)

    np.savez_compressed(_npz_path(stem), embeddings=emb)
    _meta_path(stem).write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return meta


def load_pair_index(stem: str, expected_hash: str) -> tuple[list[tuple[str, str]], np.ndarray] | None:
    """Load docs-style index if present and content_hash matches."""
    if force_rebuild():
        return None
    meta_p, npz_p = _meta_path(stem), _npz_path(stem)
    if not meta_p.is_file() or not npz_p.is_file():
        return None
    try:
        meta = json.loads(meta_p.read_text(encoding="utf-8"))
        if meta.get("model") != MODEL_NAME:
            logger.info("Shipped index %s model mismatch; rebuild", stem)
            return None
        if meta.get("content_hash") != expected_hash:
            logger.info("Shipped index %s content hash mismatch; rebuild", stem)
            return None
        data = np.load(npz_p, allow_pickle=False)
        emb = np.asarray(data["embeddings"], dtype=np.float32)
        if emb.ndim != 2 or emb.shape[1] != EMBEDDING_DIM:
            logger.warning(
                "Shipped index %s bad embedding shape %s (want rank-2, dim=%s); rebuild",
                stem,
                emb.shape,
                EMBEDDING_DIM,
            )
            return None
        sources = meta.get("sources") or []
        texts = meta.get("texts") or []
        if len(sources) != len(texts) or len(sources) != emb.shape[0]:
            logger.warning("Shipped index %s corrupted lengths; rebuild", stem)
            return None
        pairs = list(zip(sources, texts, strict=True))
        return pairs, emb
    except Exception:
        logger.warning("Failed to load shipped index %s", stem, exc_info=True)
        return None


def load_entry_embeddings(stem: str, expected_hash: str) -> np.ndarray | None:
    """Load embeddings for entry index if content_hash matches."""
    if force_rebuild():
        return None
    meta_p, npz_p = _meta_path(stem), _npz_path(stem)
    if not meta_p.is_file() or not npz_p.is_file():
        return None
    try:
        meta = json.loads(meta_p.read_text(encoding="utf-8"))
        if meta.get("model") != MODEL_NAME:
            return None
        if meta.get("content_hash") != expected_hash:
            return None
        data = np.load(npz_p, allow_pickle=False)
        emb = np.asarray(data["embeddings"], dtype=np.float32)
        if emb.ndim != 2 or emb.shape[1] != EMBEDDING_DIM:
            logger.warning(
                "Shipped entry index %s bad embedding shape %s (want rank-2, dim=%s); rebuild",
                stem,
                emb.shape,
                EMBEDDING_DIM,
            )
            return None
        if int(meta.get("count", -1)) != emb.shape[0]:
            return None
        return emb
    except Exception:
        logger.warning("Failed to load shipped entry index %s", stem, exc_info=True)
        return None


def write_manifest(entries: dict[str, dict[str, Any]]) -> Path:
    ensure_index_dir()
    path = INDEX_DIR / MANIFEST_NAME
    payload = {
        "model": MODEL_NAME,
        "dim": EMBEDDING_DIM,
        "indexes": entries,
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path


def read_manifest() -> dict[str, Any] | None:
    path = INDEX_DIR / MANIFEST_NAME
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def shipped_index_status() -> dict[str, Any]:
    """Summary for get_mcp_capabilities."""
    manifest = read_manifest()
    if not manifest:
        return {"version": None, "shipped": False, "stems": []}
    indexes = manifest.get("indexes") or {}
    stems = sorted(indexes.keys())
    version = hashlib.sha256(
        json.dumps(indexes, sort_keys=True).encode("utf-8")
    ).hexdigest()[:16]
    return {
        "version": version,
        "shipped": bool(stems),
        "stems": stems,
        "model": manifest.get("model"),
    }
