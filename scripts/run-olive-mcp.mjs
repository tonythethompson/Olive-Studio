#!/usr/bin/env node
/**
 * Launch olive-mcp-server/run.py with the project venv interpreter when present.
 * Used by Kiro Power mcp.json so VIRTUAL_ENV alone is not relied on for lookup.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mcpDir = path.join(root, "olive-mcp-server");
const winPy = path.join(mcpDir, ".venv", "Scripts", "python.exe");
const nixPy = path.join(mcpDir, ".venv", "bin", "python");
const python = existsSync(winPy) ? winPy : existsSync(nixPy) ? nixPy : "python";
const runPy = path.join(mcpDir, "run.py");
const venvDir = existsSync(winPy) || existsSync(nixPy) ? path.join(mcpDir, ".venv") : undefined;

const child = spawn(python, [runPy, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: {
    ...process.env,
    PYTHONPATH: [mcpDir, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    ...(venvDir ? { VIRTUAL_ENV: venvDir } : {}),
  },
});
child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});
