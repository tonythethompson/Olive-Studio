#!/usr/bin/env python3
"""Weekly update script: refresh knowledge base from official sources.

Fetches Olive docs, GitHub issues/releases, and ONNX Runtime EP docs,
then parses the returned Markdown-ish content for headings, bullet
candidate-quirks, and deprecation warnings. Writes a timestamped report
and a candidate quirks file for manual review.
"""

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Add the MCP server package to the path when running the script directly.
_MCP_DIR = Path(__file__).resolve().parent.parent
import sys  # noqa: E402
if str(_MCP_DIR) not in sys.path:
    sys.path.insert(0, str(_MCP_DIR))

from olive_mcp_server.fetchers import (  # noqa: E402
    fetch_github_issues,
    fetch_official_docs,
    fetch_onnx_runtime_docs,
)

HEADING_RE = re.compile(r"^\s{0,3}(#{1,6})\s+(.+)$", re.MULTILINE)
BULLET_RE = re.compile(r"^\s*[-*]\s+(.+)$", re.MULTILINE)
DEPRECATION_RE = re.compile(
    r"\b(deprecated?|deprecat(?:ion|ed|e|ing)|no longer supported)\b",
    re.IGNORECASE,
)


def _coalesce_text(data: Any) -> str:
    """Flatten fetcher output into a single string for parsing."""
    if isinstance(data, str):
        return data
    if isinstance(data, dict):
        if isinstance(data.get("content"), str):
            return data["content"]
        pages = data.get("pages", {})
        if isinstance(pages, dict):
            parts = [v for v in pages.values() if isinstance(v, str)]
            if parts:
                return "\n\n".join(parts)
        if isinstance(data.get("overview"), str):
            return data["overview"]
    return ""


def _extract_headings(text: str) -> list[str]:
    return [match.group(2).strip() for match in HEADING_RE.finditer(text)]


def _extract_bullets(text: str) -> list[str]:
    return [match.group(1).strip() for match in BULLET_RE.finditer(text)]


def _extract_deprecations(text: str) -> list[str]:
    """Find sentences mentioning deprecation or removal."""
    sentences = re.split(r"(?<=[.!?])\s+", text)
    return [s.strip() for s in sentences if DEPRECATION_RE.search(s)]


def _parse_source(data: Any) -> dict[str, Any]:
    """Parse fetcher output into structured sections and deprecation flags."""
    text = _coalesce_text(data)
    return {
        "headings": _extract_headings(text)[:30],
        "bullets": _extract_bullets(text)[:30],
        "deprecations": _extract_deprecations(text)[:20],
        "word_count": len(text.split()),
    }


def _build_candidate_quirks(parsed: dict[str, dict[str, Any]]) -> list[dict[str, str]]:
    """Turn bullet points from each source into candidate quirks for review."""
    candidates: list[dict[str, str]] = []
    for source_name, info in parsed.items():
        for bullet in info.get("bullets", [])[:20]:
            title = bullet[:80] + ("..." if len(bullet) > 80 else "")
            candidates.append({
                "category": source_name,
                "title": title,
                "description": bullet,
                "source": "update_kb",
            })
    return candidates


def _sanitize_source(data: Any) -> Any:
    """Replace large raw text fields with a small preview for the report."""
    if isinstance(data, str):
        return {"word_count": len(data.split()), "preview": data[:500]}
    if isinstance(data, dict):
        sanitized: dict[str, Any] = {}
        for key, value in data.items():
            if key == "content" and isinstance(value, str):
                sanitized[key] = {"word_count": len(value.split()), "preview": value[:500]}
            elif key == "pages" and isinstance(value, dict):
                sanitized[key] = {
                    k: {"word_count": len(v.split()), "preview": v[:500]} if isinstance(v, str) else v
                    for k, v in value.items()
                }
            elif key == "overview" and isinstance(value, str):
                sanitized[key] = {"word_count": len(value.split()), "preview": value[:500]}
            else:
                sanitized[key] = value
        return sanitized
    return data


def main() -> None:
    """Fetch external sources, parse them, and write freshness reports."""
    kb_dir = Path(__file__).parent.parent / "olive_mcp_server" / "knowledge_base"
    kb_dir.mkdir(parents=True, exist_ok=True)

    raw_sources: dict[str, Any] = {
        "official_docs": fetch_official_docs(),
        "github": fetch_github_issues(),
        "onnx_runtime": fetch_onnx_runtime_docs(),
    }

    parsed = {name: _parse_source(data) for name, data in raw_sources.items()}
    report: dict[str, Any] = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "sources": {name: _sanitize_source(data) for name, data in raw_sources.items()},
        "parsed": parsed,
        "deprecations": [
            deprecation
            for section in parsed.values()
            for deprecation in section.get("deprecations", [])
        ],
    }

    update_report_path = kb_dir / "update_report.json"
    with open(update_report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print(f"Update report written to {update_report_path}")

    candidate_quirks = _build_candidate_quirks(parsed)
    candidate_path = kb_dir / "candidate_quirks.json"
    with open(candidate_path, "w", encoding="utf-8") as f:
        json.dump(candidate_quirks, f, indent=2)
    print(f"Candidate quirks written to {candidate_path}")


if __name__ == "__main__":
    main()
