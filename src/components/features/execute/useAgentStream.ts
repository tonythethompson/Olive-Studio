/**
 * SSE hook for the Agent execution mode activity stream (Workstream 2, v0.5.0).
 *
 * Opens an EventSource connection to the agent events endpoint, parses incoming
 * events into ActivityLogEntry format, and handles auto-reconnect with
 * exponential backoff (max 3 retries).
 *
 * Requirements: 7.1
 */

import { useEffect, useRef, useCallback } from "react";
import type { ActivityLogEntry, ActivityEntryKind } from "@/lib/types/agentTypes";

// ─── Constants ──────────────────────────────────────────────────────────────────

/** Agent stream SSE endpoint path. */
const AGENT_STREAM_ENDPOINT = "/api/olive/agent/stream";

/** Maximum reconnection attempts before giving up. */
const MAX_RETRIES = 3;

/** Base delay for exponential backoff (ms). Delays: 1s, 2s, 4s. */
const BASE_BACKOFF_MS = 1000;

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface UseAgentStreamOptions {
  /** When true, the SSE connection is opened. When false, it is closed/cleaned up. */
  enabled: boolean;
  /** Job identifier used to scope the stream. */
  jobId?: string;
  /** Called for each parsed activity log entry received from the stream. */
  onEntry: (entry: ActivityLogEntry) => void;
  /** Called when the connection fails after exhausting all retry attempts. */
  onError?: (error: string) => void;
  /** Called when the server sends a "done" event signaling clean completion. */
  onComplete?: (status: "completed" | "failed" | "cancelled") => void;
}

/** Raw SSE event data shape from the agent stream. */
interface AgentStreamEvent {
  kind: ActivityEntryKind;
  text: string;
  stepRef?: string;
}

// ─── Utilities ──────────────────────────────────────────────────────────────────

/** Monotonically incrementing counter for unique entry IDs within a session. */
let entryCounter = 0;

/**
 * Generate a unique entry ID using timestamp + counter.
 */
function generateEntryId(): string {
  entryCounter += 1;
  return `agent-${Date.now()}-${entryCounter}`;
}

/**
 * Generate the current HH:MM:SS timestamp string.
 */
function currentTimestamp(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

/**
 * Validate that a parsed event has the expected shape.
 */
function isValidAgentStreamEvent(data: unknown): data is AgentStreamEvent {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (typeof obj.kind !== "string") return false;
  const validKinds: ActivityEntryKind[] = [
    "reasoning",
    "tool_call",
    "tool_result",
    "decision",
    "error",
  ];
  if (!validKinds.includes(obj.kind as ActivityEntryKind)) return false;
  if (typeof obj.text !== "string") return false;
  if (obj.stepRef !== undefined && typeof obj.stepRef !== "string") return false;
  return true;
}

/**
 * Convert a validated stream event into an ActivityLogEntry.
 */
function toActivityLogEntry(event: AgentStreamEvent): ActivityLogEntry {
  const entry: ActivityLogEntry = {
    id: generateEntryId(),
    kind: event.kind,
    timestamp: currentTimestamp(),
    text: event.text,
  };

  if (event.stepRef) {
    entry.stepRef = event.stepRef;
  }

  return entry;
}

// ─── Hook ───────────────────────────────────────────────────────────────────────

/**
 * Hook that manages an SSE connection to the agent activity stream.
 *
 * When `enabled` is true, opens an EventSource to the agent stream endpoint.
 * Parses incoming events into `ActivityLogEntry` objects and calls `onEntry`
 * for each one.
 *
 * On connection error, attempts reconnect with exponential backoff (1s, 2s, 4s).
 * After 3 failed retries, calls `onError` with a descriptive message.
 *
 * Cleans up (closes EventSource) on unmount or when `enabled` becomes false.
 */
export function useAgentStream({
  enabled,
  jobId,
  onEntry,
  onError,
  onComplete,
}: UseAgentStreamOptions): void {
  // Use refs for callbacks to avoid re-creating the effect on every render
  const onEntryRef = useRef(onEntry);
  const onErrorRef = useRef(onError);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onEntryRef.current = onEntry;
  }, [onEntry]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // Track retry state and cleanup handles
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const isMountedRef = useRef(true);
  const completedRef = useRef(false);

  // Cleanup helper
  const cleanup = useCallback(() => {
    if (reconnectTimeoutRef.current !== null) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (eventSourceRef.current !== null) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    retryCountRef.current = 0;
    completedRef.current = false;
  }, []);

  useEffect(() => {
    isMountedRef.current = true;

    if (!enabled || !jobId) {
      cleanup();
      return;
    }

    // Nested connect() does not inherit the jobId narrowing above.
    const streamJobId = jobId;

    /**
     * Create and configure the EventSource connection.
     */
    function connect() {
      if (!isMountedRef.current) return;

      // Close any existing connection before opening a new one
      if (eventSourceRef.current !== null) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      const evtSource = new EventSource(`${AGENT_STREAM_ENDPOINT}/${encodeURIComponent(streamJobId)}`);
      eventSourceRef.current = evtSource;

      const handleEntry = (event: MessageEvent) => {
        if (!isMountedRef.current) return;

        try {
          const data: unknown = JSON.parse(String(event.data));
          if (isValidAgentStreamEvent(data)) {
            const entry = toActivityLogEntry(data);
            onEntryRef.current(entry);
          }
        } catch {
          // Ignore malformed JSON payloads
        }
      };
      evtSource.addEventListener("log", handleEntry);
      evtSource.addEventListener("metrics", handleEntry);
      evtSource.onmessage = handleEntry;

      // Handle server terminal event
      evtSource.addEventListener("done", (event: MessageEvent) => {
        if (!isMountedRef.current) return;
        completedRef.current = true;
        evtSource.close();
        if (eventSourceRef.current === evtSource) {
          eventSourceRef.current = null;
        }
        let status: "completed" | "failed" | "cancelled" = "completed";
        try {
          const payload = JSON.parse(String(event.data)) as { status?: string };
          if (payload.status === "failed" || payload.status === "cancelled") status = payload.status;
        } catch { /* terminal status defaults to completed */ }
        onCompleteRef.current?.(status);
      });

      // Handle successful connection (reset retry count)
      evtSource.onopen = () => {
        if (!isMountedRef.current) return;
        retryCountRef.current = 0;
      };

      // Handle connection errors with exponential backoff
      evtSource.onerror = () => {
        if (!isMountedRef.current) return;

        // If the stream already completed cleanly, do not reconnect
        if (completedRef.current) return;

        // Close the failed connection
        evtSource.close();
        if (eventSourceRef.current === evtSource) {
          eventSourceRef.current = null;
        }

        // Grace period: if the connection was closed by the server (readyState CLOSED),
        // wait briefly to allow the "done" event to be delivered before deciding to
        // reconnect. This handles the race where onerror fires before the buffered
        // "done" named event is dispatched.
        const proceedWithReconnect = () => {
          if (!isMountedRef.current || completedRef.current) return;

          // Check if we've exhausted retries
          if (retryCountRef.current >= MAX_RETRIES) {
            const errorMessage =
              "Connection to agent stream failed after 3 retries";
            onErrorRef.current?.(errorMessage);
            return;
          }

          // Schedule reconnection with exponential backoff: 1s, 2s, 4s
          const delay = BASE_BACKOFF_MS * Math.pow(2, retryCountRef.current);
          retryCountRef.current += 1;

          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectTimeoutRef.current = null;
            if (isMountedRef.current) {
              connect();
            }
          }, delay);
        };

        // Allow 50ms for the "done" event to fire before reconnecting
        reconnectTimeoutRef.current = setTimeout(proceedWithReconnect, 50);
      };
    }

    connect();

    // Cleanup on unmount or when enabled becomes false
    return () => {
      isMountedRef.current = false;
      cleanup();
    };
  }, [enabled, jobId, cleanup]);
}
