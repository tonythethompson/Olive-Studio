"""Tools: validate_ui_state_recipe and get_recipe_for_ui_state.

Bridge to a local Olive Studio HTTP API for UIState-backed recipe validation
and building. Base URL comes only from ``OLIVE_STUDIO_API_URL`` (loopback
HTTP(S) only). Never shells out to or runs Olive.
"""

from __future__ import annotations

import ipaddress
import json
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

ENV_API_URL = "OLIVE_STUDIO_API_URL"
BRIDGE_PATH = "/api/mcp/studio-recipe"
DEFAULT_TIMEOUT_SECONDS = 5.0

_LOOPBACK_HOSTNAMES = frozenset({"localhost", "127.0.0.1", "::1"})

# TS camelCase → snake_case aliases accepted on bridge payloads.
_FIELD_ALIASES: dict[str, str] = {
    "effectiveState": "effective_state",
    "recipe": "recipe",
    "isRunnable": "is_runnable",
    "schemaErrors": "schema_errors",
    "pipelineIssues": "pipeline_issues",
    "localExecutionIssues": "local_execution_issues",
    "advisories": "advisories",
    "pipelineCriticalCount": "pipeline_critical_count",
    "criticalCount": "critical_count",
    "warnings": "warnings",
    "conversionWarnings": "conversion_warnings",
}

_REQUIRED_SUCCESS = ("effectiveState", "recipe", "isRunnable")


class _NoRedirect(HTTPRedirectHandler):
    """Refuse redirects so a loopback URL cannot bounce off-host (SSRF)."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        return None


_OPENER = build_opener(_NoRedirect)


def _err(code: str, message: str, *, detail: str | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"error": code, "message": message}
    if detail:
        out["detail"] = detail
    return out


def _studio_unavailable(message: str, *, detail: str | None = None) -> dict[str, Any]:
    return _err("studio_unavailable", message, detail=detail)


def _normalize_host(host: str | None) -> str:
    if not host:
        return ""
    h = host.strip().lower()
    if h.startswith("[") and h.endswith("]"):
        h = h[1:-1]
    return h


def _is_loopback_host(host: str | None) -> bool:
    """Allow localhost, 127.0.0.1, ::1, and any IP with is_loopback=True."""
    h = _normalize_host(host)
    if not h:
        return False
    if h in _LOOPBACK_HOSTNAMES:
        return True
    try:
        return ipaddress.ip_address(h).is_loopback
    except ValueError:
        return False


def _resolve_bridge_endpoint() -> tuple[str | None, dict[str, Any] | None]:
    """Read only ``OLIVE_STUDIO_API_URL``; never accept a caller-supplied URL."""
    raw = os.environ.get(ENV_API_URL, "").strip()
    if not raw:
        return None, _studio_unavailable(
            f"{ENV_API_URL} is not set. Start Olive Studio and point "
            f"{ENV_API_URL} at its loopback base URL (e.g. http://127.0.0.1:3000)."
        )

    parsed = urlparse(raw)
    if parsed.scheme not in ("http", "https"):
        return None, _studio_unavailable(
            f"{ENV_API_URL} must be an http(s) loopback URL.",
            detail=f"scheme={parsed.scheme!r}",
        )
    if parsed.username is not None or parsed.password is not None:
        return None, _studio_unavailable(
            f"{ENV_API_URL} must not include credentials.",
        )
    if not _is_loopback_host(parsed.hostname):
        return None, _studio_unavailable(
            f"{ENV_API_URL} must target a loopback host "
            "(127.0.0.1, localhost, or ::1).",
            detail=f"host={parsed.hostname!r}",
        )
    return raw.rstrip("/") + BRIDGE_PATH, None


def _parse_json_body(raw: bytes | str) -> Any | None:
    try:
        text = raw.decode("utf-8") if isinstance(raw, bytes) else raw
        return json.loads(text)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None


def _is_timeout_reason(reason: Any) -> bool:
    if isinstance(reason, TimeoutError):
        return True
    return "timed out" in str(reason).lower()


def _request_studio_recipe(
    ui_state: dict[str, Any],
    *,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    """POST ui_state to the fixed Studio bridge; failures → studio_unavailable."""
    endpoint, err = _resolve_bridge_endpoint()
    if err is not None:
        return err

    request = Request(
        endpoint,  # type: ignore[arg-type]
        data=json.dumps({"uiState": ui_state}).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )

    try:
        # URL is restricted to validated loopback http(s) only (SSRF guard).
        # Redirects disabled so the request cannot leave loopback.
        with _OPENER.open(request, timeout=timeout) as response:  # noqa: S310
            status = getattr(response, "status", None) or response.getcode()
            raw = response.read()
    except HTTPError as exc:
        try:
            body = exc.read() or b""
        except Exception:  # noqa: BLE001 — best-effort body read
            body = b""
        parsed = _parse_json_body(body)
        if isinstance(parsed, dict) and (
            "error" in parsed or _has_required_success_keys(parsed)
        ):
            return parsed
        return _studio_unavailable(
            "Olive Studio bridge returned an HTTP error.",
            detail=f"status={exc.code}",
        )
    except URLError as exc:
        reason = getattr(exc, "reason", exc)
        if _is_timeout_reason(reason):
            return _studio_unavailable(
                "Olive Studio bridge timed out.",
                detail=f"timeout_seconds={timeout}",
            )
        return _studio_unavailable(
            "Olive Studio bridge is not reachable.",
            detail=str(reason),
        )
    except TimeoutError:
        return _studio_unavailable(
            "Olive Studio bridge timed out.",
            detail=f"timeout_seconds={timeout}",
        )
    except OSError as exc:
        return _studio_unavailable(
            "Olive Studio bridge request failed.",
            detail=str(exc),
        )

    if status is not None and int(status) >= 400:
        return _studio_unavailable(
            "Olive Studio bridge returned an HTTP error.",
            detail=f"status={status}",
        )

    parsed = _parse_json_body(raw)
    if not isinstance(parsed, dict):
        return _err(
            "invalid_bridge_response",
            "Olive Studio bridge returned a non-object JSON payload.",
        )
    return parsed


def _get(payload: dict[str, Any], camel: str, default: Any = None) -> Any:
    """Read camelCase field, falling back to snake_case alias."""
    if camel in payload:
        return payload[camel]
    snake = _FIELD_ALIASES.get(camel)
    if snake and snake in payload:
        return payload[snake]
    return default


def _has_required_success_keys(payload: dict[str, Any]) -> bool:
    for key in _REQUIRED_SUCCESS:
        snake = _FIELD_ALIASES.get(key, key)
        if key not in payload and snake not in payload:
            return False
    return True


def _is_error_payload(payload: dict[str, Any]) -> bool:
    return "error" in payload and not _has_required_success_keys(payload)


def _check_success_payload(payload: dict[str, Any]) -> dict[str, Any] | None:
    """Return an error dict if payload is not a successful bridge result."""
    if not _has_required_success_keys(payload):
        missing = [k for k in _REQUIRED_SUCCESS if _get(payload, k) is None
                   and k not in payload and _FIELD_ALIASES.get(k, k) not in payload]
        return _err(
            "invalid_bridge_response",
            "Olive Studio bridge payload missing required fields.",
            detail=f"missing={missing}",
        )

    effective = _get(payload, "effectiveState")
    if not isinstance(effective, dict):
        return _err("invalid_bridge_response", "effectiveState must be an object.")

    recipe = _get(payload, "recipe")
    if not isinstance(recipe, dict):
        return _err("invalid_bridge_response", "recipe must be an object.")

    runnable = _get(payload, "isRunnable")
    if not isinstance(runnable, bool):
        return _err("invalid_bridge_response", "isRunnable must be a boolean.")

    return None


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def _validation_view(payload: dict[str, Any]) -> dict[str, Any]:
    """Compact validation projection (no full recipe)."""
    critical = _get(payload, "pipelineCriticalCount")
    if critical is None:
        critical = _get(payload, "criticalCount")

    return {
        "effective_state": _get(payload, "effectiveState"),
        "schema_errors": _as_list(_get(payload, "schemaErrors", [])),
        "pipeline_issues": _as_list(_get(payload, "pipelineIssues", [])),
        "pipeline_critical_count": critical,
        "local_execution_issues": _as_list(_get(payload, "localExecutionIssues", [])),
        "advisories": _as_list(_get(payload, "advisories", [])),
        "is_runnable": bool(_get(payload, "isRunnable")),
    }


def _recipe_view(payload: dict[str, Any]) -> dict[str, Any]:
    """Validation view plus olive_recipe and conversion_warnings."""
    conversion = _get(payload, "conversionWarnings")
    warnings = _as_list(conversion if conversion is not None else _get(payload, "warnings", []))
    return {
        **_validation_view(payload),
        "olive_recipe": _get(payload, "recipe"),
        "conversion_warnings": warnings,
    }


def _evaluate_ui_state(ui_state: Any) -> dict[str, Any]:
    """Validate input, call bridge once, check response shape."""
    if ui_state is None:
        return _err("invalid_ui_state", "ui_state is required and must be a JSON object.")
    if not isinstance(ui_state, dict):
        return _err("invalid_ui_state", "ui_state must be a JSON object.")

    payload = _request_studio_recipe(ui_state)
    if _is_error_payload(payload):
        return payload

    shape_err = _check_success_payload(payload)
    return shape_err if shape_err is not None else payload


def validate_ui_state_recipe(ui_state: dict[str, Any] | None = None) -> dict[str, Any]:
    """Validate a (partial) UIState via the local Olive Studio bridge.

    Returns effective state, schema/pipeline/runtime issues, advisories, and
    ``is_runnable``. Does not run Olive.

    Args:
        ui_state: Complete or allowed-partial UI state object.

    Returns:
        Validation projection, or structured error
        (``studio_unavailable`` / ``invalid_ui_state`` / ``invalid_bridge_response``).
    """
    payload = _evaluate_ui_state(ui_state)
    return payload if _is_error_payload(payload) else _validation_view(payload)


def get_recipe_for_ui_state(ui_state: dict[str, Any] | None = None) -> dict[str, Any]:
    """Build and validate an Olive recipe for a (partial) UIState via Studio.

    Same evaluation as ``validate_ui_state_recipe``, plus ``olive_recipe`` and
    ``conversion_warnings``. Does not run Olive.

    Args:
        ui_state: Complete or allowed-partial UI state object.

    Returns:
        Full recipe projection, or structured error
        (``studio_unavailable`` / ``invalid_ui_state`` / ``invalid_bridge_response``).
    """
    payload = _evaluate_ui_state(ui_state)
    return payload if _is_error_payload(payload) else _recipe_view(payload)
