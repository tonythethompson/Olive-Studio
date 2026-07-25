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
