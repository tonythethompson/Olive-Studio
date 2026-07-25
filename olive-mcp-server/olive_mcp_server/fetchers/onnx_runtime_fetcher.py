"""Fetcher for ONNX Runtime execution provider docs."""

from typing import Any

ONNX_RUNTIME_EP_URL = "https://onnxruntime.ai/docs/execution-providers/"


def fetch_onnx_runtime_docs(execution_providers: list[str] | None = None) -> dict[str, Any]:
    """
    Describe the requested ONNX Runtime execution providers with placeholder documentation metadata.
    
    Parameters:
        execution_providers (list[str] | None): Execution provider names to describe. If omitted or empty, common providers are used.
    
    Returns:
        dict[str, Any]: A stub response containing the status, documentation source URL, implementation note, and execution provider names.
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
