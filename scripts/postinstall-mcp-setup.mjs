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
import { venvPython, venvIsWorking, findSystemPythonSpec } from "./mcpVenvProbe.mjs";

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

const existingPython = venvPython(mcpDir);
if (existingPython && venvIsWorking(existingPython, mcpDir)) {
  log("MCP server venv already set up, nothing to do.");
  process.exit(0);
}

const pythonSpec = findSystemPythonSpec();
if (!pythonSpec) {
  log(
    "WARNING: No compatible Python found (need 3.10-3.13; 3.14+ is unsupported) — skipping MCP server setup. " +
      "Install Python 3.13 or 3.12, then run: .\\scripts\\setup-mcp.ps1 (or ./scripts/setup-mcp.sh) to enable it.",
  );
  process.exit(0);
}

log("Setting up Olive MCP server (one-time; subsequent installs will skip this)...");

const setupEnv = {
  ...process.env,
  OLIVE_STUDIO_PYTHON: pythonSpec.cmd,
};
if (pythonSpec.args.length > 0) {
  setupEnv.OLIVE_STUDIO_PYTHON_ARGS = pythonSpec.args.join("\n");
}

const result =
  process.platform === "win32"
    ? spawnSync("powershell", ["-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts", "setup-mcp.ps1")], {
        stdio: "inherit",
        cwd: root,
        env: setupEnv,
      })
    : spawnSync("bash", [path.join(root, "scripts", "setup-mcp.sh")], {
        stdio: "inherit",
        cwd: root,
        env: setupEnv,
      });

if (result.status !== 0) {
  log(
    "WARNING: MCP server setup failed. The app still works without it. " +
      "Retry manually with: .\\scripts\\setup-mcp.ps1 (or ./scripts/setup-mcp.sh)",
  );
}

process.exit(0);
