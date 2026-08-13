/**
 * Activity log utility functions for the Agent execution mode (Workstream 2, v0.5.0).
 *
 * Provides truncation, bounded FIFO append, and terminal entry creation
 * for the agent activity log.
 *
 * Requirements: 7.2, 7.4, 7.5, 7.6
 */

import type {
  ActivityEntryKind,
  ActivityLogEntry,
  AgentSessionState,
} from "@/lib/types/agentTypes";

// ─── Constants ──────────────────────────────────────────────────────────────────

/** Maximum number of entries retained in the activity log. */
export const MAX_LOG_ENTRIES = 2000;

/**
 * Kind-specific character truncation limits for entry text.
 *  - reasoning: 512
 *  - tool_call: 256
 *  - tool_result: 512
 *  - decision: 256
 *  - error: 512
 */
export const TRUNCATION_LIMITS: Record<ActivityEntryKind, number> = {
  reasoning: 512,
  tool_call: 256,
  tool_result: 512,
  decision: 256,
  error: 512,
};

// ─── Truncation ─────────────────────────────────────────────────────────────────

/**
 * Apply kind-specific truncation limits to an activity log entry.
 *
 * If the entry's `text` exceeds its kind's limit, the returned entry has:
 *  - `text` set to the first N characters (where N is the limit)
 *  - `expandedText` set to the original full text
 *
 * If the text is already within the limit, the entry is returned as-is
 * (no `expandedText` added).
 */
export function truncateEntry(entry: ActivityLogEntry): ActivityLogEntry {
  const limit = TRUNCATION_LIMITS[entry.kind];

  if (entry.text.length <= limit) {
    return entry;
  }

  return {
    ...entry,
    text: entry.text.slice(0, limit),
    expandedText: entry.text,
  };
}

// ─── Bounded FIFO Append ────────────────────────────────────────────────────────

/**
 * Append an entry to the activity log with FIFO eviction at MAX_LOG_ENTRIES.
 *
 * Returns a NEW array (never mutates the input). If the current entries array
 * is at or above the maximum capacity, the oldest entries (from the front) are
 * removed to make room for the new entry such that the result has at most
 * MAX_LOG_ENTRIES elements.
 */
export function appendEntry(
  entries: ActivityLogEntry[],
  entry: ActivityLogEntry,
): ActivityLogEntry[] {
  if (entries.length < MAX_LOG_ENTRIES) {
    return [...entries, entry];
  }

  // Evict oldest entries to maintain the cap.
  // When exactly at limit, drop the first entry to make room.
  const overflow = entries.length - MAX_LOG_ENTRIES + 1;
  return [...entries.slice(overflow), entry];
}

// ─── Terminal Entry Creation ────────────────────────────────────────────────────

/**
 * Format elapsed milliseconds into a human-readable duration string.
 * Examples: "1.2s", "45.0s", "2m 30s", "1h 5m 12s"
 */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);

  if (totalSeconds < 60) {
    return `${(ms / 1000).toFixed(1)}s`;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}

/**
 * Generate the HH:MM:SS timestamp string for the current time.
 */
function currentTimestamp(): string {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

/**
 * Generate a unique entry ID using a combination of timestamp and random suffix.
 */
function generateEntryId(): string {
  return `terminal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a terminal activity log entry based on the agent session outcome.
 *
 * Formats text depending on outcome status:
 *  - success: "Agent completed: {totalSteps} steps in {formatted elapsed time}"
 *  - failure: "Agent failed: {errorDescription}"
 *  - cancelled: "Agent cancelled at step {cancelledAtStep}"
 *
 * Returns an entry with kind "decision" for success/cancelled, or "error" for failure.
 */
export function createTerminalEntry(
  outcome: AgentSessionState["outcome"],
): ActivityLogEntry {
  if (!outcome) {
    return {
      id: generateEntryId(),
      kind: "error",
      timestamp: currentTimestamp(),
      text: "Agent terminated with unknown outcome",
    };
  }

  switch (outcome.status) {
    case "success":
      return {
        id: generateEntryId(),
        kind: "decision",
        timestamp: currentTimestamp(),
        text: `Agent completed: ${outcome.totalSteps} steps in ${formatElapsed(outcome.elapsedMs)}`,
      };

    case "failure":
      return {
        id: generateEntryId(),
        kind: "error",
        timestamp: currentTimestamp(),
        text: `Agent failed: ${outcome.errorDescription ?? "unknown error"}`,
      };

    case "cancelled":
      return {
        id: generateEntryId(),
        kind: "decision",
        timestamp: currentTimestamp(),
        text: `Agent cancelled at step ${outcome.cancelledAtStep ?? "unknown"}`,
      };
  }
}
