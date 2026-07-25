"""Fetcher for ONNX Runtime execution provider docs."""

from typing import Any

import requests
from bs4 import BeautifulSoup

ONNX_RUNTIME_EP_URL = "https://onnxruntime.ai/docs/execution-providers/"


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


def fetch_onnx_runtime_docs(execution_providers: list[str] | None = None) -> dict[str, Any]:
    """Fetch EP-specific operator support and gotchas.

    Args:
        execution_providers: EPs to query. If None, queries all common EPs.

    Returns:
        Dict mapping EP name to Markdown docs content or error info.
    """
    eps = execution_providers if execution_providers is not None else [
        "CPUExecutionProvider",
        "CUDAExecutionProvider",
        "TensorrtExecutionProvider",
        "CoreMLExecutionProvider",
        "QNNExecutionProvider",
        "OpenVINOExecutionProvider",
    ]
    result: dict[str, Any] = {
        "status": "ok",
        "source": ONNX_RUNTIME_EP_URL,
        "pages": {},
    }

    # ONNX Runtime doc slugs use the EP name without the "ExecutionProvider"
    # suffix and lowercased, e.g. "CUDA-ExecutionProvider".
    def _slug(ep: str) -> str:
        return ep.replace("ExecutionProvider", "").lower()

    for ep in eps:
        candidates = [
            f"{ONNX_RUNTIME_EP_URL}{_slug(ep)}-ExecutionProvider.html",
            f"{ONNX_RUNTIME_EP_URL}{_slug(ep)}-executionprovider.html",
            f"{ONNX_RUNTIME_EP_URL}{_slug(ep)}-ExecutionProvider/",
        ]
        last_error = "No URL candidates tried"
        for url in candidates:
            try:
                response = requests.get(url, timeout=30)
                response.raise_for_status()
                result["pages"][ep] = _markdown_from_html(response.text)
                break
            except Exception as exc:  # noqa: BLE001
                last_error = str(exc)
        else:
            result["pages"][ep] = {"error": last_error}
            result["status"] = "partial"

    # Always fetch the main landing page as a fallback/aggregate source.
    try:
        main_response = requests.get(ONNX_RUNTIME_EP_URL, timeout=30)
        main_response.raise_for_status()
        result["overview"] = _markdown_from_html(main_response.text)
    except Exception as exc:  # noqa: BLE001
        result["overview_error"] = str(exc)
        result["status"] = "partial"

    if all(isinstance(v, dict) and "error" in v for v in result["pages"].values()) and "overview_error" in result:
        result["status"] = "error"

    return result
