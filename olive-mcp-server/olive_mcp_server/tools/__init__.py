"""Shared helpers for Olive MCP tools."""

import json
from pathlib import Path
from typing import Any

KB_DIR = Path(__file__).parent.parent / "knowledge_base"


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
    return load_json("troubleshooting.json").get("entries", [])


def load_compatibility_matrix() -> list[dict[str, Any]]:
    return load_json("compatibility_matrix.json").get("models", [])


def load_integration_recipes() -> list[dict[str, Any]]:
    return load_json("integration_recipes.json").get("recipes", [])


# Tool functions exposed for callers that import the tools package directly
# (e.g. server.ts's generic MCP caller).
from .cli_helper import get_cli_command
from .compatibility import get_model_compatibility
from .config_generator import get_pass_config_template
from .data_config import get_data_config_template
from .docs_search import search_olive_documentation
from .hardware_guide import get_hardware_optimization_guide
from .integration_recipes import get_integration_recipe
from .pass_catalog import get_olive_passes
from .pass_chain import get_pass_chain
from .pass_parameters import get_pass_parameters
from .strategy_advisor import get_quantization_strategy
from .tradeoff import evaluate_optimization_tradeoff
from .troubleshooting import troubleshoot_olive_error, get_error_frequency_summary

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
    "get_error_frequency_summary",
    "KB_DIR",
    "load_json",
    "load_passes",
    "load_hardware_profiles",
    "load_quirks",
    "load_troubleshooting",
    "load_compatibility_matrix",
    "load_integration_recipes",
]
