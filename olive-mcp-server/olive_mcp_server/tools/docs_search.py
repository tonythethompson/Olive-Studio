"""Tool: search_olive_documentation."""

import json
from typing import Any

from . import KB_DIR


def _flatten(obj: Any, prefix: str = "") -> list[tuple[str, str]]:
    """Flatten a JSON object into (key-path, text) pairs for search."""
    results: list[tuple[str, str]] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            results.extend(_flatten(v, f"{prefix}.{k}"))
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            results.extend(_flatten(item, f"{prefix}[{i}]"))
    elif isinstance(obj, str):
        results.append((prefix, obj))
    return results


def _load_kb_text() -> list[tuple[str, str]]:
    all_text: list[tuple[str, str]] = []
    for file in KB_DIR.glob("*.json"):
        try:
            with open(file, "r", encoding="utf-8") as f:
                data = json.load(f)
            for path, text in _flatten(data, prefix=file.stem):
                all_text.append((path, text))
        except Exception:
            continue
    return all_text


def search_olive_documentation(query: str, top_k: int = 5) -> dict[str, Any]:
    """Full-text search across the local Olive knowledge base.

    Args:
        query: Search query, e.g. "calibrate static quantization".
        top_k: Maximum number of results (must be >= 0).

    Returns:
        Ranked results with snippet, source path, and relevance score.
    """
    if top_k < 0:
        raise ValueError(f"top_k must be >= 0, got {top_k}")

    terms = [t.lower() for t in query.split() if t]
    kb = _load_kb_text()

    scored = []
    for path, text in kb:
        text_lower = text.lower()
        score = sum(1 for term in terms if term in text_lower)
        if score == 0:
            continue
        scored.append({
            "source": path,
            "snippet": text[:300],
            "relevance": score,
        })

    scored.sort(key=lambda x: x["relevance"], reverse=True)
    return {
        "query": query,
        "count": len(scored),
        "results": scored[:top_k],
        "note": "Local knowledge base search. For the latest official docs, see https://microsoft.github.io/Olive/",
    }
