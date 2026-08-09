/**
 * Shared path resolution utilities for the Olive MCP server.
 * Used by both the persistent client and any legacy fallback.
 */
import { existsSync } from "fs";
import path from "path";
import { getVenvPython } from "../venv/paths.ts";

/**
 * Resolves the Python executable used to run MCP tools.
 * Prefers olive-mcp-server/.venv, then repo-root .venv.
 *
 * @returns The path to the Python executable
 */
export function getMcpPython(): string {
  const mcpVenvPython =
    process.platform === "win32"
      ? path.join(process.cwd(), "olive-mcp-server", ".venv", "Scripts", "python.exe")
      : path.join(process.cwd(), "olive-mcp-server", ".venv", "bin", "python");
  if (existsSync(mcpVenvPython)) return mcpVenvPython;
  return getVenvPython();
}

/**
 * Builds the environment variables used to run the Olive MCP server.
 *
 * @returns The current process environment with `olive-mcp-server` prepended to `PYTHONPATH`
 */
export function buildPythonEnv(): NodeJS.ProcessEnv {
  const serverDir = path.join(process.cwd(), "olive-mcp-server");
  const pythonPath = [serverDir, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
  return { ...process.env, PYTHONPATH: pythonPath };
}

/**
 * Resolves the path to the Olive MCP server directory.
 *
 * @returns The absolute path to `olive-mcp-server` under the current working directory.
 */
export function mcpServerDir(): string {
  return path.join(process.cwd(), "olive-mcp-server");
}
