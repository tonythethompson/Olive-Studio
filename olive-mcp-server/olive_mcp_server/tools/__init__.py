"""Shared helpers for Olive MCP tools."""

import json
import os
from pathlib import Path
from typing import Any

_KB_DIR = Path(__file__).parent.parent / "knowledge_base"


def _load_json(name: str) -> dict[str, Any]:
    """
    Load and parse a JSON file from the knowledge base.
    
    Parameters:
    	name (str): Name of the JSON file to load.
    
    Returns:
    	dict[str, Any]: Parsed JSON object.
    """
    path = _KB_DIR / name
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_passes() -> list[dict[str, Any]]:
    """Load the available optimization passes from the knowledge base.
    
    Returns:
        list[dict[str, Any]]: The configured optimization passes.
    """
    return _load_json("passes.json")["passes"]


def load_hardware_profiles() -> list[dict[str, Any]]:
    """Load the available hardware profiles.
    
    Returns:
        list[dict[str, Any]]: The hardware profile definitions.
    """
    return _load_json("hardware_profiles.json")["profiles"]


def load_quirks() -> dict[str, Any]:
    """Load the categorized hardware and software quirks from the knowledge base.
    
    Returns:
        dict[str, Any]: The quirk categories and their associated data.
    """
    return _load_json("quirks.json")["categories"]


def load_json(name: str) -> dict[str, Any]:
    """Load a JSON object from the knowledge base.
    
    Parameters:
        name (str): Name of the JSON file to load.
    
    Returns:
        dict[str, Any]: Parsed contents of the specified JSON file.
    """
    return _load_json(name)


def load_troubleshooting() -> list[dict[str, Any]]:
    """
    Load troubleshooting entries from the knowledge base.
    
    Returns:
    	list[dict[str, Any]]: The troubleshooting entries, or an empty list when none are defined.
    """
    return _load_json("troubleshooting.json").get("entries", [])


def load_compatibility_matrix() -> list[dict[str, Any]]:
    """Load the compatibility matrix entries from the knowledge base.
    
    Returns:
        list[dict[str, Any]]: The compatibility model entries, or an empty list if unavailable.
    """
    return _load_json("compatibility_matrix.json").get("models", [])
