"""Fetcher for ONNX Runtime execution provider docs."""

from typing import Any

ONNX_RUNTIME_EP_URL = "https://onnxruntime.ai/docs/execution-providers/"


def fetch_onnx_runtime_docs(execution_providers: list[str] | None = None) -> dict[str, Any]:
    """Stub: fetch EP-specific operator support and gotchas.

    Args:
        execution_providers: EPs to query. If None, queries all common EPs.

    Returns:
        Dict mapping EP name to docs content/operator list.
    """
    eps = execution_providers or [
        "CPUExecutionProvider",
        "CUDAExecutionProvider",
        "TensorrtExecutionProvider",
        "CoreMLExecutionProvider",
        "QNNExecutionProvider",
        "OpenVINOExecutionProvider",
    ]
    return {
        "status": "stub",
        "source": ONNX_RUNTIME_EP_URL,
        "note": "Implement with requests/firecrawl; extract operator support tables and known limitations.",
        "execution_providers": eps,
    }
