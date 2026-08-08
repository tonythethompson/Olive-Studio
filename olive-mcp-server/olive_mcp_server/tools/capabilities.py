"""Tool: get_mcp_capabilities.

Reports server capability state for agents (not transport/process health).
Process/transport health belongs to the client (mcporter list --status, IDE).
"""

from __future__ import annotations

import os
from typing import Any
from urllib.parse import urlparse

from olive_mcp_server import __version__
from olive_mcp_server.tools import KB_DIR
from olive_mcp_server.tools.embeddings import MODEL_NAME, is_model_loaded
from olive_mcp_server.tools.index_store import shipped_index_status
from olive_mcp_server.tools.retrieval import get_retrieval_mode, get_semantic_budget_ms

# Versioned agent contract; bump when required tools/schemas change intentionally.
TOOLSET_VERSION = "2026.08.0-phase3"

# Loopback hosts accepted for Studio bridge (mirrors studio bridge policy).
_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1", "[::1]"})


def _kb_version() -> str:
    """Content fingerprint surrogate: max mtime of KB JSON files."""
    mtimes: list[float] = []
    try:
        # Sorted for stable iteration (mtime aggregate is order-independent,
        # but keep path walks consistent with docs_search indexing).
        for path in sorted(KB_DIR.glob("*.json"), key=lambda p: p.name):
            try:
                mtimes.append(path.stat().st_mtime)
            except OSError:
                continue
    except OSError:
        return "unknown"
    if not mtimes:
        return "empty"
    return f"mtime-{int(max(mtimes))}"


def _semantic_available() -> bool:
    """Cheap check — do not import sentence_transformers (slow cold start)."""
    try:
        import importlib.util

        return importlib.util.find_spec("sentence_transformers") is not None
    except Exception:
        return False


def _studio_url_status() -> tuple[bool, str | None]:
    """Return (configured_and_loopback_valid, reason_if_not)."""
    raw = (os.environ.get("OLIVE_STUDIO_API_URL") or "").strip()
    if not raw:
        return False, "OLIVE_STUDIO_API_URL is not set"
    try:
        parsed = urlparse(raw)
    except Exception:
        return False, "OLIVE_STUDIO_API_URL is not a valid URL"
    if parsed.scheme not in ("http", "https"):
        return False, "OLIVE_STUDIO_API_URL must use http or https"
    host = (parsed.hostname or "").lower()
    if host not in _LOOPBACK_HOSTS and host not in {h.strip("[]") for h in _LOOPBACK_HOSTS}:
        # Allow bare IPv6 without brackets form already handled by urlparse
        if host not in ("127.0.0.1", "localhost", "::1"):
            return False, "OLIVE_STUDIO_API_URL host must be loopback"
    if parsed.username or parsed.password:
        return False, "OLIVE_STUDIO_API_URL must not include credentials"
    return True, None


def get_mcp_capabilities(probe_studio: bool = False) -> dict[str, Any]:
    """Report Olive MCP capability state for agent routing.

    Args:
        probe_studio: When True and Studio URL is configured, attempt a short
            reachability check. Default False (no network).

    Returns:
        Capability object: versions, semantic state, retrieval defaults,
        studio config flags, and job_control (stub until job phase).
    """
    mode = get_retrieval_mode()
    budget_ms = get_semantic_budget_ms()
    sem_available = _semantic_available()
    sem_ready = is_model_loaded()
    studio_ok, studio_reason = _studio_url_status()

    studio_reachable: bool | None = None
    if probe_studio and studio_ok:
        studio_reachable = _probe_studio()
    elif not studio_ok:
        studio_reachable = False

    # Phase 3: inspection/validate always advertised; submit/cancel follow Studio policy.
    policy = _fetch_studio_policy() if studio_ok else None
    inspection = True if policy is None else bool(policy.get("allowJobInspection", True))
    submission = False if policy is None else bool(policy.get("allowJobSubmission", False))
    cancellation = False if policy is None else bool(policy.get("allowJobCancellation", False))
    mcp_access = True if policy is None else bool(policy.get("mcpAccess", True))

    if not studio_ok:
        job_control = {
            "supported": True,
            "enabled": False,
            "ready": False,
            "reason": "studio_unavailable",
            "inspection": True,
            "validation": True,
            "submission": False,
            "cancellation": False,
        }
    elif not mcp_access:
        job_control = {
            "supported": True,
            "enabled": False,
            "ready": False,
            "reason": "mcp_access_disabled",
            "inspection": False,
            "validation": False,
            "submission": False,
            "cancellation": False,
        }
    elif studio_reachable is False:
        job_control = {
            "supported": True,
            "enabled": True,
            "ready": False,
            "reason": "studio_unreachable",
            "inspection": inspection,
            "validation": inspection or submission,
            "submission": submission,
            "cancellation": cancellation,
        }
    else:
        ready = bool(inspection or submission or cancellation)
        job_control = {
            "supported": True,
            "enabled": True,
            "ready": ready if studio_reachable is not False else False,
            "reason": "ready" if studio_reachable is True else "studio_configured_unprobed",
            "inspection": inspection,
            "validation": inspection or submission,
            "submission": submission,
            "cancellation": cancellation,
            "policy": policy,
        }

    return {
        "server": {
            "name": "olive-mcp-server",
            "version": __version__,
        },
        "kb": {
            "version": _kb_version(),
            "index": shipped_index_status(),
        },
        "semantic": {
            "available": sem_available,
            "ready": sem_ready,
            "model": MODEL_NAME if sem_available else None,
        },
        "retrieval": {
            "default_mode": mode,
            "semantic_budget_ms": budget_ms,
        },
        "studio": {
            "configured": studio_ok,
            "reachable": studio_reachable,
            "reason": None if studio_ok else studio_reason,
        },
        "job_control": job_control,
        "toolset": {
            "version": TOOLSET_VERSION,
        },
    }


def _probe_studio(timeout_s: float = 2.0) -> bool:
    """Best-effort GET against Studio base URL."""
    try:
        from .studio_loopback import studio_request

        payload = studio_request("GET", "/api/health", timeout=timeout_s)
        # health may be plain {ok:true} or error shape
        if isinstance(payload, dict) and payload.get("error") == "studio_unavailable":
            return False
        return True
    except Exception:
        return False


def _fetch_studio_policy() -> dict[str, Any] | None:
    """Load Studio agent-access policy when reachable."""
    try:
        from .studio_loopback import studio_request

        payload = studio_request("GET", "/api/olive/agent-access", timeout=2.0)
        if not isinstance(payload, dict) or payload.get("error"):
            return None
        policy = payload.get("policy")
        return policy if isinstance(policy, dict) else None
    except Exception:
        return None
