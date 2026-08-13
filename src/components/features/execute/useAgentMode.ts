/**
 * useAgentMode — Local state hook for Agent execution mode (Workstream 2, v0.5.0).
 *
 * Manages the Agent/Manual mode toggle, agent lifecycle (start/stop),
 * real-time activity log buffer with FIFO eviction, and session outcomes.
 *
 * This state is LOCAL to the Execute panel — it does NOT live in pipelineStore.
 * Only concrete pipeline mutations flow through commitUiStateUpdate.
 *
 * Requirements: 6.1, 6.3, 6.4, 6.6, 7.5
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  appendEntry as appendEntryFIFO,
  createTerminalEntry,
  truncateEntry,
} from "@/lib/activityLog";
import type {
  ActivityLogEntry,
  AgentOutcome,
  AgentSessionState,
} from "@/lib/types/agentTypes";

// ─── Constants ──────────────────────────────────────────────────────────────────

/** Timeout (ms) after which a start attempt is considered failed. */
const START_TIMEOUT_MS = 10_000;

// ─── Hook Return Type ───────────────────────────────────────────────────────────

export interface UseAgentModeReturn {
  /** Current execution mode. */
  mode: AgentSessionState["mode"];
  /** Whether the agent loop is currently running. */
  agentRunning: boolean;
  /** Chronological activity log entries (max 2000, FIFO eviction). */
  entries: ActivityLogEntry[];
  /** Terminal outcome when the agent loop has completed. */
  outcome: AgentOutcome | undefined;
  /** ISO 8601 timestamp when the agent session started. */
  startedAt: string | undefined;

  /** Switch between manual and agent mode. */
  setMode: (mode: AgentSessionState["mode"]) => void;
  /** Start the agent loop. Clears previous session and starts 10s timeout. */
  startAgent: () => void;
  /** Stop the agent loop. Creates a terminal cancellation entry. */
  stopAgent: () => void;
  /** Append an entry to the activity log (truncated + FIFO bounded). */
  appendEntry: (entry: ActivityLogEntry) => void;
  /** Clear all activity log entries. */
  clearLog: () => void;
  /**
   * Mark the agent as successfully started (clears the start timeout).
   * Call this when the agent loop emits its first event.
   */
  confirmStart: () => void;
  /**
   * Terminate the agent loop with a specific outcome.
   * Appends a terminal entry and disables the running state.
   */
  completeAgent: (outcome: AgentOutcome) => void;
}

// ─── Hook Implementation ────────────────────────────────────────────────────────

export function useAgentMode(): UseAgentModeReturn {
  const [mode, setModeState] = useState<AgentSessionState["mode"]>("manual");
  const [agentRunning, setAgentRunning] = useState(false);
  const [entries, setEntries] = useState<ActivityLogEntry[]>([]);
  const [outcome, setOutcome] = useState<AgentOutcome | undefined>(undefined);
  const [startedAt, setStartedAt] = useState<string | undefined>(undefined);

  // Ref to hold the start timeout so we can clear it on success or stop.
  const startTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref to track current step count for cancellation entries.
  const stepCountRef = useRef(0);
  // Ref for startedAt to avoid stale closure in stopAgent during React batching.
  const startedAtRef = useRef<string | undefined>(undefined);

  // ─── Internal helpers ───────────────────────────────────────────────────────

  const clearStartTimeout = useCallback(() => {
    if (startTimeoutRef.current !== null) {
      clearTimeout(startTimeoutRef.current);
      startTimeoutRef.current = null;
    }
  }, []);

  // Clear the start timeout on unmount to prevent stale state updates
  useEffect(() => {
    return () => {
      clearStartTimeout();
    };
  }, [clearStartTimeout]);

  // ─── Public API ─────────────────────────────────────────────────────────────

  const setMode = useCallback((newMode: AgentSessionState["mode"]) => {
    setModeState(newMode);
  }, []);

  /**
   * Start the agent loop:
   * 1. Clear previous session entries and outcome
   * 2. Set agentRunning = true, record startedAt
   * 3. Start a 10-second timeout — if not confirmed, append error and re-enable Start
   */
  const startAgent = useCallback(() => {
    // Clear previous session (Requirement 7.5: new session clears old entries)
    setEntries([]);
    setOutcome(undefined);
    stepCountRef.current = 0;

    // Mark as running
    setAgentRunning(true);
    const now = new Date().toISOString();
    setStartedAt(now);
    startedAtRef.current = now;

    // Start 10-second failure timeout (Requirement 6.4)
    clearStartTimeout();
    startTimeoutRef.current = setTimeout(() => {
      const now = new Date();
      const ts = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
      const errorEntry: ActivityLogEntry = {
        id: `start-timeout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        kind: "error",
        timestamp: ts,
        text: "Agent failed to start within 10 seconds",
      };
      setEntries((prev) => appendEntryFIFO(prev, errorEntry));
      setAgentRunning(false);
      startTimeoutRef.current = null;
    }, START_TIMEOUT_MS);
  }, [clearStartTimeout]);

  /**
   * Confirm that the agent has successfully started (clears the 10s timeout).
   */
  const confirmStart = useCallback(() => {
    clearStartTimeout();
  }, [clearStartTimeout]);

  /**
   * Stop the agent loop manually (user-initiated cancellation).
   * Appends a terminal cancellation entry and disables running state.
   */
  const stopAgent = useCallback(() => {
    clearStartTimeout();

    const cancelOutcome: AgentOutcome = {
      status: "cancelled",
      totalSteps: stepCountRef.current,
      elapsedMs: startedAtRef.current
        ? Date.now() - new Date(startedAtRef.current).getTime()
        : 0,
      cancelledAtStep: stepCountRef.current,
    };

    const terminalEntry = createTerminalEntry(cancelOutcome);
    setEntries((prev) => appendEntryFIFO(prev, terminalEntry));
    setAgentRunning(false);
    setOutcome(cancelOutcome);
  }, [clearStartTimeout]);

  /**
   * Complete the agent loop with a specified outcome.
   * Used for success or failure termination (not user cancellation).
   */
  const completeAgent = useCallback(
    (completionOutcome: AgentOutcome) => {
      clearStartTimeout();

      const terminalEntry = createTerminalEntry(completionOutcome);
      setEntries((prev) => appendEntryFIFO(prev, terminalEntry));
      setAgentRunning(false);
      setOutcome(completionOutcome);
    },
    [clearStartTimeout],
  );

  /**
   * Append an entry to the activity log.
   * Applies kind-specific truncation then bounded FIFO append.
   */
  const appendEntry = useCallback((entry: ActivityLogEntry) => {
    const truncated = truncateEntry(entry);
    setEntries((prev) => appendEntryFIFO(prev, truncated));
    stepCountRef.current += 1;
  }, []);

  /**
   * Clear all activity log entries.
   */
  const clearLog = useCallback(() => {
    setEntries([]);
  }, []);

  return {
    mode,
    agentRunning,
    entries,
    outcome,
    startedAt,
    setMode,
    startAgent,
    stopAgent,
    appendEntry,
    clearLog,
    confirmStart,
    completeAgent,
  };
}
