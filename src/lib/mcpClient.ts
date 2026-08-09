/**
 * Client-side MCP tool fetch wrappers.
 * Async functions that POST to /api/mcp/tool — no React hooks, no state.
 */
import type {
  McpDiagnostic,
  McpTroubleshootFeedbackArgs,
  McpTroubleshootFeedbackError,
  McpTroubleshootFeedbackResult,
} from "@/types";
import { matchLocalLogDiagnostic } from "@/lib/logFailurePatterns";
import {
  parseMcpDiagnosticPayload,
  normalizeMcpTroubleshootFeedbackArgs,
  parseFeedbackToolPayload,
} from "@/lib/mcpPayload";

/**
 * Retrieves a troubleshooting diagnostic for the provided logs.
 *
 * @param logs - Log lines to analyze.
 * @param signal - Optional signal used to cancel the request.
 * @returns An object containing the diagnostic, or an error message when retrieval fails.
 */
export async function requestMcpDiagnostic(
  logs: string[],
  signal?: AbortSignal,
): Promise<{ diagnostic: McpDiagnostic | null; error: string | null }> {
  if (logs.length === 0) return { diagnostic: null, error: null };

  // Prefer deterministic Studio matchers (Whisper HF task, etc.) over a vague MCP hit.
  const local = matchLocalLogDiagnostic(logs);
  if (local) return { diagnostic: local, error: null };

  try {
    const errorSnippet = logs.slice(-80).join("\n");
    const resp = await fetch("/api/mcp/tool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toolName: "troubleshoot_olive_error",
        args: { error_message: errorSnippet, domain: "auto" },
      }),
      signal,
    });
    const data: unknown = await resp.json().catch(() => null);
    if (signal?.aborted) return { diagnostic: null, error: null };

    const record = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
    // Prefer unwrapped tool payload when a legacy `{ result }` envelope is present.
    const payload =
      record && record.result && typeof record.result === "object" && !Array.isArray(record.result)
        ? (record.result as Record<string, unknown>)
        : record;

    if (!resp.ok) {
      const msg =
        (payload && typeof payload.error === "string" && payload.error) ||
        (record && typeof record.error === "string" && record.error) ||
        `Diagnosis failed (HTTP ${resp.status})`;
      return { diagnostic: null, error: msg };
    }

    if (payload && typeof payload.error === "string" && payload.error) {
      return { diagnostic: null, error: payload.error };
    }

    if (payload) {
      const diagnostic = parseMcpDiagnosticPayload(payload);
      if (diagnostic) {
        return { diagnostic, error: null };
      }
      if (typeof payload.title === "string" && payload.title) {
        return {
          diagnostic: null,
          error: "Diagnosis returned an incomplete or malformed payload.",
        };
      }
    }

    return { diagnostic: null, error: "Diagnosis returned an unexpected response." };
  } catch (err: unknown) {
    if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) {
      return { diagnostic: null, error: null };
    }
    return {
      diagnostic: null,
      error: err instanceof Error ? err.message : "Diagnosis request failed",
    };
  }
}

/**
 * Submit local aggregate troubleshoot feedback via the MCP proxy.
 * Sends only matched_entry + rating (+ optional reason_code) — never logs.
 */
export async function requestMcpTroubleshootFeedback(
  args: McpTroubleshootFeedbackArgs,
  signal?: AbortSignal,
): Promise<McpTroubleshootFeedbackResult | McpTroubleshootFeedbackError> {
  const normalized = normalizeMcpTroubleshootFeedbackArgs(args);
  if (!normalized.ok) {
    return { status: "error", error: "invalid_args", message: normalized.error };
  }

  try {
    const toolArgs: Record<string, string> = {
      matched_entry: normalized.args.matched_entry,
      rating: normalized.args.rating,
    };
    if (normalized.args.reason_code) {
      toolArgs.reason_code = normalized.args.reason_code;
    }

    const resp = await fetch("/api/mcp/tool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toolName: "record_troubleshoot_feedback",
        args: toolArgs,
      }),
      signal,
    });
    const data: unknown = await resp.json().catch(() => null);
    if (signal?.aborted) {
      return { status: "error", error: "aborted", message: "Feedback request was cancelled." };
    }
    return interpretFeedbackHttpResponse(resp, data);
  } catch (err: unknown) {
    if (signal?.aborted || (err instanceof DOMException && err.name === "AbortError")) {
      return { status: "error", error: "aborted", message: "Feedback request was cancelled." };
    }
    return {
      status: "error",
      error: "request_failed",
      message: err instanceof Error ? err.message : "Feedback request failed",
    };
  }
}

function interpretFeedbackHttpResponse(
  resp: Response,
  data: unknown,
): McpTroubleshootFeedbackResult | McpTroubleshootFeedbackError {
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const payload =
    record && record.result && typeof record.result === "object" && !Array.isArray(record.result)
      ? (record.result as Record<string, unknown>)
      : record;
  if (!resp.ok) {
    const msg =
      (payload && typeof payload.error === "string" && payload.error) ||
      (payload && typeof payload.message === "string" && payload.message) ||
      (record && typeof record.error === "string" && record.error) ||
      `Feedback failed (HTTP ${resp.status})`;
    return {
      status: "error",
      error: typeof payload?.error === "string" ? payload.error : "http_error",
      message: msg,
    };
  }
  return parseFeedbackToolPayload(payload);
}
