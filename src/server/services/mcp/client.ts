/**
 * Olive MCP tool client used by HTTP routes and the AI chat knowledge path.
 * Spawns the project venv Python with olive-mcp-server on PYTHONPATH.
 */
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { getVenvPython } from "../venv/paths.ts";

const execFileAsync = promisify(execFile);

export type McpToolCallResult = { result?: unknown; error?: string };

function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "");
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildPythonEnv(): NodeJS.ProcessEnv {
  const serverDir = path.join(process.cwd(), "olive-mcp-server");
  const pythonPath = [serverDir, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter);
  return { ...process.env, PYTHONPATH: pythonPath };
}

function mcpServerDir(): string {
  return path.join(process.cwd(), "olive-mcp-server");
}

/** Invokes a single olive_mcp_server tool and returns its result. */
export async function callOliveMcpTool(
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<McpToolCallResult> {
  const batch = await callOliveMcpTools([{ toolName, args }]);
  return batch[0] ?? { error: `MCP tool ${toolName} returned no result` };
}

export type McpToolRequest = { toolName: string; args?: Record<string, unknown> };

/**
 * Invoke several MCP tools in one Python process (avoids N interpreter startups).
 * Results are aligned 1:1 with `requests`.
 */
export async function callOliveMcpTools(requests: McpToolRequest[]): Promise<McpToolCallResult[]> {
  if (requests.length === 0) return [];

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
    const { stdout, stderr } = await execFileAsync(getVenvPython(), ["-c", script, argsJson], {
      timeout: 45_000,
      cwd: mcpServerDir(),
      env: buildPythonEnv(),
      maxBuffer: 8 * 1024 * 1024,
    });
    const output = stdout.trim() || stderr.trim();
    try {
      const parsed = JSON.parse(output);
      if (!Array.isArray(parsed)) {
        return requests.map(() => ({ error: "MCP batch returned non-array JSON" }));
      }
      return requests.map((req, i) => {
        const row = parsed[i];
        if (!isObjectRecord(row)) return { error: `MCP tool ${req.toolName} missing from batch` };
        if (typeof row.error === "string" && row.error) return { error: row.error };
        const inner = row.result;
        if (isObjectRecord(inner) && typeof inner.error === "string" && inner.error) {
          return { error: String(inner.error) };
        }
        return { result: inner };
      });
    } catch {
      return requests.map((req) => ({
        error: output
          ? `MCP tool ${sanitizeToolName(req.toolName)} returned non-JSON: ${output.slice(0, 300)}`
          : `MCP tool ${sanitizeToolName(req.toolName)} returned empty output`,
      }));
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return requests.map((req) => ({
      error: msg || `MCP tool ${sanitizeToolName(req.toolName)} failed`,
    }));
  }
}
