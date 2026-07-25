"""Tool: troubleshoot_olive_error."""

from typing import Any

from . import load_json, load_quirks


def _score(entry: dict[str, Any], error_message: str, pass_name: str, config_context: str) -> int:
    """
    Count troubleshooting patterns from an entry that appear in the provided error context.
    
    Parameters:
    	entry (dict[str, Any]): Troubleshooting entry containing a `patterns` collection.
    	error_message (str): Error message to search.
    	pass_name (str): Name of the processing pass to include in the search.
    	config_context (str): Configuration context to include in the search.
    
    Returns:
    	int: Number of entry patterns found in the combined search text.
    """
    text = f"{error_message} {pass_name or ''} {config_context or ''}".lower()
    return sum(1 for p in entry.get("patterns", []) if p.lower() in text)


def troubleshoot_olive_error(
    error_message: str,
    pass_name: str = "",
    config_context: str = "",
) -> dict[str, Any]:
    """
    Diagnose an Olive implementation error using the local troubleshooting knowledge base.
    
    Args:
        error_message: The error message or traceback snippet.
        pass_name: The Olive pass where the error occurred, if known.
        config_context: Relevant configuration context.
    
    Returns:
        A dictionary containing the matched entry identifier, title, root cause,
        workaround, updated configuration, and relevant quantization quirks.
    """
    data = load_json("troubleshooting.json")
    entries = data.get("entries", [])

    scored = [(entry, _score(entry, error_message, pass_name, config_context)) for entry in entries]
    scored.sort(key=lambda x: x[1], reverse=True)

    matched_entry = None
    if scored and scored[0][1] > 0:
        best = scored[0][0]
        matched_entry = best.get("id")
    else:
        best = {
            "title": "No exact match found",
            "root_cause": "The error does not match a known entry in the local knowledge base.",
            "solution": "Check official Olive docs and GitHub issues; reduce to a minimal repro and verify input model, pass order, and data config.",
            "updated_config": {},
        }

    return {
        "matched_entry": matched_entry,
        "title": best.get("title", ""),
        "root_cause": best.get("root_cause", ""),
        "workaround": best.get("solution", ""),
        "updated_config": best.get("updated_config", {}),
        "relevant_quirks": [q["title"] for q in load_quirks().get("quantization", [])[:2]],
    }
