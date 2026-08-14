"""Mocked HTTP tests for knowledge-base fetchers."""

from __future__ import annotations

from collections import defaultdict

from olive_mcp_server.fetchers import github_scraper
from olive_mcp_server.fetchers import official_docs_fetcher as docs
from olive_mcp_server.fetchers import onnx_runtime_fetcher as ort


class Response:
    def __init__(self, text: str = "", status_code: int = 200, payload=None):
        self.text = text
        self.status_code = status_code
        self.headers = {"Content-Type": "text/html"}
        self._payload = payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._payload


class Session:
    def __init__(self, responses):
        self.responses = responses
        self.urls = []

    def get(self, url, **kwargs):
        self.urls.append(url)
        return self.responses[url].pop(0)


HTML = """
<html><body><nav>bad nav</nav><main><h1>Title</h1>
<aside class="sidebar">bad sidebar</aside><p>Text</p><ul><li>one</li></ul>
<pre>key: value</pre></main></body></html>
"""


def test_official_docs_resolution_and_markdown(monkeypatch):
    session = Session({
        "https://microsoft.github.io/Olive/index.html": [Response(HTML)],
    })
    monkeypatch.setattr("olive_mcp_server.fetchers._http.get_session", lambda: session)
    result = docs.fetch_official_docs(pages=["index"])
    assert result["status"] == "ok"
    assert session.urls == ["https://microsoft.github.io/Olive/index.html"]
    assert "# Title" in result["pages"]["index"]
    assert "- one" in result["pages"]["index"]
    assert "```" in result["pages"]["index"]
    assert "bad nav" not in result["pages"]["index"]
    assert result["sources"]["index"].endswith("index.html")


def test_official_docs_unknown_falls_back(monkeypatch):
    url = "https://microsoft.github.io/Olive/custom.html"
    session = Session({
        "https://microsoft.github.io/Olive/custom": [Response(status_code=404)],
        url: [Response(HTML)],
    })
    monkeypatch.setattr("olive_mcp_server.fetchers._http.get_session", lambda: session)
    result = docs.fetch_official_docs(pages=["custom"])
    assert result["status"] == "ok"
    assert session.urls == ["https://microsoft.github.io/Olive/custom", url]


def test_ort_uses_case_sensitive_slugs_and_cpu_overview(monkeypatch):
    urls = {
        "https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html": [Response(HTML)],
        "https://onnxruntime.ai/docs/execution-providers/": [Response(HTML)],
    }
    session = Session(urls)
    monkeypatch.setattr("olive_mcp_server.fetchers._http.get_session", lambda: session)
    result = ort.fetch_onnx_runtime_docs(["CUDAExecutionProvider", "CPUExecutionProvider"])
    assert result["status"] == "ok"
    assert "cuda-executionprovider" not in session.urls
    assert result["pages"]["CPUExecutionProvider"].startswith("# CPU")


def test_github_filters_prs_and_paginates(monkeypatch):
    calls = []
    issue_pages = [
        [
            {"number": 1, "title": "issue", "updated_at": "2024-01-01T00:00:00Z"},
            {"number": 2, "pull_request": {}, "title": "pr"},
        ],
        [{"number": 3, "title": "issue 2", "updated_at": "2024-02-01T00:00:00Z"}],
    ]

    def get(url, **kwargs):
        calls.append((url, kwargs))
        if url == github_scraper.ISSUES_URL:
            payload = issue_pages.pop(0)
        else:
            payload = [{"name": "release", "published_at": "2024-03-01T00:00:00Z"}]
        return Response(payload=payload)

    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("GH_TOKEN", raising=False)
    monkeypatch.setattr(github_scraper.requests, "get", get)
    result = github_scraper.fetch_github_issues(max_results=2)
    assert "# 2 pr" not in result["content"]
    assert "## #3 issue 2" in result["content"]
    assert result["source_timestamp"] == "2024-03-01T00:00:00Z"
    assert "Authorization" not in calls[0][1]["headers"]
