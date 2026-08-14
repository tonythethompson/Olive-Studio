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
 * Python support mirrors scripts/setup-mcp.{sh,ps1}: >= 3.10 and < 3.14
 * (torch / sentence-transformers do not ship 3.14 wheels yet).
 *
 * `python`/`cmd` arguments below are never user-controlled: they only ever
 * come from a fixed candidate list (`python3.13` ... `python`, the Windows
 * `py` launcher), a path this module itself constructs under a known `.venv`
 * directory, or a well-known uv-managed install directory under the user's
 * home/LOCALAPPDATA -- and none of the spawn calls use a shell -- so there's
 * no command-injection surface here.
 */
import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

export const PYTHON_MIN_MINOR = 10;
// Exclusive intent: 3.14+ is unsupported. Kept as the max accepted minor.
export const PYTHON_MAX_MINOR = 13;

/** Minor version of a CPython 3.x invocation, or null when it isn't one. */
function pythonMinor(cmd, prefixArgs = []) {
  // nosemgrep: javascript.lang.security.detect-child-process -- cmd is from fixed candidate lists / paths this module constructs, see module header
  const r = spawnSync(cmd, [...prefixArgs, "--version"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  const match = /Python 3\.(\d+)/.exec(r.stdout || r.stderr || "");
  return match ? Number(match[1]) : null;
}

function inSupportedRange(minor) {
  return minor !== null && minor >= PYTHON_MIN_MINOR && minor <= PYTHON_MAX_MINOR;
}

/** Resolves the venv's python executable for an MCP server dir, if it exists. */
export function venvPython(mcpDir) {
  const winPy = path.join(mcpDir, ".venv", "Scripts", "python.exe");
  const nixPy = path.join(mcpDir, ".venv", "bin", "python");
  if (existsSync(winPy)) return winPy;
  if (existsSync(nixPy)) return nixPy;
  return null;
}

/**
 * Whether the given venv is usable by the MCP server: its Python is in the
 * supported range and the MCP + semantic-search deps are installed.
 */
export function venvIsWorking(python, mcpDir) {
  if (!inSupportedRange(pythonMinor(python))) return false;
  // `mcp` (pinned <2) has no __version__ attribute -- just check it imports.
  // sentence-transformers is probed via metadata so this stays fast (a real
  // import would pull in torch); a broken torch install is screened out by
  // the Python-version range check above.
  const r = spawnSync(
    python,
    ["-c", "import mcp, importlib.metadata; importlib.metadata.version('sentence-transformers')"],
    {
      encoding: "utf8",
      env: { ...process.env, PYTHONPATH: mcpDir },
    },
  );
  return r.status === 0;
}

/** Absolute paths of uv-managed CPython interpreters, newest acceptable first. */
function uvManagedPythons() {
  const bases = [];
  if (process.env.LOCALAPPDATA) bases.push(path.join(process.env.LOCALAPPDATA, "uv", "python"));
  bases.push(path.join(os.homedir(), ".local", "share", "uv", "python"));
  bases.push(path.join(os.homedir(), "Library", "Application Support", "uv", "python"));

  const bins = [];
  for (const base of bases) {
    let entries;
    try {
      entries = readdirSync(base);
    } catch {
      continue;
    }
    for (const minor of [13, 12, 11, 10]) {
      const dirs = entries.filter((e) => e.startsWith(`cpython-3.${minor}.`)).sort().reverse();
      for (const dir of dirs) {
        const winBin = path.join(base, dir, "python.exe");
        if (existsSync(winBin)) {
          bins.push(winBin);
          continue;
        }
        const nixBin = path.join(base, dir, "bin", `python3.${minor}`);
        if (existsSync(nixBin)) bins.push(nixBin);
      }
    }
  }
  return bins;
}

/**
 * Finds a system Python in the supported range (3.13/3.12 preferred):
 * versioned PATH commands, the Windows `py` launcher, then uv-managed
 * installs (which are usually not on PATH).
 *
 * Returns the exact argv to spawn (`py` keeps its version flag). Callers
 * that only need a boolean can use `findSystemPython()`.
 */
export function findSystemPythonSpec() {
  const versioned = ["python3.13", "python3.12", "python3.11", "python3.10"];
  const candidates =
    process.platform === "win32" ? ["python", ...versioned, "python3"] : [...versioned, "python3", "python"];
  for (const cmd of candidates) {
    if (inSupportedRange(pythonMinor(cmd))) return { cmd, args: [] };
  }
  if (process.platform === "win32") {
    for (const flag of ["-3.13", "-3.12", "-3.11", "-3.10"]) {
      if (inSupportedRange(pythonMinor("py", [flag]))) return { cmd: "py", args: [flag] };
    }
  }
  for (const bin of uvManagedPythons()) {
    if (inSupportedRange(pythonMinor(bin))) return { cmd: bin, args: [] };
  }
  return null;
}

/** First supported interpreter command, or null. Prefer `findSystemPythonSpec()` to spawn. */
export function findSystemPython() {
  return findSystemPythonSpec()?.cmd ?? null;
}
