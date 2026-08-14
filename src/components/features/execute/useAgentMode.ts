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
  currentTimestamp,
  generateEntryId,
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

/** Bound cancel waits so mode-switch / stop UI cannot hang on a stalled network. */
const CANCEL_TIMEOUT_MS = 15_000;

function requestAgentCancel(jobId: string, init?: RequestInit): Promise<Response> {
  return fetch("/api/olive/agent/cancel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId }),
    ...init,
  });
}

async function requestAgentCancelWithTimeout(
  jobId: string,
  timeoutMs = CANCEL_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await requestAgentCancel(jobId, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function requestAgentCancelQuiet(jobId: string): Promise<Response | null> {
  return requestAgentCancelWithTimeout(jobId).catch(() => null);
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name?: string }).name === "AbortError"
  );
}

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
  /** Current backend job id once submit succeeds. */
  jobId: string | undefined;
  /** Start the agent loop. Clears previous session and starts 10s timeout. */
  startAgent: (opts?: { recipeJson?: string; cudaVersion?: string }) => Promise<void>;
  /** Stop the agent loop. Resolves true when the session is cancelled. */
  stopAgent: () => Promise<boolean>;
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
  const [jobId, setJobId] = useState<string | undefined>(undefined);

  // Ref to hold the start timeout so we can clear it on success or stop.
  const startTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitControllerRef = useRef<AbortController | null>(null);
  // Ref to track current step count for cancellation entries.
  const stepCountRef = useRef(0);
  // Ref for startedAt to avoid stale closure in stopAgent during React batching.
  const startedAtRef = useRef<string | undefined>(undefined);
  const jobIdRef = useRef<string | undefined>(undefined);
  /** Bumped on start/stop/timeout/complete so a late POST cannot attach. */
  const runGenerationRef = useRef(0);
  const submitInFlightRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const pendingStopWaiterRef = useRef<{
    promise: Promise<boolean>;
    resolve: (ok: boolean) => void;
  } | null>(null);

  const resolvePendingStop = useCallback((ok: boolean) => {
    const waiter = pendingStopWaiterRef.current;
    pendingStopWaiterRef.current = null;
    waiter?.resolve(ok);
  }, []);

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
      submitControllerRef.current?.abort();
    };
  }, [clearStartTimeout]);

  // ─── Public API ─────────────────────────────────────────────────────────────

  const setMode = useCallback((newMode: AgentSessionState["mode"]) => {
    setModeState(newMode);
  }, []);

  const applyCancelledOutcome = useCallback(() => {
    const cancelOutcome: AgentOutcome = {
      status: "cancelled",
      totalSteps: stepCountRef.current,
      elapsedMs: startedAtRef.current
        ? Date.now() - new Date(startedAtRef.current).getTime()
        : 0,
      cancelledAtStep: stepCountRef.current,
    };
    const terminalEntry = truncateEntry(createTerminalEntry(cancelOutcome));
    setEntries((prev) => appendEntryFIFO(prev, terminalEntry));
    setAgentRunning(false);
    setOutcome(cancelOutcome);
  }, []);

  /**
   * Start the agent loop:
   * 1. Clear previous session entries and outcome
   * 2. Set agentRunning = true, record startedAt
   * 3. Start a 10-second timeout — if not confirmed, append error and re-enable Start
   */
  const startAgent = useCallback(async (opts?: { recipeJson?: string; cudaVersion?: string }) => {
    // Clear previous session (Requirement 7.5: new session clears old entries)
    runGenerationRef.current += 1;
    const thisGen = runGenerationRef.current;
    stopRequestedRef.current = false;
    resolvePendingStop(false);
    setEntries([]);
    setOutcome(undefined);
    setJobId(undefined);
    jobIdRef.current = undefined;
    stepCountRef.current = 0;

    // Mark as running
    setAgentRunning(true);
    const nowIso = new Date().toISOString();
    setStartedAt(nowIso);
    startedAtRef.current = nowIso;

    const submitController = new AbortController();
    submitControllerRef.current = submitController;

    // Start 10-second failure timeout (Requirement 6.4)
    clearStartTimeout();
    startTimeoutRef.current = setTimeout(() => {
      if (thisGen !== runGenerationRef.current) return;
      startTimeoutRef.current = null;

      if (stopRequestedRef.current) {
        // Mode-switch/stop is waiting on submit. Do not abort or resolve success:
        // the server may already have registered the job, and we need its jobId
        // to cancel. The in-flight submit path cancels once the response arrives.
        return;
      }

      submitControllerRef.current?.abort();

      runGenerationRef.current += 1;
      const orphanId = jobIdRef.current;
      const errorEntry: ActivityLogEntry = {
        id: generateEntryId(),
        kind: "error",
        timestamp: currentTimestamp(),
        text: "Agent failed to start within 10 seconds",
      };
      setEntries((prev) => appendEntryFIFO(prev, errorEntry));
      setAgentRunning(false);
      setJobId(undefined);
      jobIdRef.current = undefined;
      setOutcome({
        status: "failure",
        totalSteps: stepCountRef.current,
        elapsedMs: startedAtRef.current
          ? Date.now() - new Date(startedAtRef.current).getTime()
          : START_TIMEOUT_MS,
        errorDescription: "Agent failed to start within 10 seconds",
      });
      if (orphanId) void requestAgentCancelQuiet(orphanId);
    }, START_TIMEOUT_MS);

    if (!opts?.recipeJson) return;

    submitInFlightRef.current = true;
    try {
      const resp = await fetch("/api/olive/jobs/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipeJson: opts.recipeJson,
          cudaVersion: opts.cudaVersion ?? "auto",
        }),
        signal: submitController.signal,
      });
      const data = (await resp.json().catch(() => ({}))) as { jobId?: string; error?: string };
      if (stopRequestedRef.current && thisGen === runGenerationRef.current) {
        if (!data.jobId) {
          stopRequestedRef.current = false;
          clearStartTimeout();
          runGenerationRef.current += 1;
          applyCancelledOutcome();
          resolvePendingStop(true);
          return;
        }
        let cancelOk = false;
        try {
          const cancelResp = await requestAgentCancelWithTimeout(data.jobId);
          cancelOk = cancelResp.ok;
        } catch {
          cancelOk = false;
        }
        if (thisGen !== runGenerationRef.current) {
          resolvePendingStop(false);
          return;
        }
        if (cancelOk) {
          // Settle before the 10s startup timer can append a second terminal entry.
          clearStartTimeout();
          runGenerationRef.current += 1;
          applyCancelledOutcome();
          resolvePendingStop(true);
          return;
        }
        // Cancel failed: keep the job attached, but drop the startup timer so it
        // cannot mark this still-running session as a start failure.
        stopRequestedRef.current = false;
        clearStartTimeout();
        setJobId(data.jobId);
        jobIdRef.current = data.jobId;
        setAgentRunning(true);
        setOutcome({
          status: "failure",
          totalSteps: stepCountRef.current,
          elapsedMs: startedAtRef.current
            ? Date.now() - new Date(startedAtRef.current).getTime()
            : 0,
          errorDescription: "Failed to cancel agent job",
        });
        resolvePendingStop(false);
        return;
      }
      if (thisGen !== runGenerationRef.current) {
        if (!data.jobId) {
          resolvePendingStop(true);
          return;
        }
        let cancelOk = false;
        try {
          cancelOk = (await requestAgentCancelWithTimeout(data.jobId)).ok;
        } catch {
          cancelOk = false;
        }
        resolvePendingStop(cancelOk);
        return;
      }
      if (!resp.ok || !data.jobId) {
        throw new Error(data.error || `HTTP ${resp.status}`);
      }
      setJobId(data.jobId);
      jobIdRef.current = data.jobId;
    } catch (err) {
      if (thisGen !== runGenerationRef.current) {
        resolvePendingStop(false);
        return;
      }
      stopRequestedRef.current = false;
      clearStartTimeout();
      const message = err instanceof Error ? err.message : "Failed to submit agent job";
      setAgentRunning(false);
      setOutcome({
        status: "failure",
        totalSteps: 0,
        elapsedMs: startedAtRef.current
          ? Date.now() - new Date(startedAtRef.current).getTime()
          : 0,
        errorDescription: message,
      });
      resolvePendingStop(true);
    } finally {
      submitInFlightRef.current = false;
      if (submitControllerRef.current === submitController) {
        submitControllerRef.current = null;
      }
    }
  }, [applyCancelledOutcome, clearStartTimeout, resolvePendingStop]);

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
  const stopAgent = useCallback(async (): Promise<boolean> => {
    const activeJobId = jobIdRef.current;
    if (!activeJobId) {
      if (submitInFlightRef.current) {
        stopRequestedRef.current = true;
        if (!pendingStopWaiterRef.current) {
          let resolve!: (ok: boolean) => void;
          const promise = new Promise<boolean>((r) => {
            resolve = r;
          });
          pendingStopWaiterRef.current = { promise, resolve };
        }
        return pendingStopWaiterRef.current.promise;
      }
      clearStartTimeout();
      if (!stopRequestedRef.current) {
        runGenerationRef.current += 1;
        stopRequestedRef.current = true;
        applyCancelledOutcome();
      }
      return true;
    }

    clearStartTimeout();

    if (stopRequestedRef.current) return false;
    runGenerationRef.current += 1;
    stopRequestedRef.current = true;
    const stopGen = runGenerationRef.current;

    try {
      const resp = await requestAgentCancelWithTimeout(activeJobId);
      const data = (await resp.json().catch(() => ({}))) as { error?: string; status?: string };
      if (runGenerationRef.current !== stopGen) return false;
      if (!resp.ok) {
        throw new Error(data.error || `HTTP ${resp.status}`);
      }
      applyCancelledOutcome();
      return true;
    } catch (err) {
      if (runGenerationRef.current !== stopGen) return false;
      stopRequestedRef.current = false;
      const message =
        isAbortError(err)
          ? "Cancel request timed out"
          : err instanceof Error
            ? err.message
            : "Failed to cancel agent job";
      setOutcome({
        status: "failure",
        totalSteps: stepCountRef.current,
        elapsedMs: startedAtRef.current
          ? Date.now() - new Date(startedAtRef.current).getTime()
          : 0,
        errorDescription: message,
      });
      return false;
    }
  }, [applyCancelledOutcome, clearStartTimeout]);

  /**
   * Complete the agent loop with a specified outcome.
   * Used for success or failure termination (not user cancellation).
   */
  const completeAgent = useCallback(
    (completionOutcome: AgentOutcome) => {
      clearStartTimeout();
      runGenerationRef.current += 1;

      const resolved: AgentOutcome = {
        ...completionOutcome,
        totalSteps: Math.max(completionOutcome.totalSteps, stepCountRef.current),
      };
      const terminalEntry = truncateEntry(createTerminalEntry(resolved));
      setEntries((prev) => appendEntryFIFO(prev, terminalEntry));
      setAgentRunning(false);
      setOutcome(resolved);
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
    if (entry.stepRef) {
      stepCountRef.current += 1;
    }
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
    jobId,
    setMode,
    startAgent,
    stopAgent,
    appendEntry,
    clearLog,
    confirmStart,
    completeAgent,
  };
}
