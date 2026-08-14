"""Shared HTTP and HTML helpers for knowledge-base fetchers."""

from __future__ import annotations

import time
from email.utils import parsedate_to_datetime
from typing import Any

import requests
from bs4 import BeautifulSoup

from .. import __version__

DEFAULT_TIMEOUT = 15
_session: requests.Session | None = None


def get_session() -> requests.Session:
    """Return the lazily-created shared HTTP session."""
    global _session
    if _session is None:
        _session = requests.Session()
        _session.headers.update({
            "User-Agent": f"olive-mcp-server/{__version__} (knowledge-base refresh)",
        })
    return _session


def _retry_delay(response: Any, attempt: int) -> float:
    """Return a bounded delay honoring a server-provided Retry-After."""
    value = response.headers.get("Retry-After") if hasattr(response, "headers") else None
    if value:
        try:
            return min(float(value), 10.0)
        except ValueError:
            try:
                return min(max((parsedate_to_datetime(value).timestamp() - time.time()), 0), 10.0)
            except (TypeError, ValueError, OverflowError):
                pass
    return min(0.25 * (2**attempt), 4.0)


def fetch_html(url: str) -> str:
    """Fetch HTML with bounded retries for transient responses."""
    for attempt in range(3):
        response = get_session().get(url, timeout=DEFAULT_TIMEOUT, allow_redirects=False)
        if response.status_code in {429, 500, 502, 503, 504} and attempt < 2:
            time.sleep(_retry_delay(response, attempt))
            continue
        response.raise_for_status()
        location = response.headers.get("Location", "") if hasattr(response, "headers") else ""
        if response.status_code in {301, 302, 303, 307, 308} and location:
            raise requests.HTTPError(f"HTML request redirected unexpectedly to {location}")
        content_type = response.headers.get("Content-Type", "") if hasattr(response, "headers") else ""
        if content_type and "html" not in content_type.lower():
            raise requests.RequestException(f"Expected HTML response, got {content_type}")
        return response.text
    raise requests.RequestException(f"HTTP request failed after retries: {url}")


def markdown_from_html(html: str) -> str:
    """Convert documentation HTML into headings, prose, lists, and code fences."""
    soup = BeautifulSoup(html, "html.parser")
    main = soup.find("main") or soup.find(attrs={"role": "main"}) or soup.find("article") or soup
    for tag in main.find_all(["script", "style", "nav", "header", "footer", "form"]):
        tag.decompose()
    def is_sidebar(node: Any) -> bool:
        classes = " ".join(node.get("class", [])).lower()
        identifier = str(node.get("id", "")).lower()
        return node.name in {"aside", "div", "section"} and any(
            token in f"{classes} {identifier}"
            for token in ("sidebar", "toc", "table-of-contents")
        )

    for tag in main.find_all(is_sidebar):
        tag.decompose()

    lines: list[str] = []
    for elem in main.find_all(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "pre"]):
        if elem.name == "pre":
            text = elem.get_text("\n", strip=True)
            if text:
                lines.append(f"```\n{text}\n```")
            continue
        text = elem.get_text(" ", strip=True)
        if not text:
            continue
        if elem.name.startswith("h"):
            lines.append(f"{'#' * int(elem.name[1])} {text}")
        elif elem.name == "li":
            lines.append(f"- {text}")
        else:
            lines.append(text)
    return "\n\n".join(lines)
