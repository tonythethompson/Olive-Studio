/**
 * Resolve a Python interpreter for MCP smoke / local tooling.
 * Prefers project venvs, then the first PATH command that responds to --version.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * @param {string} cmd
 * @param {{ spawnSync?: typeof spawnSync, platform?: NodeJS.Platform }} [deps]
 */
export function commandOnPath(cmd, deps = {}) {
  const spawn = deps.spawnSync ?? spawnSync;
  const platform = deps.platform ?? process.platform;
  const r = spawn(cmd, ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
    shell: platform === "win32",
  });
  return r.status === 0;
}

/**
 * @param {string} root repo root
 * @param {{
 *   existsSync?: typeof existsSync,
 *   spawnSync?: typeof spawnSync,
 *   platform?: NodeJS.Platform,
 * }} [deps]
 * @returns {string} absolute venv python path or a PATH command name
 */
export function resolvePython(root, deps = {}) {
  const exists = deps.existsSync ?? existsSync;
  const platform = deps.platform ?? process.platform;
  const candidates = [
    path.join(root, "olive-mcp-server", ".venv", "bin", "python"),
    path.join(root, "olive-mcp-server", ".venv", "Scripts", "python.exe"),
    path.join(root, ".venv", "bin", "python"),
    path.join(root, ".venv", "Scripts", "python.exe"),
    // Prefer python3 on Unix CI images; still probe `python` for Windows / py-launcher hosts.
    "python3",
    "python",
  ];

  for (const c of candidates) {
    const isBare = c === "python3" || c === "python";
    if (isBare) {
      if (commandOnPath(c, { spawnSync: deps.spawnSync, platform })) return c;
      continue;
    }
    if (exists(c)) return c;
  }

  throw new Error(
    "No Python interpreter found (checked project .venv, python3, and python on PATH)",
  );
}
