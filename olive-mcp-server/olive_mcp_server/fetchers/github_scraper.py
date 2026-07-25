"""Fetcher for Olive GitHub releases and issues."""

from typing import Any

REPO = "microsoft/Olive"
RELEASES_URL = f"https://api.github.com/repos/{REPO}/releases"
ISSUES_URL = f"https://api.github.com/repos/{REPO}/issues"


def fetch_github_issues(labels: list[str] | None = None, max_results: int = 50) -> dict[str, Any]:
    """
    Provide a placeholder response for retrieving Olive GitHub issues and release notes.
    
    Parameters:
        labels (list[str] | None): Optional issue labels to include in the response.
        max_results (int): Maximum number of issues requested.
    
    Returns:
        dict[str, Any]: A stub response containing the repository source, requested
            filters, maximum result count, and implementation note.
    """
    return {
        "status": "stub",
        "source": f"https://github.com/{REPO}",
        "note": "Implement with GitHub API; respect rate limits and store summaries in quirks DB.",
        "labels": labels or [],
        "max_results": max_results,
    }
