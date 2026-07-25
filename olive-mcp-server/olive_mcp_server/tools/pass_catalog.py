"""Tool: get_olive_passes."""

from typing import Any

from . import load_passes


def get_olive_passes(filter: str | None = None) -> dict[str, Any]:  # noqa: A002
    """List available Olive optimization passes, optionally filtered by category.


    Args:
        filter: Optional category name to match case-insensitively after
            surrounding whitespace is removed.
    
    Returns:
        A dictionary containing the normalized filter, the number of matching
        passes, and the available pass descriptions.
    """
    passes = load_passes()
    requested = (filter or "").strip().lower()

    if requested:
        passes = [p for p in passes if p.get("type", "").lower() == requested]

    return {
        "filter": requested or None,
        "count": len(passes),
        "passes": passes,
    }
