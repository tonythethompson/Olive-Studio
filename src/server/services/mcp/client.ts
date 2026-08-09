/**
 * Olive MCP tool client used by HTTP routes and the AI chat knowledge path.
 *
 * Delegates to the persistent stdio MCP client for low-latency tool calls.
 * The persistent client maintains a long-lived child process running
 * `python -m olive_mcp_server` with JSON-RPC over stdin/stdout.
 */
export {
  callOliveMcpTool,
  callOliveMcpTools,
  MCP_UNAVAILABLE_ERROR,
  shutdownMcpClient,
  type McpToolCallResult,
  type McpToolRequest,
} from "./persistentClient.ts";

// Re-export path utilities for consumers that need them directly.
export { getMcpPython } from "./paths.ts";
