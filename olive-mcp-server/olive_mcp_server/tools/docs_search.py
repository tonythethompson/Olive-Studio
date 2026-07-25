"""Tool: search_olive_documentation."""

import json
from pathlib import Path
from typing import Any

_KB_DIR = Path(__file__).parent.parent / "knowledge_base"


def _flatten(obj: Any, prefix: str = "") -> list[tuple[str, str]]:
    """
    Flatten nested JSON data into key-path and text pairs.
    
    Returns:
        A list of `(key_path, text)` pairs for each string value in the data.
    """
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
    """
    Load searchable text entries from all JSON files in the knowledge base.
    
    Returns:
        list[tuple[str, str]]: Flattened key paths and their corresponding text values.
    """
    all_text: list[tuple[str, str]] = []
    for file in _KB_DIR.glob("*.json"):
        try:
            with open(file, "r", encoding="utf-8") as f:
                data = json.load(f)
            for path, text in _flatten(data, prefix=file.stem):
                all_text.append((path, text))
        except Exception:
            continue
    return all_text


def search_olive_documentation(query: str, top_k: int = 5) -> dict[str, Any]:
    """
    Search the local Olive knowledge base for entries matching the query terms.
    
    Parameters:
        query (str): Terms to search for.
        top_k (int): Maximum number of ranked results to include.
    
    Returns:
        dict[str, Any]: A mapping containing the original query, total matching
            entry count, ranked results with source paths, snippets, and relevance
            scores, and a link to the official Olive documentation.
    """
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
