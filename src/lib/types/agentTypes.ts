/**
 * Agent UI types for Workstream 2 (v0.5.0).
 *
 * Defines the data model for the Agent execution mode: activity log entries,
 * agent session state, batch comparison output, and scoring preferences.
 */

// ─── Activity Log ───────────────────────────────────────────────────────────────

/**
 * Discriminated kind for activity log entries.
 * Each kind has a specific truncation limit:
 *  - reasoning: 512 chars
 *  - tool_call: 256 chars
 *  - tool_result: 512 chars
 *  - decision: 256 chars
 *  - error: 512 chars
 */
export type ActivityEntryKind =
  | "reasoning"
  | "tool_call"
  | "tool_result"
  | "decision"
  | "error";

/**
 * A single entry in the agent activity log.
 * Entries are appended chronologically and subject to FIFO eviction at 2000 max.
 */
export interface ActivityLogEntry {
  /** Unique identifier within the session. */
  id: string;
  /** Entry kind determines styling and truncation limit. */
  kind: ActivityEntryKind;
  /** Display timestamp at HH:MM:SS resolution. */
  timestamp: string;
  /** Display text, truncated per kind-specific limits. */
  text: string;
  /** Full untruncated text when `text` was shortened. */
  expandedText?: string;
  /** Originating step reference for error entries. */
  stepRef?: string;
}

// ─── Agent Session ──────────────────────────────────────────────────────────────

/**
 * Outcome of a completed agent session.
 * Discriminated by `status` to determine which fields are relevant.
 */
export interface AgentOutcome {
  status: "success" | "failure" | "cancelled";
  /** Total steps executed in the agent loop. */
  totalSteps: number;
  /** Wall-clock duration in milliseconds. */
  elapsedMs: number;
  /** Error description from the failing step (present when status is "failure"). */
  errorDescription?: string;
  /** Step number at which cancellation occurred (present when status is "cancelled"). */
  cancelledAtStep?: number;
}

/**
 * Full session state for the Agent execution mode.
 * Lives in a dedicated `useAgentMode` hook (local state, not in pipelineStore).
 */
export interface AgentSessionState {
  /** Current execution mode. */
  mode: "manual" | "agent";
  /** Whether the agent loop is currently running. */
  agentRunning: boolean;
  /** Chronological activity log entries (max 2000, FIFO eviction). */
  entries: ActivityLogEntry[];
  /** ISO 8601 timestamp when the agent session started. */
  startedAt?: string;
  /** Terminal outcome when the agent loop has completed. */
  outcome?: AgentOutcome;
}

// ─── Batch Comparison ───────────────────────────────────────────────────────────

/**
 * A single job result row in the batch comparison output.
 * Nullable metrics indicate the value was unavailable for that job.
 */
export interface CompareResultEntry {
  job_id: string;
  latency_ms: number | null;
  model_size_mb: number | null;
  accuracy: number | null;
  /** Computed composite score based on the active scoring preference. */
  score: number;
}

/**
 * A job excluded from comparison with the reason for exclusion.
 */
export interface ExcludedJob {
  job_id: string;
  reason: string;
}

/**
 * Output from the MCP `compare_results` tool.
 * Input must contain 2–10 job records (validated by `validateJobCount`).
 */
export interface CompareResultsOutput {
  /** Per-job metric results with computed scores. */
  results: CompareResultEntry[];
  /** Job ID of the winner, or null when no clear winner exists. */
  winner: string | null;
  /** Human-readable reasoning for the winner selection (or lack thereof). */
  reasoning: string;
  /** Jobs excluded from the comparison with reasons. */
  excluded_jobs: ExcludedJob[];
}

/**
 * Scoring preference for batch comparison.
 * Determines how the composite score is weighted across metrics.
 *  - latency: prioritize lowest latency
 *  - size: prioritize smallest model size
 *  - accuracy: prioritize highest accuracy
 *  - balanced: equal weight across all metrics
 */
export type ScoringPreference = "latency" | "size" | "accuracy" | "balanced";
