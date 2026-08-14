#!/usr/bin/env node
/**
 * Postinstall: auto-run the Olive MCP server setup (venv + deps) so a plain
 * `pnpm install` leaves MCP ready to use, without a separate manual step.
 *
 * Guarded so it never blocks or fails `pnpm install`:
 *   - skipped in CI (CI=true)
 *   - skipped via OLIVE_SKIP_MCP_SETUP=1
 *   - skipped if olive-mcp-server/ isn't present (e.g. published npm package)
 *   - no-op if the venv already has a working `mcp` install
 *   - missing system Python only warns, never fails
 *   - a failed setup-mcp run only warns, never fails
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mcpDir = path.join(root, "olive-mcp-server");

function log(msg) {
  console.log(`[postinstall-mcp-setup] ${msg}`);
}

if (process.env.OLIVE_SKIP_MCP_SETUP) {
  log("skipped (OLIVE_SKIP_MCP_SETUP set).");
  process.exit(0);
}

if (process.env.CI) {
  log("skipped in CI.");
  process.exit(0);
}

if (!existsSync(mcpDir)) {
  // Published npm package / CLI install has no olive-mcp-server source.
  process.exit(0);
}

function venvPython() {
  const winPy = path.join(mcpDir, ".venv", "Scripts", "python.exe");
  const nixPy = path.join(mcpDir, ".venv", "bin", "python");
  if (existsSync(winPy)) return winPy;
  if (existsSync(nixPy)) return nixPy;
  return null;
}

function venvIsWorking(python) {
  // `mcp` (pinned <2) has no __version__ attribute -- just check it imports.
  const r = spawnSync(python, ["-c", "import mcp"], {
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: mcpDir },
  });
  return r.status === 0;
}

const existingPython = venvPython();
if (existingPython && venvIsWorking(existingPython)) {
  log("MCP server venv already set up, nothing to do.");
  process.exit(0);
}

function findSystemPython() {
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

if (!findSystemPython()) {
  log(
    "WARNING: Python >= 3.10 not found on PATH — skipping MCP server setup. " +
      "Install Python, then run: .\\scripts\\setup-mcp.ps1 (or ./scripts/setup-mcp.sh) to enable it.",
  );
  process.exit(0);
}

log("Setting up Olive MCP server (one-time; subsequent installs will skip this)...");

const result =
  process.platform === "win32"
    ? spawnSync("powershell", ["-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts", "setup-mcp.ps1")], {
        stdio: "inherit",
        cwd: root,
      })
    : spawnSync("bash", [path.join(root, "scripts", "setup-mcp.sh")], {
        stdio: "inherit",
        cwd: root,
      });

if (result.status !== 0) {
  log(
    "WARNING: MCP server setup failed. The app still works without it. " +
      "Retry manually with: .\\scripts\\setup-mcp.ps1 (or ./scripts/setup-mcp.sh)",
  );
}

process.exit(0);
