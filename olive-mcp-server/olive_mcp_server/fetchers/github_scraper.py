"""Fetcher for Olive GitHub releases and issues."""

from typing import Any

import requests

REPO = "microsoft/Olive"
RELEASES_URL = f"https://api.github.com/repos/{REPO}/releases"
ISSUES_URL = f"https://api.github.com/repos/{REPO}/issues"


def _issue_to_text(issue: dict[str, Any]) -> str:
    title = issue.get("title", "")
    number = issue.get("number", "")
    body = issue.get("body") or ""
    labels = [label.get("name", "") for label in issue.get("labels", [])]
    return f"## #{number} {title}\nLabels: {', '.join(labels)}\n{body}"


def _release_to_text(release: dict[str, Any]) -> str:
    name = release.get("name", "")
    tag = release.get("tag_name", "")
    body = release.get("body") or ""
    return f"## {name} ({tag})\n{body}"


def fetch_github_issues(labels: list[str] | None = None, max_results: int = 50) -> dict[str, Any]:
    """Fetch recent Olive GitHub issues and release notes.

    Args:
        labels: Issue labels to filter on, e.g. ["bug", "quantization"].
        max_results: Maximum number of issues to retrieve.

    Returns:
        Dict with releases and issue summaries as a single text body.
    """
    result: dict[str, Any] = {
        "status": "ok",
        "source": f"https://github.com/{REPO}",
        "labels": labels or [],
        "max_results": max_results,
    }

    try:
        params: dict[str, str | int] = {"state": "open", "per_page": max_results}
        if labels:
            params["labels"] = ",".join(labels)

        issues_response = requests.get(ISSUES_URL, params=params, timeout=30)
        issues_response.raise_for_status()
        issues = issues_response.json()

        releases_response = requests.get(f"{RELEASES_URL}?per_page=5", timeout=30)
        releases_response.raise_for_status()
        releases = releases_response.json()

        sections = ["# Recent Releases"]
        sections.extend(_release_to_text(r) for r in releases[:5])
        sections.append("# Open Issues")
        sections.extend(_issue_to_text(i) for i in issues[:max_results])

        result["content"] = "\n\n".join(sections)
    except Exception as exc:  # noqa: BLE001
        result["status"] = "error"
        result["error"] = str(exc)

    return result
