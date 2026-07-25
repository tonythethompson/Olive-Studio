"""Fetcher for https://microsoft.github.io/Olive/."""

from typing import Any

# SOURCE: https://microsoft.github.io/Olive/
OFFICIAL_DOCS_URL = "https://microsoft.github.io/Olive/"


def fetch_official_docs(pages: list[str] | None = None) -> dict[str, Any]:
    """
    Describe the official Olive documentation pages selected for fetching.
    
    Args:
        pages: Documentation page paths to select. Defaults to the core pages
            ``index``, ``passes``, and ``tutorials``.
    
    Returns:
        A status dictionary containing the documentation source URL, selected page
        paths, and a note about the unimplemented fetch operation.
    """
    return {
        "status": "stub",
        "source": OFFICIAL_DOCS_URL,
        "note": "Implement with requests/firecrawl to pull live docs. Use context7 or firecrawl for production.",
        "pages": pages or ["index", "passes", "tutorials"],
    }
