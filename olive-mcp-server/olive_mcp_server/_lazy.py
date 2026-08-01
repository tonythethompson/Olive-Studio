"""Shared helper for lazily resolving ``name -> (module, attribute)`` mappings.

Several package ``__init__`` modules (and ``mcp_server``) expose a set of
names that are each backed by a submodule, but should only be imported on
first use so optional dependencies (BeautifulSoup, requests, mcp) stay
optional for callers that only need a subset of tools.
"""

from __future__ import annotations

import importlib
from typing import Any


def resolve_lazy_attr(
    name: str,
    mapping: dict[str, tuple[str, str]],
    cache: dict[str, Any],
    package: str,
) -> Any | None:
    """Import and cache the attribute mapped to ``name``.

    Returns ``None`` if ``name`` is not present in ``mapping``, so callers can
    decide whether that means "raise AttributeError" (module ``__getattr__``)
    or "unknown tool" (dynamic dispatch).
    """
    if name in cache:
        return cache[name]
    target = mapping.get(name)
    if target is None:
        return None
    module_name, attr = target
    module = importlib.import_module(module_name, package)
    value = getattr(module, attr)
    cache[name] = value
    return value