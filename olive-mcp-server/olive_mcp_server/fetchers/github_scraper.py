"""Fetcher for Olive GitHub releases and issues."""

from typing import Any

REPO = "microsoft/Olive"
RELEASES_URL = f"https://api.github.com/repos/{REPO}/releases"
ISSUES_URL = f"https://api.github.com/repos/{REPO}/issues"


def fetch_github_issues(labels: list[str] | None = None, max_results: int = 50) -> dict[str, Any]:
    """Stub: fetch recent Olive GitHub issues and release notes.

    Args:
        labels: Issue labels to filter on, e.g. ["bug", "quantization"].
        max_results: Maximum number of issues to retrieve.

    Returns:
        Dict with releases and issue summaries.
    """
    return {
        "status": "stub",
        "source": f"https://github.com/{REPO}",
        "note": "Implement with GitHub API; respect rate limits and store summaries in quirks DB.",
        "labels": labels or [],
        "max_results": max_results,
    }
