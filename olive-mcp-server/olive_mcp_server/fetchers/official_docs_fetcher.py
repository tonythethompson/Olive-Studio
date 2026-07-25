"""Fetcher for https://microsoft.github.io/Olive/."""

from typing import Any

import requests
from bs4 import BeautifulSoup

# SOURCE: https://microsoft.github.io/Olive/
OFFICIAL_DOCS_URL = "https://microsoft.github.io/Olive/"


def _markdown_from_html(html: str) -> str:
    """Convert an HTML page to a simple Markdown string for downstream parsing."""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()

    lines: list[str] = []
    for elem in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li"]):
        text = elem.get_text(strip=True)
        if not text:
            continue
        if elem.name in ("h1", "h2", "h3", "h4", "h5", "h6"):
            level = int(elem.name[1])
            lines.append(f"{'#' * level} {text}")
        elif elem.name == "li":
            lines.append(f"- {text}")
        else:
            lines.append(text)
    return "\n\n".join(lines)


def _try_fetch(url: str) -> str:
    """Fetch a URL and return its Markdown content, raising on failure."""
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    return _markdown_from_html(response.text)


def fetch_official_docs(pages: list[str] | None = None) -> dict[str, Any]:
    """Fetch official Olive docs pages.

    Args:
        pages: List of doc paths to fetch. If None, fetches core pages.

    Returns:
        Dict mapping page path to Markdown content or error info.
    """
    target_pages = pages if pages is not None else ["index", "passes", "tutorials"]
    result: dict[str, Any] = {
        "status": "ok",
        "source": OFFICIAL_DOCS_URL,
        "pages": {},
    }

    for page in target_pages:
        candidates = [
            f"{OFFICIAL_DOCS_URL}{page}/",
            f"{OFFICIAL_DOCS_URL}{page}.html",
            f"{OFFICIAL_DOCS_URL}{page}",
        ]
        last_error = "No URL candidates tried"
        for url in candidates:
            try:
                result["pages"][page] = _try_fetch(url)
                break
            except Exception as exc:  # noqa: BLE001
                last_error = str(exc)
        else:
            result["pages"][page] = {"error": last_error}
            result["status"] = "partial"

    if all(isinstance(v, dict) and "error" in v for v in result["pages"].values()):
        result["status"] = "error"

    return result
