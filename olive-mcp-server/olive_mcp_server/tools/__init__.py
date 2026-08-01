"""Shared helpers for Olive MCP tools.

Heavy tool modules (docs search, etc.) are imported lazily via ``__getattr__``
so the HTTP diagnosis path can load ``troubleshooting`` without requiring
BeautifulSoup / requests in the project .venv.
"""

from __future__ import annotations

import importlib
import json
from pathlib import Path
from typing import Any

KB_DIR = Path(__file__).parent.parent / "knowledge_base"

_LAZY_EXPORTS: dict[str, tuple[str, str]] = {
    "get_cli_command": (".cli_helper", "get_cli_command"),
    "get_model_compatibility": (".compatibility", "get_model_compatibility"),
    "get_pass_config_template": (".config_generator", "get_pass_config_template"),
    "get_data_config_template": (".data_config", "get_data_config_template"),
    "search_olive_documentation": (".docs_search", "search_olive_documentation"),
    "get_hardware_optimization_guide": (".hardware_guide", "get_hardware_optimization_guide"),
    "get_integration_recipe": (".integration_recipes", "get_integration_recipe"),
    "get_olive_passes": (".pass_catalog", "get_olive_passes"),
    "get_pass_chain": (".pass_chain", "get_pass_chain"),
    "get_pass_parameters": (".pass_parameters", "get_pass_parameters"),
    "get_quantization_strategy": (".strategy_advisor", "get_quantization_strategy"),
    "evaluate_optimization_tradeoff": (".tradeoff", "evaluate_optimization_tradeoff"),
    "troubleshoot_olive_error": (".troubleshooting", "troubleshoot_olive_error"),
    "diagnose_error": (".troubleshooting", "diagnose_error"),
    "get_error_frequency_summary": (".troubleshooting", "get_error_frequency_summary"),
}


def load_json(name: str) -> dict[str, Any]:
    path = KB_DIR / name
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_passes() -> list[dict[str, Any]]:
    return load_json("passes.json").get("passes", [])


def load_hardware_profiles() -> list[dict[str, Any]]:
    return load_json("hardware_profiles.json").get("profiles", [])


def load_quirks() -> dict[str, Any]:
    return load_json("quirks.json").get("categories", {})


def load_troubleshooting() -> list[dict[str, Any]]:
    entries = load_json("troubleshooting.json").get("entries", [])
    return [_normalize_entry(e, default_domain="olive") for e in entries]


def load_studio_troubleshooting() -> list[dict[str, Any]]:
    try:
        entries = load_json("studio_troubleshooting.json").get("entries", [])
    except FileNotFoundError:
        return []
    return [_normalize_entry(e, default_domain="studio") for e in entries]


def _normalize_entry(entry: dict[str, Any], default_domain: str) -> dict[str, Any]:
    """Copy entry with domain / applyable defaults for diagnose routing."""
    out = dict(entry)
    domain = out.get("domain") or default_domain
    out["domain"] = domain if domain in ("olive", "studio") else default_domain
    if "applyable" not in out:
        cfg = out.get("updated_config")
        out["applyable"] = isinstance(cfg, dict) and len(cfg) > 0
    else:
        out["applyable"] = bool(out["applyable"])
    return out


def load_compatibility_matrix() -> list[dict[str, Any]]:
    return load_json("compatibility_matrix.json").get("models", [])


def load_integration_recipes() -> list[dict[str, Any]]:
    return load_json("integration_recipes.json").get("recipes", [])


def __getattr__(name: str) -> Any:
    target = _LAZY_EXPORTS.get(name)
    if target is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    module_name, attr = target
    module = importlib.import_module(module_name, __name__)
    value = getattr(module, attr)
    globals()[name] = value
    return value


__all__ = [
    "get_cli_command",
    "get_model_compatibility",
    "get_pass_config_template",
    "get_data_config_template",
    "search_olive_documentation",
    "get_hardware_optimization_guide",
    "get_integration_recipe",
    "get_olive_passes",
    "get_pass_chain",
    "get_pass_parameters",
    "get_quantization_strategy",
    "evaluate_optimization_tradeoff",
    "troubleshoot_olive_error",
    "diagnose_error",
    "get_error_frequency_summary",
    "KB_DIR",
    "load_json",
    "load_passes",
    "load_hardware_profiles",
    "load_quirks",
    "load_troubleshooting",
    "load_studio_troubleshooting",
    "load_compatibility_matrix",
    "load_integration_recipes",
]
