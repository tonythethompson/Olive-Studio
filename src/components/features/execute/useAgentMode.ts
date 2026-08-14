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

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

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

/**
 * Extra wait after the start timeout while a deferred stop is waiting on submit.
 * Keeps submit alive long enough to learn a jobId and cancel, but bounds mode-switch.
 */
const STOP_SUBMIT_GRACE_MS = 30_000;

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

function generateIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface SubmitPayload {
  recipeJson: string;
  cudaVersion: string;
  idempotencyKey: string;
}

/**
 * Re-POST a submit with its original idempotencyKey to reconcile a request whose
 * response was lost to a client-side abort. The server returns the existing job
 * (reused: true) instead of spawning a duplicate — this is how an orphaned job
 * gets found so it can be cancelled, rather than left running unmanaged.
 */
async function reconcileOrphanedSubmit(payload: SubmitPayload): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CANCEL_TIMEOUT_MS);
  try {
    const resp = await fetch("/api/olive/jobs/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = (await resp.json().catch(() => ({}))) as { jobId?: string };
    return resp.ok ? data.jobId : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name?: string }).name === "AbortError"
  );
}

interface SubmitResolutionCtx {
  thisGen: number;
  resp: Response;
  data: { jobId?: string; error?: string };
  runGenerationRef: RefObject<number>;
  stopRequestedRef: RefObject<boolean>;
  jobIdRef: RefObject<string | undefined>;
  stepCountRef: RefObject<number>;
  startedAtRef: RefObject<string | undefined>;
  setJobId: (id: string | undefined) => void;
  setAgentRunning: (running: boolean) => void;
  setOutcome: (outcome: AgentOutcome) => void;
  clearStartTimeout: () => void;
  clearStopSubmitGrace: () => void;
  /** Clears the shared grace timer only if it's still owned by `generation` — a stale, superseded generation's late resolution must not cancel a newer generation's active grace timer. */
  clearStopSubmitGraceIfOwnedBy: (generation: number) => void;
  applyCancelledOutcome: () => void;
  resolvePendingStop: (ok: boolean, submitGeneration?: number) => void;
}

/** Resolve a completed /api/olive/jobs/submit response against current stop/generation state. */
async function resolveAgentSubmitResponse(ctx: SubmitResolutionCtx): Promise<void> {
  const {
    thisGen,
    resp,
    data,
    runGenerationRef,
    stopRequestedRef,
    jobIdRef,
    stepCountRef,
    startedAtRef,
    setJobId,
    setAgentRunning,
    setOutcome,
    clearStartTimeout,
    clearStopSubmitGrace,
    clearStopSubmitGraceIfOwnedBy,
    applyCancelledOutcome,
    resolvePendingStop,
  } = ctx;

  if (stopRequestedRef.current && thisGen === runGenerationRef.current) {
    if (!data.jobId) {
      stopRequestedRef.current = false;
      clearStartTimeout();
      clearStopSubmitGrace();
      runGenerationRef.current += 1;
      applyCancelledOutcome();
      resolvePendingStop(true, thisGen);
      return;
    }
    let cancelOk: boolean;
    try {
      cancelOk = (await requestAgentCancelWithTimeout(data.jobId)).ok;
    } catch {
      cancelOk = false;
    }
    if (thisGen !== runGenerationRef.current) {
      resolvePendingStop(false, thisGen);
      return;
    }
    if (cancelOk) {
      // Settle before the 10s startup timer can append a second terminal entry.
      clearStartTimeout();
      clearStopSubmitGrace();
      runGenerationRef.current += 1;
      applyCancelledOutcome();
      resolvePendingStop(true, thisGen);
      return;
    }
    // Cancel failed: keep the job attached, but drop the startup timer so it
    // cannot mark this still-running session as a start failure.
    stopRequestedRef.current = false;
    clearStartTimeout();
    clearStopSubmitGrace();
    setJobId(data.jobId);
    jobIdRef.current = data.jobId;
    setAgentRunning(true);
    setOutcome({
      status: "failure",
      totalSteps: stepCountRef.current,
      elapsedMs: startedAtRef.current ? Date.now() - new Date(startedAtRef.current).getTime() : 0,
      errorDescription: "Failed to cancel agent job",
    });
    resolvePendingStop(false, thisGen);
    return;
  }

  if (thisGen !== runGenerationRef.current) {
    if (!data.jobId) {
      resolvePendingStop(true, thisGen);
      return;
    }
    let cancelOk: boolean;
    try {
      cancelOk = (await requestAgentCancelWithTimeout(data.jobId)).ok;
    } catch {
      cancelOk = false;
    }
    // A newer generation may have armed its own grace timer since this stale
    // submit was sent — only clear the shared timer if it's still this one's.
    clearStopSubmitGraceIfOwnedBy(thisGen);
    resolvePendingStop(cancelOk, thisGen);
    return;
  }

  if (!resp.ok || !data.jobId) {
    throw new Error(data.error || `HTTP ${resp.status}`);
  }
  clearStopSubmitGrace();
  setJobId(data.jobId);
  jobIdRef.current = data.jobId;
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
  const stopSubmitGraceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Generation that owns the currently-armed grace timer, if any. */
  const stopSubmitGraceGenerationRef = useRef<number | null>(null);
  const submitControllerRef = useRef<AbortController | null>(null);
  // Ref to track current step count for cancellation entries.
  const stepCountRef = useRef(0);
  // Ref for startedAt to avoid stale closure in stopAgent during React batching.
  const startedAtRef = useRef<string | undefined>(undefined);
  const jobIdRef = useRef<string | undefined>(undefined);
  /** Bumped on start/stop/timeout/complete so a late POST cannot attach. */
  const runGenerationRef = useRef(0);
  const submitInFlightRef = useRef(false);
  /** Generation that currently owns submitInFlightRef / a deferred stop waiter. */
  const submitGenerationRef = useRef(0);
  const stopRequestedRef = useRef(false);
  /** Recipe/idempotencyKey for the in-flight submit, so a grace-timeout can reconcile it. */
  const submitPayloadRef = useRef<SubmitPayload | null>(null);
  const pendingStopWaiterRef = useRef<{
    promise: Promise<boolean>;
    resolve: (ok: boolean) => void;
    submitGeneration: number;
  } | null>(null);

  const resolvePendingStop = useCallback((ok: boolean, submitGeneration?: number) => {
    const waiter = pendingStopWaiterRef.current;
    if (!waiter) return;
    if (submitGeneration !== undefined && waiter.submitGeneration !== submitGeneration) {
      return;
    }
    pendingStopWaiterRef.current = null;
    waiter.resolve(ok);
  }, []);

  // ─── Internal helpers ───────────────────────────────────────────────────────

  const clearStartTimeout = useCallback(() => {
    if (startTimeoutRef.current !== null) {
      clearTimeout(startTimeoutRef.current);
      startTimeoutRef.current = null;
    }
  }, []);

  const clearStopSubmitGrace = useCallback(() => {
    if (stopSubmitGraceRef.current !== null) {
      clearTimeout(stopSubmitGraceRef.current);
      stopSubmitGraceRef.current = null;
    }
    stopSubmitGraceGenerationRef.current = null;
  }, []);

  /**
   * Clears the shared grace timer only if `generation` still owns it. A
   * stale, superseded generation's late-arriving submit response must not
   * cancel a newer generation's currently-armed grace timer — doing so would
   * strand that newer session's deferred stopAgent() waiter forever.
   */
  const clearStopSubmitGraceIfOwnedBy = useCallback(
    (generation: number) => {
      if (stopSubmitGraceGenerationRef.current === generation) {
        clearStopSubmitGrace();
      }
    },
    [clearStopSubmitGrace],
  );

  /** Bound a deferred stop that is waiting on a still-pending submit. */
  const armStopSubmitGrace = useCallback((generation: number) => {
    if (stopSubmitGraceRef.current !== null) return;
    stopSubmitGraceGenerationRef.current = generation;
    stopSubmitGraceRef.current = setTimeout(() => {
      if (generation !== runGenerationRef.current) return;
      if (!stopRequestedRef.current) return;
      stopSubmitGraceRef.current = null;
      stopSubmitGraceGenerationRef.current = null;
      submitControllerRef.current?.abort();
      const payload = submitPayloadRef.current;
      submitPayloadRef.current = null;
      stopRequestedRef.current = false;
      runGenerationRef.current += 1;
      setAgentRunning(false);
      setOutcome({
        status: "failure",
        totalSteps: stepCountRef.current,
        elapsedMs: startedAtRef.current
          ? Date.now() - new Date(startedAtRef.current).getTime()
          : START_TIMEOUT_MS + STOP_SUBMIT_GRACE_MS,
        errorDescription: "Timed out waiting to cancel pending agent submission",
      });
      resolvePendingStop(false);

      // Best-effort background reconciliation — does not gate or delay the
      // UI state above. Abort only cancels the client-side request; if the
      // server had already created the job before the abort landed, the
      // response is lost and the job would otherwise run unmanaged forever.
      // Re-POSTing with the same idempotencyKey returns that existing job
      // (reused: true) instead of spawning a duplicate, so it can be found
      // and cancelled.
      if (payload) {
        void (async () => {
          const orphanJobId = await reconcileOrphanedSubmit(payload);
          if (orphanJobId) {
            await requestAgentCancelQuiet(orphanJobId);
          }
        })();
      }
    }, STOP_SUBMIT_GRACE_MS);
  }, [resolvePendingStop]);

  // Clear the start timeout on unmount to prevent stale state updates
  useEffect(() => {
    return () => {
      clearStartTimeout();
      clearStopSubmitGrace();
      submitControllerRef.current?.abort();
    };
  }, [clearStartTimeout, clearStopSubmitGrace]);

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
    clearStopSubmitGrace();
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
    clearStopSubmitGrace();
    startTimeoutRef.current = setTimeout(() => {
      if (thisGen !== runGenerationRef.current) return;
      startTimeoutRef.current = null;

      if (stopRequestedRef.current) {
        // Keep submit alive so we can cancel by jobId, but bound mode-switch wait.
        clearStopSubmitGrace();
        armStopSubmitGrace(thisGen);
        return;
      }

      // Do not abort submit here: the server may already have created a job.
      // Bump generation and fail the UI; when submit returns, the stale-gen
      // path cancels that jobId instead of attaching it.
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

    const submitPayload: SubmitPayload = {
      recipeJson: opts.recipeJson,
      cudaVersion: opts.cudaVersion ?? "auto",
      idempotencyKey: generateIdempotencyKey(),
    };
    submitPayloadRef.current = submitPayload;

    submitInFlightRef.current = true;
    submitGenerationRef.current = thisGen;
    try {
      const resp = await fetch("/api/olive/jobs/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submitPayload),
        signal: submitController.signal,
      });
      const data = (await resp.json().catch(() => ({}))) as { jobId?: string; error?: string };
      await resolveAgentSubmitResponse({
        thisGen,
        resp,
        data,
        runGenerationRef,
        stopRequestedRef,
        jobIdRef,
        stepCountRef,
        startedAtRef,
        setJobId,
        setAgentRunning,
        setOutcome,
        clearStartTimeout,
        clearStopSubmitGrace,
        clearStopSubmitGraceIfOwnedBy,
        applyCancelledOutcome,
        resolvePendingStop,
      });
    } catch (err) {
      if (thisGen !== runGenerationRef.current) {
        resolvePendingStop(false, thisGen);
        return;
      }
      stopRequestedRef.current = false;
      clearStartTimeout();
      clearStopSubmitGrace();
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
      resolvePendingStop(true, thisGen);
    } finally {
      if (submitGenerationRef.current === thisGen) {
        submitInFlightRef.current = false;
        submitPayloadRef.current = null;
      }
      if (submitControllerRef.current === submitController) {
        submitControllerRef.current = null;
      }
    }
  }, [
    applyCancelledOutcome,
    armStopSubmitGrace,
    clearStartTimeout,
    clearStopSubmitGrace,
    clearStopSubmitGraceIfOwnedBy,
    resolvePendingStop,
  ]);

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
          pendingStopWaiterRef.current = {
            promise,
            resolve,
            submitGeneration: submitGenerationRef.current,
          };
        }
        // Start timeout already elapsed or was confirmed: the grace branch in
        // that timer cannot run, so bound the waiter here.
        if (startTimeoutRef.current === null) {
          armStopSubmitGrace(runGenerationRef.current);
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
  }, [applyCancelledOutcome, armStopSubmitGrace, clearStartTimeout]);

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
