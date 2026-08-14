#!/usr/bin/env node
/**
 * Shared Olive MCP server venv/Python probing helpers.
 *
 * Used by both scripts/postinstall-mcp-setup.mjs (bare `node`, runs before any
 * build tooling exists during `pnpm install`) and
 * src/server/services/mcp/ensureMcpSetup.ts (bundled server code, packaged
 * desktop first-launch setup). Kept as plain ESM here (not TypeScript) so the
 * postinstall script can import it with zero build step.
 *
 * `python`/`cmd` arguments below are never user-controlled: they only ever
 * come from a fixed candidate list (`python`/`python3`) or a path this module
 * itself constructs under a known `.venv` directory, and none of the
 * spawn calls use a shell -- so there's no command-injection surface here.
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

/** Resolves the venv's python executable for an MCP server dir, if it exists. */
export function venvPython(mcpDir) {
  const winPy = path.join(mcpDir, ".venv", "Scripts", "python.exe");
  const nixPy = path.join(mcpDir, ".venv", "bin", "python");
  if (existsSync(winPy)) return winPy;
  if (existsSync(nixPy)) return nixPy;
  return null;
}

/** Whether the given venv python can actually import the pinned `mcp` package. */
export function venvIsWorking(python, mcpDir) {
  // `mcp` (pinned <2) has no __version__ attribute -- just check it imports.
  const r = spawnSync(python, ["-c", "import mcp"], {
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: mcpDir },
  });
  return r.status === 0;
}

/** Finds a system Python >= 3.10 on PATH, preferring the platform-native command name first. */
export function findSystemPython() {
  const candidates = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
  for (const cmd of candidates) {
    const r = spawnSync(cmd, ["--version"], { encoding: "utf8" });
    if (r.status === 0) {
      const match = /Python 3\.(\d+)/.exec(r.stdout || r.stderr || "");
      if (match && Number(match[1]) >= 10) return cmd;
    }
  }
  return null;
}
