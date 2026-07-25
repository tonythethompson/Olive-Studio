"""Weekly update script: refresh knowledge base from official sources."""

import json
from datetime import datetime, timezone
from pathlib import Path

from olive_mcp_server.fetchers import fetch_github_issues, fetch_official_docs, fetch_onnx_runtime_docs


def main() -> None:
    """Fetch external sources and write a freshness report.

    This is a stub. In production it should parse the fetched content,
    update JSON files, and flag deprecations.
    """
    kb_dir = Path(__file__).parent.parent / "olive_mcp_server" / "knowledge_base"
    report = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "sources": {
            "official_docs": fetch_official_docs(),
            "github": fetch_github_issues(),
            "onnx_runtime": fetch_onnx_runtime_docs(),
        },
        "note": "Implement actual content parsing and JSON merge in production.",
    }
    out_path = kb_dir / "update_report.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print(f"Update report written to {out_path}")


if __name__ == "__main__":
    main()
