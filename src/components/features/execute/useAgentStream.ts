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

/** Matches the server's synthetic replay preamble when job.logsTruncated is set. */
function isTruncationNotice(text: string): boolean {
  return text.includes("Earlier log lines were trimmed");
}

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

const MAX_SEEN_KEYS = 1000;
const MAX_PREFIX_ENTRIES = 1000;

function addSeenPayloadKey(set: Set<string>, key: string) {
  set.add(key);
  if (set.size > MAX_SEEN_KEYS) {
    const first = set.values().next().value;
    if (first !== undefined) set.delete(first);
  }
}

function pushDeliveredPrefix(
  arr: { kind: ActivityEntryKind; text: string }[],
  item: { kind: ActivityEntryKind; text: string },
) {
  arr.push(item);
  if (arr.length > MAX_PREFIX_ENTRIES) {
    arr.shift();
  }
}

interface ShouldSkipReplayResult {
  skip: boolean;
  nextIndex: number;
  stillReplaying: boolean;
}

function shouldSkipReplayEntry(
  prefix: { kind: ActivityEntryKind; text: string }[],
  currentIndex: number,
  entry: ActivityLogEntry,
): ShouldSkipReplayResult {
  if (isTruncationNotice(entry.text)) {
    return { skip: false, nextIndex: currentIndex, stillReplaying: true };
  }
  let idx = currentIndex;
  let expected = prefix[idx];
  if (!expected || expected.kind !== entry.kind || expected.text !== entry.text) {
    const found = prefix.findIndex(
      (item, i) => i >= idx && item.kind === entry.kind && item.text === entry.text,
    );
    if (found === -1) {
      return { skip: false, nextIndex: idx, stillReplaying: false };
    }
    idx = found;
    expected = prefix[found];
  }
  if (expected && expected.kind === entry.kind && expected.text === entry.text) {
    const nextIndex = idx + 1;
    const stillReplaying = nextIndex < prefix.length;
    return { skip: true, nextIndex, stillReplaying };
  }
  return { skip: false, nextIndex: idx, stillReplaying: false };
}

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
const VALID_KINDS_MAP: Record<ActivityEntryKind, true> = {
  reasoning: true,
  tool_call: true,
  tool_result: true,
  decision: true,
  error: true,
};
const VALID_KINDS = Object.keys(VALID_KINDS_MAP) as ActivityEntryKind[];

function isValidAgentStreamEvent(data: unknown): data is AgentStreamEvent {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (typeof obj.kind !== "string") return false;
  if (!VALID_KINDS.includes(obj.kind as ActivityEntryKind)) return false;
  if (typeof obj.text !== "string") return false;
  if (obj.stepRef !== undefined && typeof obj.stepRef !== "string") return false;
  return true;
}

/**
 * Convert a validated stream event into an ActivityLogEntry.
 */
function parseStreamPayload(data: unknown, eventType?: string): ActivityLogEntry | null {
  if (isValidAgentStreamEvent(data)) {
    return toActivityLogEntry(data);
  }
  if (typeof data !== "object" || data === null) return null;
  const obj = data as Record<string, unknown>;

  if (eventType === "log" && typeof obj.line === "string") {
    return toActivityLogEntry({ kind: "tool_result", text: obj.line });
  }

  if (eventType === "metrics" || "util" in obj || "vramUsedMb" in obj || "gpu" in obj) {
    return toActivityLogEntry({
      kind: "tool_result",
      text: `metrics: ${JSON.stringify(obj)}`,
    });
  }

  if (typeof obj.line === "string") {
    return toActivityLogEntry({ kind: "tool_result", text: obj.line });
  }

  return null;
}

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
  const seenPayloadKeysRef = useRef(new Set<string>());
  const deliveredPrefixRef = useRef<{ kind: ActivityEntryKind; text: string }[]>([]);
  const replayIndexRef = useRef(0);
  const replayingPrefixRef = useRef(false);

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
    seenPayloadKeysRef.current = new Set();
    deliveredPrefixRef.current = [];
    replayIndexRef.current = 0;
    replayingPrefixRef.current = false;
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

      if (deliveredPrefixRef.current.length > 0) {
        replayingPrefixRef.current = true;
        replayIndexRef.current = 0;
      }

      const evtSource = new EventSource(`${AGENT_STREAM_ENDPOINT}/${encodeURIComponent(streamJobId)}`);
      eventSourceRef.current = evtSource;

      const handleEntry = (event: MessageEvent) => {
        if (!isMountedRef.current) return;

        try {
          const data: unknown = JSON.parse(String(event.data));
          const entry = parseStreamPayload(data, event.type);
          if (entry) {
            const record = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
            const eventId =
              (typeof event.lastEventId === "string" && event.lastEventId) ||
              (record && typeof record.id === "string" ? record.id : "");
            if (eventId) {
              if (seenPayloadKeysRef.current.has(eventId)) return;
              addSeenPayloadKey(seenPayloadKeysRef.current, eventId);
            } else if (replayingPrefixRef.current) {
              const res = shouldSkipReplayEntry(
                deliveredPrefixRef.current,
                replayIndexRef.current,
                entry,
              );
              replayIndexRef.current = res.nextIndex;
              replayingPrefixRef.current = res.stillReplaying;
              if (res.skip) return;
            }
            pushDeliveredPrefix(deliveredPrefixRef.current, { kind: entry.kind, text: entry.text });
            // A parsed payload means the stream is actually delivering data.
            retryCountRef.current = 0;
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

      // Do not reset retryCount on open — brief connects that immediately drop
      // would otherwise reconnect forever. Reset only after a parsed payload.

      // Handle connection errors with exponential backoff
      evtSource.onerror = () => {
        if (!isMountedRef.current) return;

        // If the stream already completed cleanly, do not reconnect
        if (completedRef.current) return;

        // Drop any timer already scheduled so it cannot fire untracked.
        if (reconnectTimeoutRef.current !== null) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }

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
