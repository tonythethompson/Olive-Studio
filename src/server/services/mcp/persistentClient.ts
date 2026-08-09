/**
 * Persistent MCP client using stdio transport.
 *
 * Maintains a long-lived child process running `python -m olive_mcp_server`
 * and communicates via JSON-RPC over stdin/stdout (MCP protocol). Tool calls
 * complete in <50ms (warm) vs ~500ms per subprocess spawn.
 *
 * Connection lifecycle: idle → connecting → connected → (crash) → reconnecting.
 * The circuit breaker governs spawn failures / crashes; tool-level errors
 * (bad args, unknown tool) never trip the breaker.
 */
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import mcpBreaker, { type McpCallAdmission } from "./breaker.ts";
import { getMcpPython, buildPythonEnv, mcpServerDir } from "./paths.ts";

export type McpToolCallResult = { result?: unknown; error?: string; unavailable?: boolean };
export type McpToolRequest = { toolName: string; args?: Record<string, unknown> };

/** Client-safe message returned when the MCP server is short-circuited or down. */
export const MCP_UNAVAILABLE_ERROR =
  "MCP server unavailable — verify the Olive MCP server is installed before retrying.";

// ─── Connection State Machine ──────────────────────────────────────────

type ConnectionState = "idle" | "connecting" | "connected" | "crashed";

let state: ConnectionState = "idle";
let client: Client | null = null;
let transport: StdioClientTransport | null = null;
/** Pending connect() promise — prevents concurrent connection attempts. */
let connectingPromise: Promise<void> | null = null;

// ─── Internal helpers ──────────────────────────────────────────────────

function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "");
}

/**
 * Spawn the MCP server child process and establish a JSON-RPC connection.
 * Resolves when the client has completed the MCP initialize handshake.
 */
async function connect(): Promise<void> {
  if (state === "connected" && client) return;
  if (connectingPromise) return connectingPromise;

  connectingPromise = (async () => {
    state = "connecting";
    try {
      const python = getMcpPython();
      const env = buildPythonEnv();
      const cwd = mcpServerDir();

      transport = new StdioClientTransport({
        command: python,
        args: ["-m", "olive_mcp_server"],
        env: { ...env } as Record<string, string>,
        cwd,
        stderr: "pipe",
      });

      // Log stderr from the MCP server for diagnostics (don't suppress errors).
      const stderrStream = transport.stderr;
      if (stderrStream && "on" in stderrStream) {
        (stderrStream as NodeJS.ReadableStream).on("data", (chunk: Buffer) => {
          const line = chunk.toString().trim();
          if (line) {
            // Only log non-empty lines to avoid noise
            process.stderr.write(`[olive-mcp] ${line}\n`);
          }
        });
      }

      transport.onclose = () => {
        if (state === "connected") {
          state = "crashed";
          client = null;
          transport = null;
        }
      };

      client = new Client({ name: "olive-studio", version: "0.1.0" });
      await client.connect(transport);
      state = "connected";
    } catch {
      state = "crashed";
      client = null;
      transport = null;
      throw new Error("Failed to connect to Olive MCP server");
    } finally {
      connectingPromise = null;
    }
  })();

  return connectingPromise;
}

// ─── Public API (same signatures as the old client.ts) ─────────────────

/**
 * Invokes a single Olive MCP tool via the persistent stdio connection.
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

/**
 * Invokes multiple MCP tools sequentially on the persistent connection.
 * Preserves result order.
 *
 * @param requests - The MCP tool calls to execute.
 * @returns One result or error entry for each request, in the same order.
 */
export async function callOliveMcpTools(requests: McpToolRequest[]): Promise<McpToolCallResult[]> {
  if (requests.length === 0) return [];

  // ── Circuit breaker gate ──
  const admission = mcpBreaker.beforeCall();
  if (!admission) {
    return requests.map(() => ({ error: MCP_UNAVAILABLE_ERROR, unavailable: true }));
  }
  const { epoch } = admission as McpCallAdmission;

  // ── Ensure connection ──
  try {
    await connect();
  } catch {
    mcpBreaker.recordFailure(epoch);
    return requests.map(() => ({ error: MCP_UNAVAILABLE_ERROR, unavailable: true }));
  }

  if (!client || state !== "connected") {
    mcpBreaker.recordFailure(epoch);
    return requests.map(() => ({ error: MCP_UNAVAILABLE_ERROR, unavailable: true }));
  }

  // Snapshot the client reference — onclose can null it between iterations.
  const activeClient = client;

  // ── Execute tool calls sequentially ──
  const results: McpToolCallResult[] = [];
  let hadInfraFailure = false;
  const MCP_CALL_TIMEOUT_MS = 45_000;

  for (const req of requests) {
    // Check connection is still alive before each call
    if (state !== "connected" || !activeClient) {
      hadInfraFailure = true;
      results.push({ error: MCP_UNAVAILABLE_ERROR, unavailable: true });
      break;
    }
    try {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const toolResult = await Promise.race([
        activeClient.callTool({
          name: sanitizeToolName(req.toolName),
          arguments: req.args ?? {},
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            reject(new Error(`MCP tool call timed out after ${MCP_CALL_TIMEOUT_MS / 1000} seconds`));
          }, MCP_CALL_TIMEOUT_MS);
        }),
      ]).finally(() => {
        if (timeout) clearTimeout(timeout);
      });

      // MCP callTool returns { content: [...], isError?: boolean }
      if (toolResult.isError) {
        // Tool-level error (bad args, validation failure) — extract message
        const errorText = extractTextContent(toolResult.content);
        results.push({ error: errorText || `MCP tool ${req.toolName} failed` });
      } else {
        // Success — extract the JSON result from content blocks
        const parsed = parseToolContent(toolResult.content);
        results.push({ result: parsed });
      }
    } catch (err: unknown) {
      // Transport/protocol failure — infrastructure error
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("timed out")) {
        // A timed-out request may still be in flight; close the session so it
        // cannot poison subsequent calls on the persistent connection.
        try {
          void activeClient.close().catch(() => undefined);
        } catch {
          // Best effort — the connection is marked crashed below.
        }
      }
      if (isInfraError(msg)) {
        hadInfraFailure = true;
        results.push({ error: msg || `MCP tool ${req.toolName} failed`, unavailable: true });
        // Connection may be dead — break out and fail remaining
        break;
      }
      // Tool-level exception (e.g. method not found)
      results.push({ error: msg || `MCP tool ${req.toolName} failed` });
    }
  }

  // Fill remaining requests if we broke early
  while (results.length < requests.length) {
    results.push({ error: MCP_UNAVAILABLE_ERROR, unavailable: true });
  }

  // ── Update breaker ──
  if (hadInfraFailure) {
    mcpBreaker.recordFailure(epoch);
    // Mark connection as crashed for next attempt
    state = "crashed";
    client = null;
    transport = null;
  } else {
    mcpBreaker.recordSuccess(epoch);
  }

  return results;
}

// ─── Content extraction helpers ────────────────────────────────────────

/**
 * Extract text from MCP content blocks.
 */
function extractTextContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const texts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object" && "text" in block && typeof block.text === "string") {
      texts.push(block.text);
    }
  }
  return texts.join("\n");
}

/**
 * Parse tool result content into a usable value.
 * MCP tools typically return a single text block containing JSON.
 */
function parseToolContent(content: unknown): unknown {
  const text = extractTextContent(content);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Return raw text if not JSON
    return text;
  }
}

/**
 * Determine if an error message indicates infrastructure failure
 * (transport broken, process dead) vs a tool-level error.
 */
function isInfraError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("transport") ||
    m.includes("connection") ||
    m.includes("closed") ||
    m.includes("econnrefused") ||
    m.includes("epipe") ||
    m.includes("spawn") ||
    m.includes("killed") ||
    m.includes("timeout") ||
    m.includes("not connected")
  );
}

// ─── Lifecycle ─────────────────────────────────────────────────────────

/**
 * Gracefully shut down the MCP client and kill the child process.
 * Called on Express server shutdown.
 */
export async function shutdownMcpClient(): Promise<void> {
  if (client) {
    try {
      await client.close();
    } catch {
      // Best-effort shutdown
    }
  }
  client = null;
  transport = null;
  state = "idle";
  connectingPromise = null;
}

/**
 * Resets the persistent client state (for tests).
 */
export function resetPersistentClient(): void {
  client = null;
  transport = null;
  state = "idle";
  connectingPromise = null;
}
