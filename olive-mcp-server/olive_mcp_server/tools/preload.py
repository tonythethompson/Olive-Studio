"""Optional warm-path for long-lived MCP hosts (Phase 1).

Set ``OLIVE_MCP_PRELOAD_EMBEDDINGS=1`` to load the embedding model and
shipped/runtime KB indexes at process start (before accepting traffic).
"""

from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)


def _truthy(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


def maybe_preload_embeddings() -> dict[str, bool]:
    """Warm model + indexes when env requests it. Safe no-op otherwise."""
    if not _truthy("OLIVE_MCP_PRELOAD_EMBEDDINGS"):
        return {"requested": False, "done": False}

    logger.info("Preloading embeddings and KB indexes (OLIVE_MCP_PRELOAD_EMBEDDINGS=1)")
    from olive_mcp_server.tools import load_studio_troubleshooting, load_troubleshooting
    from olive_mcp_server.tools.docs_search import get_or_build_kb_index
    from olive_mcp_server.tools.embeddings import encode_query
    from olive_mcp_server.tools.troubleshooting import _get_troubleshooting_index

    # Touch model
    encode_query("preload")
    get_or_build_kb_index()
    _get_troubleshooting_index(load_troubleshooting())
    _get_troubleshooting_index(load_studio_troubleshooting())
    logger.info("Embedding preload complete")
    return {"requested": True, "done": True}
