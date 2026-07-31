#!/usr/bin/env python3
"""Cross-platform launcher for the Olive MCP server.

Prefers a project virtual environment when available, then falls back to the
Python interpreter that invoked this script. It adds the olive-mcp-server source
directory to PYTHONPATH so the package can run without being installed.
"""

import os
import subprocess
import sys
from pathlib import Path


def find_venv_python(script_dir: Path, project_root: Path) -> Path | None:
    """Return the venv Python executable if one exists.

    Checks the olive-mcp-server local venv first (matching the setup documented
    in AGENTS.md), then the repository-root venv, preserving existing behavior.
    """
    candidates = [
        # olive-mcp-server/.venv (created by the documented setup flow)
        script_dir / ".venv" / "Scripts" / "python.exe",
        script_dir / ".venv" / "bin" / "python",
        # Repository-root .venv / venv (legacy / monorepo-wide env)
        project_root / ".venv" / "Scripts" / "python.exe",
        project_root / ".venv" / "bin" / "python",
        project_root / "venv" / "Scripts" / "python.exe",
        project_root / "venv" / "bin" / "python",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def main() -> int:
    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent

    venv_python = find_venv_python(script_dir, project_root)
    python = str(venv_python) if venv_python else sys.executable

    env = os.environ.copy()
    env["PYTHONPATH"] = str(script_dir) + os.pathsep + env.get("PYTHONPATH", "")

    return subprocess.run(
        [python, "-m", "olive_mcp_server"],
        env=env,
    ).returncode


if __name__ == "__main__":
    raise SystemExit(main())
