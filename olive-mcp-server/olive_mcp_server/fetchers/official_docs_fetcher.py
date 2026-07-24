"""Fetcher for https://microsoft.github.io/Olive/."""

from typing import Any

# SOURCE: https://microsoft.github.io/Olive/
OFFICIAL_DOCS_URL = "https://microsoft.github.io/Olive/"


def fetch_official_docs(pages: list[str] | None = None) -> dict[str, Any]:
    """Stub: fetch official Olive docs pages.

    Args:
        pages: List of doc paths to fetch. If None, fetches core pages.

    Returns:
        Dict mapping page path to markdown content.
    """
    return {
        "status": "stub",
        "source": OFFICIAL_DOCS_URL,
        "note": "Implement with requests/firecrawl to pull live docs. Use context7 or firecrawl for production.",
        "pages": pages or ["index", "passes", "tutorials"],
    }
