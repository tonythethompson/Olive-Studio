#!/usr/bin/env node
/**
 * Session-start check: warn if the Olive MCP venv or mcp package is missing.
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mcpDir = path.join(root, "olive-mcp-server");
const winPy = path.join(mcpDir, ".venv", "Scripts", "python.exe");
const nixPy = path.join(mcpDir, ".venv", "bin", "python");
const python = existsSync(winPy) ? winPy : existsSync(nixPy) ? nixPy : null;

if (!python) {
  console.log(
    "WARNING: Olive MCP Server venv not found. Run: .\\scripts\\setup-mcp.ps1 (or ./scripts/setup-mcp.sh on Linux/macOS) to set up the MCP server with semantic search support.",
  );
  process.exit(0);
}

const r = spawnSync(python, ["-c", "import importlib.metadata; print(importlib.metadata.version('mcp'))"], {
  encoding: "utf8",
  env: { ...process.env, PYTHONPATH: mcpDir },
});
if (r.status !== 0) {
  console.log(
    "WARNING: MCP server deps may be incomplete. Run: .\\scripts\\setup-mcp.ps1 (or ./scripts/setup-mcp.sh) to reinstall.",
  );
}
