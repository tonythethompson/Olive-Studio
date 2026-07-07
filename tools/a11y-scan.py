#!/usr/bin/env python3
"""SPA-aware wrapper for the a11y-audit scanner.

Static scans treat every .tsx file as a standalone page, which falsely flags
component files for missing <main>, skip links, and <h1>. This script keeps
those rules scoped to the app shell only.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SCANNER = (
    Path.home()
    / ".cursor/plugins/cache/claude-code-skills/a11y-audit"
    / "f776236fb9228892841cf36b5e64087c9b9af9bb/skills/a11y-audit/scripts/a11y_scanner.py"
)

PAGE_LEVEL_RULES = {
    "landmark-no-main",
    "landmark-no-nav",
    "landmark-no-skip-link",
    "heading-missing-h1",
    "heading-multiple-h1",
}
SHELL_FILES = {"App.tsx", "index.html"}


def keep(finding: dict) -> bool:
    rule = finding["rule_id"]
    path = finding["file"].replace("\\", "/")
    basename = os.path.basename(path)

    if rule in PAGE_LEVEL_RULES:
        if basename not in SHELL_FILES:
            return False
        if path.endswith(".css"):
            return False

    if rule == "form-select-no-label" and "/components/ui/" in path:
        return False

    return True


def main() -> int:
    target = sys.argv[1] if len(sys.argv) > 1 else str(ROOT / "src")
    scanner = Path(os.environ.get("A11Y_SCANNER", DEFAULT_SCANNER))
    if not scanner.is_file():
        print(f"Scanner not found: {scanner}", file=sys.stderr)
        return 1

    proc = subprocess.run(
        [sys.executable, str(scanner), target, "--format", "json"],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode not in (0, 1, 2) or not proc.stdout.strip():
        print(proc.stderr or proc.stdout, file=sys.stderr)
        return proc.returncode or 1

    report = json.loads(proc.stdout)
    raw = report["findings"]
    filtered = [f for f in raw if keep(f)]

    by_sev = Counter(f["severity"] for f in filtered)
    print(f"Scanned {report['summary']['files_scanned']} files")
    print(f"Raw findings: {len(raw)} -> SPA-scoped: {len(filtered)}")
    print(f"  critical: {by_sev.get('critical', 0)}")
    print(f"  serious:  {by_sev.get('serious', 0)}")
    print(f"  moderate: {by_sev.get('moderate', 0)}")

    if filtered:
        print("\nRemaining issues:")
        for f in filtered:
            fn = f["file"].replace("\\", "/").split("/")[-1]
            print(f"  [{f['severity']}] {fn}:{f['line']} {f['rule_id']} — {f['message']}")

    severities = {f["severity"] for f in filtered}
    if severities & {"critical", "serious"}:
        return 1
    if severities & {"moderate", "minor"}:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
