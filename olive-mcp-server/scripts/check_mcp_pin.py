"""Fail if project.dependencies lets mcp 2.x or newer resolve."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from packaging.requirements import Requirement

try:
    import tomllib
except ModuleNotFoundError:  # pragma: no cover
    import tomli as tomllib  # type: ignore[no-redef]


def mcp_requirement_from_deps(deps: list[str]) -> Requirement | None:
    for dep in deps:
        parsed = Requirement(dep)
        if parsed.name == "mcp":
            return parsed
    return None


def allows_mcp_two_or_newer(spec) -> bool:
    """True if any released mcp 2+ version satisfies the specifier."""
    if not spec:
        return True
    for major in range(2, 32):
        for minor in (0, 1, 99):
            for micro in (0, 1, 99):
                raw = f"{major}.{minor}.{micro}"
                if spec.contains(raw, prereleases=False):
                    return True
    return False


def pin_excludes_two_plus(dep: str) -> bool:
    req = Requirement(dep)
    if req.name != "mcp":
        return False
    return not allows_mcp_two_or_newer(req.specifier)


def verify_pyproject(path: Path) -> str:
    data = tomllib.load(path.open("rb"))
    deps = data.get("project", {}).get("dependencies", [])
    req = mcp_requirement_from_deps(deps)
    if req is None:
        raise SystemExit("mcp dependency is missing from project.dependencies")
    if not req.specifier:
        raise SystemExit("mcp dependency must be pinned below 2 (unpinned specifier)")
    if allows_mcp_two_or_newer(req.specifier):
        raise SystemExit(
            f"mcp dependency must not allow 2.x or newer (e.g. 'mcp>=1,<2'). Got: {req}"
        )
    return str(req)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "pyproject",
        nargs="?",
        type=Path,
        default=Path("pyproject.toml"),
    )
    args = parser.parse_args(argv)
    req = verify_pyproject(args.pyproject)
    print(f"MCP constraint: {req}")
    print("mcp pin excludes 2.x and newer")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as exc:  # pragma: no cover
        print(f"::error::{exc}", file=sys.stderr)
        raise SystemExit(1) from exc
