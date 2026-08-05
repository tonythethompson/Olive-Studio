/**
 * Olive MCP tool client used by HTTP routes and the AI chat knowledge path.
 * Prefers olive-mcp-server/.venv, then the repo-root .venv.
 */
import { execFile } from "child_process";
import { existsSync } from "fs";
import { promisify } from "util";
import path from "path";
import { getVenvPython } from "../venv/paths.ts";
import mcpBreaker from "./breaker.ts";

const execFileAsync = promisify(execFile);

/** Client-safe message returned when the MCP server is short-circuited or down. */
export const MCP_UNAVAILABLE_ERROR =
  "MCP server unavailable — verify the Olive MCP server is installed before retrying.";

/** Resolves the Python executable used to run MCP tools.

 * @returns The path to the `olive-mcp-server` virtual environment's Python executable, or the repository virtual environment's executable when the former is unavailable.
 */
export function getMcpPython(): string {
  const mcpVenvPython =
    process.platform === "win32"
      ? path.join(process.cwd(), "olive-mcp-server", ".venv", "Scripts", "python.exe")
      : path.join(process.cwd(), "olive-mcp-server", ".venv", "bin", "python");
  if (existsSync(mcpVenvPython)) return mcpVenvPython;
  return getVenvPython();
}

export type McpToolCallResult = { result?: unknown; error?: string; unavailable?: boolean };

/**
 * Removes characters that are not supported in an MCP tool name.
 *
 * @param name - The tool name to sanitize
 * @returns The name containing only letters, digits, underscores, and hyphens
 */
function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "");
}

/**
 * Determines whether a value is a non-null, non-array object record.
 *
 * @param value - The value to classify
 * @returns `true` if the value is a record of string keys, `false` otherwise.
 */
function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Builds the environment variables used to run the Olive MCP server.
 *
 * @returns The current process environment with `olive-mcp-server` prepended to `PYTHONPATH`
 */
function buildPythonEnv(): NodeJS.ProcessEnv {
  const serverDir = path.join(process.cwd(), "olive-mcp-server");
  const pythonPath = [serverDir, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
  return { ...process.env, PYTHONPATH: pythonPath };
}

/**
 * Resolves the path to the Olive MCP server directory.
 *
 * @returns The absolute path to `olive-mcp-server` under the current working directory.
 */
function mcpServerDir(): string {
  return path.join(process.cwd(), "olive-mcp-server");
}

/**
 * Invokes a single Olive MCP tool.
 *
 * @param toolName - The name of the tool to invoke
 * @param args - Arguments to pass to the tool
 * @returns The tool result or an error describing why the invocation failed
 */
export async function callOliveMcpTool(
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<McpToolCallResult> {
  const batch = await callOliveMcpTools([{ toolName, args }]);
  return batch[0] ?? { error: `MCP tool ${toolName} returned no result` };
}

export type McpToolRequest = { toolName: string; args?: Record<string, unknown> };

/**
 * Invokes multiple MCP tools in a single Python process and preserves result order.
 *
 * @param requests - The MCP tool calls to execute.
 * @returns One result or error entry for each request, in the same order.
 */
export async function callOliveMcpTools(requests: McpToolRequest[]): Promise<McpToolCallResult[]> {
  if (requests.length === 0) return [];

  if (!mcpBreaker.beforeCall()) {
    return requests.map(() => ({ error: MCP_UNAVAILABLE_ERROR, unavailable: true }));
  }

  const payload = requests.map((r) => ({
    tool: sanitizeToolName(r.toolName),
    args: r.args ?? {},
  }));
  const argsJson = JSON.stringify(payload);
  const script = [
    "import json, sys",
    "from olive_mcp_server.mcp_server import call_tool",
    "calls = json.loads(sys.argv[1])",
    "out = []",
    "for c in calls:",
    "  name = c.get('tool') or ''",
    "  args = c.get('args') if isinstance(c.get('args'), dict) else {}",
    "  try:",
    "    out.append({'tool': name, 'result': call_tool(name, args)})",
    "  except Exception as exc:",
    "    out.append({'tool': name, 'error': str(exc)})",
    "print(json.dumps(out, default=str))",
  ].join("\n");

  try {
    const { stdout, stderr } = await execFileAsync(getMcpPython(), ["-c", script, argsJson], {
      timeout: 45_000,
      cwd: mcpServerDir(),
      env: buildPythonEnv(),
      maxBuffer: 8 * 1024 * 1024,
    });
    const output = stdout.trim() || stderr.trim();
    try {
      const parsed = JSON.parse(output);
      if (!Array.isArray(parsed)) {
        mcpBreaker.recordFailure();
        return requests.map(() => ({ error: "MCP batch returned non-array JSON", unavailable: true }));
      }
      const results = requests.map((req, i) => {
        const row = parsed[i];
        if (!isObjectRecord(row)) {
          return { error: `MCP tool ${req.toolName} missing from batch`, unavailable: true };
        }
        if (typeof row.error === "string" && row.error) return { error: row.error };
        const inner = row.result;
        if (isObjectRecord(inner) && typeof inner.error === "string" && inner.error) {
          return { error: String(inner.error) };
        }
        return { result: inner };
      });
      if (results.some((r) => r.unavailable === true)) {
        // A missing row is a protocol/contract violation — infra failure, like non-array JSON.
        mcpBreaker.recordFailure();
      } else {
        mcpBreaker.recordSuccess();
      }
      return results;
    } catch {
      mcpBreaker.recordFailure();
      return requests.map((req) => ({
        error: output
          ? `MCP tool ${sanitizeToolName(req.toolName)} returned non-JSON: ${output.slice(0, 300)}`
          : `MCP tool ${sanitizeToolName(req.toolName)} returned empty output`,
        unavailable: true,
      }));
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    mcpBreaker.recordFailure();
    return requests.map((req) => ({
      error: msg || `MCP tool ${sanitizeToolName(req.toolName)} failed`,
      unavailable: true,
    }));
  }
}
