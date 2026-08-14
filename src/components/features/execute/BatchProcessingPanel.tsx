import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, Button, Label, Input, Select } from "@/components/ui";
import {
  UIState,
  BatchJob,
  IHVProvider,
  ModelSource,
  type McpTroubleshootFeedbackRating,
} from "@/types";
import { usePipelineState } from "@/lib/stores/pipelineStore";
import { useAutoClearError } from "@/lib/hooks/useAutoClearError";
import { useMcpDiagnosticKeyed } from "@/lib/hooks/useMcpDiagnostic";
import { applyMcpDiagnosticToUiState, canApplyMcpDiagnostic } from "@/lib/mcpConfigMapping";
import { buildRecipeJsonFromState, buildOliveRecipeFromBatchJob } from "@/lib/recipePipeline";
import { parseOliveMetricsFromLogs } from "@/lib/oliveLogMetrics";
import { commitUiStateUpdate, getPipelineValidation } from "@/lib/pipelineValidation";
import { DEFAULT_PASSES } from "@/lib/defaultPasses";
import { getSelectableProviders, type HardwareProbeResult } from "@/lib/hardwareProbe";
import { useHardwareProbe } from "@/lib/hooks/useHardwareProbe";
import { PROVIDER_CATALOG } from "@/lib/providerCatalog";
import { LazyMCPDiagnosticCard } from "./LazyMCPDiagnosticCard";
import { BatchComparisonView } from "./BatchComparisonView";
import type { JobHistoryRecord } from "@/lib/jobHistoryStore";
import { parseMcpCompareOutput } from "@/lib/batchComparison";
import type { CompareResultsOutput, ScoringPreference } from "@/lib/types/agentTypes";
import {
  Play,
  Pause,
  RotateCcw,
  Plus,
  Trash2,
  CheckCircle2,
  Clock,
  PlayCircle,
  XCircle,
  ChevronRight,
  Database,
  Cpu,
  Layers,
  FolderPlus,
  Sparkles,
  AlertCircle,
} from "lucide-react";

type TerminalBatchStatus = "cancelled" | "completed" | "failed";

function isTerminalBatchStatus(status: string | undefined): status is TerminalBatchStatus {
  return status === "cancelled" || status === "completed" || status === "failed";
}

/** Extract an explicit 0–100 progress percentage from a log line, else -1. */
function parseBatchProgress(line: string): number {
  const lower = line.toLowerCase();
  if (!(lower.includes("pass") || lower.includes("step") || lower.includes("%"))) {
    return -1;
  }
  const match = line.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!match) return -1;
  const pct = parseFloat(match[1]);
  if (Number.isNaN(pct)) return -1;
  return Math.min(Math.max(Math.round(pct), 0), 100);
}

function appendBatchJobLog(
  jobs: BatchJob[],
  jobId: string,
  line: string,
  progress?: number,
): BatchJob[] {
  return jobs.map((j) => {
    if (j.id !== jobId) return j;
    const nextProgress =
      progress !== undefined && progress >= 0
        ? progress
        : j.progress >= 0
          ? j.progress
          : -1;
    return { ...j, logs: [...j.logs, line], progress: nextProgress };
  });
}

/** Fetch + parse a compare_results MCP call; keeps handleCompare's own branching minimal. */
async function fetchCompareResults(
  jobIds: string[],
  preference: ScoringPreference,
  signal: AbortSignal,
): Promise<{ ok: true; result: CompareResultsOutput } | { ok: false; error: string }> {
  const resp = await fetch("/api/mcp/tool", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ toolName: "compare_results", args: { job_ids: jobIds, preference } }),
    signal,
  });
  if (!resp.ok) {
    return { ok: false, error: `Comparison request failed (HTTP ${resp.status})` };
  }
  const data: unknown = await resp.json().catch(() => null);
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const payload =
    record && record.result && typeof record.result === "object" && !Array.isArray(record.result)
      ? (record.result as Record<string, unknown>)
      : record;
  const parsed = payload ? parseMcpCompareOutput(payload) : null;
  if (!parsed) {
    return { ok: false, error: "Failed to parse comparison response" };
  }
  return { ok: true, result: parsed };
}

async function postBatchOliveRun(
  recipe: unknown,
): Promise<{ ok: true; jobId: string } | { ok: false; error: string }> {
  try {
    const resp = await fetch("/api/olive/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipeJson: JSON.stringify(recipe, null, 2) }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
      return { ok: false, error: String(err.error ?? `HTTP ${resp.status}`) };
    }
    const data = (await resp.json()) as { jobId?: string };
    if (typeof data.jobId !== "string" || !data.jobId) {
      return { ok: false, error: "Olive run response missing jobId" };
    }
    return { ok: true, jobId: data.jobId };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function resolveHaltBeforeStream(jobId: string): Promise<{
  terminalStatus: TerminalBatchStatus;
  haltLog: string;
}> {
  let terminalStatus: TerminalBatchStatus = "cancelled";
  let haltLog = "[INFO] Halted before stream started.";
  try {
    const cancelResp = await fetch("/api/olive/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    });
    const cancelData = (await cancelResp.json().catch(() => ({}))) as { status?: string };
    if (cancelResp.ok && isTerminalBatchStatus(cancelData.status)) {
      terminalStatus = cancelData.status;
      if (terminalStatus === "completed") {
        haltLog = "[INFO] Halt requested after job already completed.";
      } else if (terminalStatus === "failed") {
        haltLog = "[INFO] Halt requested after job already failed.";
      }
    }
  } catch {
    /* keep cancelled + default log */
  }
  return { terminalStatus, haltLog };
}

type BatchStreamHandlers = {
  jobId: string;
  batchJobId: string;
  jobsRef: { current: BatchJob[] | undefined };
  haltRequestedRef: { current: boolean };
  activeSourcesRef: { current: EventSource[] };
  currentStreamResolveRef: { current: (() => void) | null };
  setState: (s: Partial<UIState>) => void;
  fetchKeyedDiagnostic: (key: string, logs: string[]) => void;
};

function applyBatchStreamDone(
  handlers: BatchStreamHandlers,
  evtSource: EventSource,
  finish: () => void,
  e: MessageEvent,
): void {
  const { batchJobId, jobsRef, haltRequestedRef, activeSourcesRef, setState, fetchKeyedDiagnostic } =
    handlers;
  let exitCode = 1;
  let serverStatus: string | undefined;
  try {
    const payload = JSON.parse(e.data) as { exitCode?: number; status?: string };
    exitCode = typeof payload.exitCode === "number" ? payload.exitCode : 1;
    serverStatus = payload.status;
  } catch {
    exitCode = 1;
  }
  const finalStatus: TerminalBatchStatus =
    serverStatus === "cancelled" || haltRequestedRef.current
      ? "cancelled"
      : exitCode === 0
        ? "completed"
        : "failed";
  const currentJobs = jobsRef.current ?? [];
  const completedJob = currentJobs.find((j) => j.id === batchJobId);
  const metrics =
    finalStatus === "completed" && completedJob
      ? parseOliveMetricsFromLogs(completedJob.logs)
      : undefined;
  setState({
    batchJobs: currentJobs.map((j) =>
      j.id === batchJobId
        ? {
          ...j,
          status: finalStatus,
          progress: finalStatus === "completed" ? 100 : j.progress,
          metrics: metrics ?? j.metrics,
          finishedAtMs: Date.now(),
        }
        : j,
    ),
  });
  if (finalStatus === "failed" && completedJob) {
    fetchKeyedDiagnostic(batchJobId, completedJob.logs);
  }
  evtSource.close();
  const idx = activeSourcesRef.current.indexOf(evtSource);
  if (idx !== -1) activeSourcesRef.current.splice(idx, 1);
  finish();
}

function applyBatchStreamError(
  handlers: BatchStreamHandlers,
  evtSource: EventSource,
  finish: () => void,
): void {
  const { batchJobId, jobsRef, haltRequestedRef, setState, fetchKeyedDiagnostic } = handlers;
  const currentJobs = jobsRef.current ?? [];
  if (haltRequestedRef.current) {
    setState({
      batchJobs: currentJobs.map((j) =>
        j.id === batchJobId
          ? {
            ...j,
            status: "cancelled",
            logs: [...(j.logs || []), "[INFO] Halted by user."],
            finishedAtMs: Date.now(),
          }
          : j,
      ),
    });
    evtSource.close();
    finish();
    return;
  }
  const failedJob = currentJobs.find((j) => j.id === batchJobId);
  const errorLogs = [...(failedJob?.logs || []), "[ERROR] SSE connection lost."];
  setState({
    batchJobs: currentJobs.map((j) =>
      j.id === batchJobId ? { ...j, status: "failed", logs: errorLogs, finishedAtMs: Date.now() } : j,
    ),
  });
  fetchKeyedDiagnostic(batchJobId, errorLogs);
  evtSource.close();
  finish();
}

function waitForBatchOliveStream(handlers: BatchStreamHandlers): Promise<void> {
  const { jobId, jobsRef, activeSourcesRef, currentStreamResolveRef, setState } = handlers;

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (currentStreamResolveRef.current === finish) {
        currentStreamResolveRef.current = null;
      }
      resolve();
    };
    currentStreamResolveRef.current = finish;
    const evtSource = new EventSource(`/api/olive/stream/${jobId}`);
    activeSourcesRef.current.push(evtSource);

    evtSource.addEventListener("log", (e: MessageEvent) => {
      let line = String(e.data ?? "");
      try {
        const payload = JSON.parse(line) as { line?: string };
        if (typeof payload.line === "string") line = payload.line;
      } catch {
        /* raw line fallback */
      }
      setState({
        batchJobs: appendBatchJobLog(
          jobsRef.current ?? [],
          handlers.batchJobId,
          line,
          parseBatchProgress(line),
        ),
      });
    });

    evtSource.addEventListener("done", (e: MessageEvent) => {
      applyBatchStreamDone(handlers, evtSource, finish, e);
    });

    evtSource.onerror = () => {
      applyBatchStreamError(handlers, evtSource, finish);
    };
  });
}

type QueueJobContext = {
  state: UIState;
  hardwareProbe: HardwareProbeResult | null;
  jobsRef: { current: BatchJob[] | undefined };
  haltRequestedRef: { current: boolean };
  activeSourcesRef: { current: EventSource[] };
  currentStreamResolveRef: { current: (() => void) | null };
  currentOliveJobIdRef: { current: string | null };
  setState: (s: Partial<UIState>) => void;
  fetchKeyedDiagnostic: (key: string, logs: string[]) => void;
};

type QueueJobStep = "continue" | "break";

function failQueuedBatchJob(
  ctx: Pick<QueueJobContext, "jobsRef" | "setState" | "fetchKeyedDiagnostic">,
  jobId: string,
  errorLogs: string[],
): void {
  ctx.setState({
    batchJobs: (ctx.jobsRef.current ?? []).map((j) =>
      j.id === jobId ? { ...j, status: "failed", logs: errorLogs, finishedAtMs: Date.now() } : j,
    ),
  });
  ctx.fetchKeyedDiagnostic(jobId, errorLogs);
}

function uiStateForBatchJob(job: BatchJob, state: UIState): UIState {
  return {
    ...state,
    modelSource: job.modelSource,
    localFiles: state.localFiles,
    hfModelId: job.modelSource === "huggingface" ? job.modelIdentifier : state.hfModelId,
    azureModelPath: job.modelSource === "azure" ? job.modelIdentifier : state.azureModelPath,
    ihvProvider: job.provider,
  };
}

function validationFailureLogs(
  job: BatchJob,
  jobs: BatchJob[],
  statusLabel: string,
  criticalTitles: string[],
): string[] {
  return [
    ...(jobs.find((j) => j.id === job.id)?.logs || []),
    `[ERROR] Job validation failed: ${statusLabel}`,
    ...criticalTitles.map((title) => `[ERROR] ${title}`),
  ];
}

function markBatchJobRunning(
  ctx: Pick<QueueJobContext, "jobsRef" | "setState">,
  jobId: string,
): void {
  ctx.setState({
    batchJobs: (ctx.jobsRef.current ?? []).map((j) =>
      j.id === jobId
        ? { ...j, status: "running", progress: -1, logs: ["[INFO] Starting Olive run..."], startedAtMs: Date.now() }
        : j,
    ),
  });
}

async function applyHaltBeforeStream(
  ctx: Pick<QueueJobContext, "jobsRef" | "setState">,
  job: BatchJob,
  oliveJobId: string,
): Promise<void> {
  const { terminalStatus, haltLog } = await resolveHaltBeforeStream(oliveJobId);
  ctx.setState({
    batchJobs: (ctx.jobsRef.current ?? []).map((j) =>
      j.id === job.id
        ? {
          ...j,
          oliveJobId,
          status: terminalStatus,
          logs: [...(j.logs || []), haltLog],
          finishedAtMs: Date.now(),
        }
        : j,
    ),
  });
}

/**
 * Run one queued batch job through validate → start → stream.
 * Returns `break` when the queue should stop after this step.
 */
async function processQueuedBatchJob(job: BatchJob, ctx: QueueJobContext): Promise<QueueJobStep> {
  if (ctx.haltRequestedRef.current) return "break";

  const jobValidation = getPipelineValidation(uiStateForBatchJob(job, ctx.state), {
    forLocalExecution: true,
    hardwareProbe: ctx.hardwareProbe,
  });
  if (jobValidation.isBlocked) {
    failQueuedBatchJob(
      ctx,
      job.id,
      validationFailureLogs(
        job,
        ctx.jobsRef.current ?? [],
        jobValidation.statusLabel,
        jobValidation.issues.filter((i) => i.severity === "critical").map((i) => i.title),
      ),
    );
    return "continue";
  }

  markBatchJobRunning(ctx, job.id);
  const startResult = await postBatchOliveRun(buildOliveRecipeFromBatchJob(job, ctx.state));
  if (!startResult.ok) {
    failQueuedBatchJob(ctx, job.id, [
      ...((ctx.jobsRef.current ?? []).find((j) => j.id === job.id)?.logs || []),
      `[ERROR] ${startResult.error}`,
    ]);
    return "continue";
  }

  const { jobId } = startResult;
  if (ctx.haltRequestedRef.current) {
    await applyHaltBeforeStream(ctx, job, jobId);
    return "break";
  }

  ctx.currentOliveJobIdRef.current = jobId;
  ctx.setState({
    batchJobs: (ctx.jobsRef.current ?? []).map((j) =>
      j.id === job.id ? { ...j, oliveJobId: jobId } : j,
    ),
  });

  await waitForBatchOliveStream({
    jobId,
    batchJobId: job.id,
    jobsRef: ctx.jobsRef,
    haltRequestedRef: ctx.haltRequestedRef,
    activeSourcesRef: ctx.activeSourcesRef,
    currentStreamResolveRef: ctx.currentStreamResolveRef,
    setState: ctx.setState,
    fetchKeyedDiagnostic: ctx.fetchKeyedDiagnostic,
  });

  ctx.currentOliveJobIdRef.current = null;
  return ctx.haltRequestedRef.current ? "break" : "continue";
}

async function runQueuedBatchJobs(queuedJobs: BatchJob[], ctx: QueueJobContext): Promise<void> {
  for (const job of queuedJobs) {
    const step = await processQueuedBatchJob(job, ctx);
    if (step === "break") break;
  }
}

/**
 * Renders the batch-job queue or an empty-queue message.
 *
 * @param jobs - The jobs to display.
 * @param selectedJobId - The identifier of the selected job, if any.
 * @param onSelectJob - Handles selection of a job.
 * @param onDeleteJob - Handles deletion of a job.
 */
function BatchJobList({
  jobs,
  selectedJobId,
  onSelectJob,
  onDeleteJob,
}: {
  jobs: BatchJob[];
  selectedJobId: string | null;
  onSelectJob: (id: string) => void;
  onDeleteJob: (id: string) => void;
}) {
  if (jobs.length === 0) {
    return (
      <div className="text-center py-12 border border-dashed border-slate-800 rounded-xl bg-slate-950/20 text-slate-500">
        <Layers className="h-10 w-10 mx-auto mb-3 opacity-30 text-slate-400" />
        <h5 className="font-semibold text-slate-400 mb-1">Queue Empty</h5>
        <p className="text-sm text-slate-500 max-w-sm mx-auto">
          Configure your source models and trigger passes to queue jobs or add a custom sequence
          manually.
        </p>
      </div>
    );
  }

  return (
    <>
      {jobs.map((job) => (
        <BatchJobCard
          key={job.id}
          job={job}
          isSelected={selectedJobId === job.id}
          onSelect={() => onSelectJob(job.id)}
          onDelete={() => onDeleteJob(job.id)}
        />
      ))}
    </>
  );
}

/**
 * Renders a selectable batch job card with status, execution details, progress, metrics, and deletion controls.
 *
 * @param job - The batch job represented by the card
 * @param isSelected - Whether the card is currently selected
 * @param onSelect - Called when the card is selected
 * @param onDelete - Called when the job is deleted
 */
function BatchJobCard({
  job,
  isSelected,
  onSelect,
  onDelete,
}: {
  job: BatchJob;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border transition-all ${isSelected
          ? "border-electric-blue bg-electric-blue/5"
          : "border-slate-800/80 bg-slate-900/30 hover:border-slate-700 hover:bg-slate-900/50"
        }`}
    >
      <button
        type="button"
        aria-label={`Select batch job ${job.name}`}
        aria-pressed={isSelected}
        onClick={onSelect}
        className="flex items-start gap-3.5 min-w-0 flex-1 text-left cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue/60"
      >
        {/* Status Icon */}
        <div className="mt-0.5 shrink-0">
          {job.status === "completed" && (
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          )}
          {job.status === "running" && <PlayCircle className="h-5 w-5 text-electric-blue" />}
          {job.status === "queued" && <Clock className="h-5 w-5 text-slate-500" />}
          {job.status === "failed" && <XCircle className="h-5 w-5 text-red-500" />}
          {job.status === "cancelled" && <Pause className="h-5 w-5 text-amber-400" />}
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <h4
              className={`text-sm font-semibold truncate ${isSelected ? "text-slate-100" : "text-slate-300"}`}
            >
              {job.name}
            </h4>
            <span
              className={`text-[11px] uppercase tracking-wider px-1.5 py-0.5 rounded-full font-bold ${job.status === "completed"
                  ? "bg-emerald-500/10 text-emerald-400"
                  : job.status === "running"
                    ? "bg-electric-blue/10 text-electric-blue"
                    : "bg-slate-800 text-slate-400"
                }`}
            >
              {job.status}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500 mt-1">
            <span className="flex items-center gap-1 font-mono text-slate-450">
              <Database className="h-3 w-3" /> {job.modelIdentifier.split("/").pop()}
            </span>
            <span className="flex items-center gap-1">
              <Cpu className="h-3 w-3" /> {job.provider.replace("ExecutionProvider", "")}
            </span>
          </div>

          {/* Passes tag pill representation */}
          <div className="flex flex-wrap gap-1 mt-2.5">
            {job.passes.map((p, idx) => (
              <span
                key={idx}
                className="text-[11px] font-mono bg-slate-950 px-1.5 py-0.5 rounded border border-slate-850 text-slate-400"
              >
                {p}
              </span>
            ))}
          </div>
        </div>
      </button>

      <div className="flex items-center justify-between sm:justify-end gap-4 mt-4 sm:mt-0 pt-3 sm:pt-0 border-t sm:border-0 border-slate-900 shrink-0">
        {job.status === "running" && (
          <div className="flex flex-col items-end gap-1.5 w-24">
            {job.progress >= 0 ? (
              <>
                <span className="text-[11px] font-mono text-electric-blue">
                  {job.progress}%
                </span>
                <div className="h-1 w-full bg-slate-950 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-electric-blue transition-all duration-300"
                    style={{ width: `${job.progress}%` }}
                  />
                </div>
              </>
            ) : (
              <>
                <span className="text-[11px] font-mono text-electric-blue">running…</span>
                <div className="h-1 w-full bg-slate-950 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-electric-blue animate-pulse"
                    style={{ width: "40%" }}
                  />
                </div>
              </>
            )}
          </div>
        )}

        {job.status === "completed" && job.metrics && (
          <div className="text-right text-sm bg-emerald-500/5 px-2.5 py-1.5 rounded-md border border-emerald-500/10">
            <span className="text-slate-500 block text-[11px] uppercase font-bold tracking-wider font-mono">
              LATENCY
            </span>
            <span className="font-semibold text-emerald-400 font-mono">
              {job.metrics.latency}
            </span>
          </div>
        )}

        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={`Delete batch job ${job.name}`}
            onClick={onDelete}
            className="text-slate-600 hover:text-red-400 p-1 rounded hover:bg-slate-900 transition-colors shrink-0 cursor-pointer"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <ChevronRight
            className={`h-4 w-4 text-slate-600 ${isSelected ? "text-slate-350" : ""}`}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Renders the batch-processing workspace for configuring, monitoring, and managing sequential Olive jobs.
 *
 * @param state - Optional pipeline state override.
 * @param setState - Optional state updater override.
 */
export function BatchProcessingPanel({
  state: propState,
  setState: propSetState,
}: {
  state?: UIState;
  setState?: (s: Partial<UIState>) => void;
} = {}) {
  const storeState = usePipelineState();
  const state = propState ?? storeState.state;
  const setState = propSetState ?? storeState.setState;
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const activeSourcesRef = useRef<EventSource[]>([]);
  /** When true, stop starting further jobs and treat current job as halted. */
  const haltRequestedRef = useRef(false);
  /** Server Olive job id for the batch item currently running (for cancel). */
  const currentOliveJobIdRef = useRef<string | null>(null);
  /** Resolver for the active SSE wait (fallback if cancel cannot deliver `done`). */
  const currentStreamResolveRef = useRef<(() => void) | null>(null);
  // Always keep a ref to the latest jobs array so SSE callbacks can read current state
  const jobsRef = useRef<typeof state.batchJobs>(state.batchJobs || []);
  const [showAddForm, setShowAddForm] = useState(false);
  const handleToggleAddForm = useCallback(() => setShowAddForm((v) => !v), []);

  // MCP Diagnostic State — keyed by job ID
  const {
    fetchKeyedDiagnostic,
    diagnostics: batchDiagnostics,
    diagnosingKeys: diagnosingJobs,
    errors: batchDiagnoseErrors,
  } = useMcpDiagnosticKeyed();
  const [appliedFixJobId, setAppliedFixJobId] = useAutoClearError(3000);
  const [compareResults, setCompareResults] = useState<CompareResultsOutput | null>(null);
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const compareInFlightRef = useRef(false);
  const compareSeqRef = useRef(0);

  const handleCompare = useCallback(async (preference: ScoringPreference) => {
    if (compareInFlightRef.current) return;
    compareInFlightRef.current = true;
    compareSeqRef.current += 1;
    const seq = compareSeqRef.current;
    setComparing(true);
    setCompareError(null);

    const completed = (jobsRef.current ?? []).filter((j) => j.status === "completed");
    const jobIds = completed.map((j) => j.oliveJobId ?? j.id).slice(0, 10);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const outcome = await fetchCompareResults(jobIds, preference, controller.signal);
      if (seq !== compareSeqRef.current) return;
      if (outcome.ok) {
        setCompareResults(outcome.result);
      } else {
        setCompareError(outcome.error);
      }
    } catch (err: unknown) {
      if (seq !== compareSeqRef.current) return;
      setCompareError(
        err instanceof Error && err.name === "AbortError"
          ? "Comparison request timed out"
          : "Comparison request failed",
      );
    } finally {
      clearTimeout(timeoutId);
      if (seq === compareSeqRef.current) {
        setComparing(false);
        compareInFlightRef.current = false;
      }
    }
  }, []);

  /** Card self-submits feedback; parent hook is optional analytics — keep diagnosis UI unchanged. */
  const handleFeedbackSubmitted = useCallback(
    (payload: { matched_entry: string; rating: McpTroubleshootFeedbackRating }) => {
      // No UI mutation after thumbs (batch diagnostics stay keyed by job id).
      void payload.matched_entry;
    },
    [],
  );

  // Custom job creation states
  const [newModelName, setNewModelName] = useState("");
  const [newModelId, setNewModelId] = useState("meta-llama/Llama-3-8B");
  const [newSource, setNewSource] = useState<ModelSource>("huggingface");
  const [newProvider, setNewProvider] = useState<IHVProvider>("CUDAExecutionProvider");
  const { data: hardwareProbe = null } = useHardwareProbe();

  // Enabled passes for custom job
  const [passConv, setPassConv] = useState(true);
  const [passQuant, setPassQuant] = useState(true);
  const [passPruning, setPassPruning] = useState(false);
  const [passTransformer, setPassTransformer] = useState(false);

  // Keep jobsRef in sync with the latest batchJobs so SSE async callbacks can read current state
  useEffect(() => {
    jobsRef.current = state.batchJobs || [];
  }, [state.batchJobs]);

  const defaultProviderAppliedRef = useRef(false);
  useEffect(() => {
    if (defaultProviderAppliedRef.current || !hardwareProbe) return;
    defaultProviderAppliedRef.current = true;
    if (!getSelectableProviders(hardwareProbe).includes(newProvider)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time default seeded from the mount-time probe
      setNewProvider(hardwareProbe.recommendedProvider);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hardwareProbe]);

  const selectableBatchProviders = useMemo(
    () => PROVIDER_CATALOG.filter((p) => getSelectableProviders(hardwareProbe).includes(p.id)),
    [hardwareProbe],
  );

  const jobs = useMemo(() => state.batchJobs || [], [state.batchJobs]);
  const comparisonRecords = useMemo(
    () => jobs.filter(isTerminalBatchStatusJob).map(batchJobToHistoryRecord),
    [jobs],
  );

  const forceSettleHaltedJob = (oliveJobId: string) => {
    activeSourcesRef.current.forEach((s) => s.close());
    activeSourcesRef.current = [];
    const resolveStream = currentStreamResolveRef.current;
    currentStreamResolveRef.current = null;
    resolveStream?.();
    setState({
      batchJobs: (jobsRef.current ?? []).map((j) =>
        j.status === "running" || j.oliveJobId === oliveJobId
          ? {
            ...j,
            status: "cancelled",
            logs: [...(j.logs || []), "[INFO] Halted by user."],
            finishedAtMs: Date.now(),
          }
          : j,
      ),
    });
  };

  const requestHaltRunningQueue = async () => {
    // Halt: request cancel and keep the open SSE so the server `done` event
    // settles the queue waiter. Do not clear isProcessing here — the running
    // start loop exits after the stream completes.
    haltRequestedRef.current = true;
    const oliveJobId = currentOliveJobIdRef.current;
    if (!oliveJobId) {
      // No live job id yet (POST still in flight): the start loop cancels after jobId.
      return;
    }
    try {
      const resp = await fetch("/api/olive/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: oliveJobId }),
      });
      const data = (await resp.json().catch(() => ({}))) as { status?: string };
      if (resp.ok && data.status === "cancelled") {
        // `finalizeJob` emits `done`; leave EventSource open for that path.
        return;
      }
      // Already terminal with another status — leave the stream to report it.
      if (resp.ok) return;
    } catch {
      /* fall through to force-settle */
    }
    // Cancel failed: close SSE and release the waiter so the queue cannot hang.
    forceSettleHaltedJob(oliveJobId);
  };

  const handleStartQueue = async () => {
    if (isProcessing) {
      await requestHaltRunningQueue();
      return;
    }

    const queuedJobs = (state.batchJobs || []).filter((j) => j.status === "queued");
    if (queuedJobs.length === 0) return;

    haltRequestedRef.current = false;
    setIsProcessing(true);

    await runQueuedBatchJobs(queuedJobs, {
      state,
      hardwareProbe,
      jobsRef,
      haltRequestedRef,
      activeSourcesRef,
      currentStreamResolveRef,
      currentOliveJobIdRef,
      setState,
      fetchKeyedDiagnostic,
    });

    currentOliveJobIdRef.current = null;
    setIsProcessing(false);
  };

  const handleAddCustom = () => {
    if (!newModelName.trim()) return;

    const chosenPasses: string[] = [];
    if (passConv) chosenPasses.push("Model Conversion (ONNX)");
    if (passQuant) chosenPasses.push("Quantization (INT8 PTQ)");
    if (passPruning) chosenPasses.push("Sparsity Pruning");
    if (passTransformer) chosenPasses.push("Graph Transformers Fusions");
    if (chosenPasses.length === 0) chosenPasses.push("Model Assembly Standard Pass");

    const draftState = commitUiStateUpdate(state, {
      modelSource: newSource,
      hfModelId: newSource === "huggingface" ? newModelId : state.hfModelId,
      azureModelPath: newSource === "azure" ? newModelId : state.azureModelPath,
      ihvProvider: newProvider,
      passes: {
        ...DEFAULT_PASSES,
        conversion: passConv,
        quantization: passQuant,
        pruning: passPruning,
        onnxTransforms: passTransformer,
        quantMethod: "ptq",
        quantPrecision: "int8",
      },
    });

    const newJob: BatchJob = {
      id: "job-" + Date.now(),
      name: newModelName,
      modelSource: newSource,
      modelIdentifier: newModelId || "source_weights",
      provider: draftState.ihvProvider,
      passes: chosenPasses,
      recipeJson: buildRecipeJsonFromState(draftState),
      status: "queued",
      progress: 0,
      progressKnown: true,
      logs: ["Custom pipeline queued manually via workspace controller."],
    };

    setState({ batchJobs: [...jobs, newJob] });
    setSelectedJobId(newJob.id);

    // Reset inputs
    setNewModelName("");
    setNewModelId("");
    setShowAddForm(false);
  };

  const handleCancelAddJob = useCallback(() => setShowAddForm(false), []);

  const handleDeleteJob = (id: string) => {
    const filtered = jobs.filter((j) => j.id !== id);
    setState({ batchJobs: filtered });
    if (selectedJobId === id) {
      setSelectedJobId(filtered.length > 0 ? filtered[0].id : null);
    }
  };

  const handleResetQueue = () => {
    const resetJobs = jobs.map((j) => ({
      ...j,
      status: "queued" as const,
      progress: 0,
      logs: ["Pipeline reset to initial queued state by analyst."],
      metrics: undefined,
      startedAtMs: undefined,
      finishedAtMs: undefined,
    }));
    setState({ batchJobs: resetJobs });
  };

  const counts = {
    queued: jobs.filter((j) => j.status === "queued").length,
    running: jobs.filter((j) => j.status === "running").length,
    completed: jobs.filter((j) => j.status === "completed").length,
    total: jobs.length,
  };

  const selectedJob = jobs.find((j) => j.id === selectedJobId);

  return (
    <div
      data-testid="batch-processing-panel"
      className="grid grid-cols-1 xl:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-2 duration-300"
    >
      {/* Sidebar Queue List */}
      <div className="xl:col-span-2 space-y-6">
        <Card>
          <CardHeader
            title="Olive Batch Serialization Queue"
            description="Manage sequential optimization jobs to execute parallel permutations or benchmark suites."
            badge={
              <Button
                variant="default"
                className="h-8 text-sm bg-electric-blue text-white shrink-0"
                onClick={handleToggleAddForm}
              >
                <Plus className="h-4 w-4 mr-1" /> Custom Job
              </Button>
            }
          />

          <CardContent className="space-y-4">
            {/* Info Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border border-slate-800 bg-slate-900/40 text-sm font-mono">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-slate-500" /> {counts.queued} Queued
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-electric-blue" /> {counts.running} Processing
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> {counts.completed} Completed
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant={isProcessing ? "outline" : "default"}
                  className="h-8 text-sm font-semibold px-4"
                  onClick={handleStartQueue}
                  disabled={counts.queued === 0 && counts.running === 0 && !isProcessing}
                >
                  {isProcessing ? (
                    <>
                      <Pause className="h-3.5 w-3.5 mr-1" /> Halt Serial Engine
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5 mr-1 text-emerald-400 fill-emerald-400" /> Start Queue
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  className="h-8 p-2"
                  title="Reset all statuses to Queued"
                  onClick={handleResetQueue}
                >
                  <RotateCcw className="h-3.5 w-3.5 text-slate-400" />
                </Button>
              </div>
            </div>

            {/* Slide down Custom form */}
            {showAddForm && (
              <div className="p-5 border border-slate-750 bg-slate-950 rounded-xl space-y-4 animate-in slide-in-from-top-4 duration-200">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                    <FolderPlus className="h-4.5 w-4.5 text-electric-blue" />
                    Configure New Batch Job Entry
                  </h4>
                  <button
                    type="button"
                    className="text-slate-500 hover:text-slate-300 text-sm cursor-pointer"
                    onClick={handleCancelAddJob}
                  >
                    Cancel
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Job Name</Label>
                    <Input
                      placeholder="e.g. Phi-3 mini-4k Int4 CUDA"
                      value={newModelName}
                      onChange={(e) => setNewModelName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Model Identifier</Label>
                    <Input
                      placeholder="e.g. microsoft/Phi-3-mini-4k-instruct"
                      value={newModelId}
                      onChange={(e) => setNewModelId(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="batch-source-provider">Source Provider</Label>
                    <Select
                      id="batch-source-provider"
                      value={newSource}
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      onChange={(e) => setNewSource(e.target.value as any)}
                    >
                      <option value="huggingface">Hugging Face Hub</option>
                      <option value="local">Local Files Chunked</option>
                      <option value="azure">Azure ML Asset</option>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="batch-target-provider">Target Execution Provider</Label>
                    <Select
                      id="batch-target-provider"
                      value={newProvider}

                      onChange={(e) => setNewProvider(e.target.value as IHVProvider)}
                    >
                      {selectableBatchProviders.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>

                {/* Active Passes for manual additions */}
                <fieldset className="space-y-2 border-t border-slate-900 pt-4 border-x-0 border-b-0 p-0 m-0 min-w-0">
                  <legend className="text-sm text-slate-400 uppercase tracking-wider px-0">
                    Pass Pipeline Elements
                  </legend>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <label className="flex items-center gap-2 p-2.5 rounded bg-slate-900 border border-slate-800 text-sm text-slate-300 cursor-pointer hover:border-slate-700">
                      <input
                        type="checkbox"
                        checked={passConv}
                        onChange={() => setPassConv(!passConv)}
                        className="accent-electric-blue"
                      />
                      <span>Conversion</span>
                    </label>
                    <label className="flex items-center gap-2 p-2.5 rounded bg-slate-900 border border-slate-800 text-sm text-slate-300 cursor-pointer hover:border-slate-700">
                      <input
                        type="checkbox"
                        checked={passQuant}
                        onChange={() => setPassQuant(!passQuant)}
                        className="accent-electric-blue"
                      />
                      <span>Quantization</span>
                    </label>
                    <label className="flex items-center gap-2 p-2.5 rounded bg-slate-900 border border-slate-800 text-sm text-slate-300 cursor-pointer hover:border-slate-700">
                      <input
                        type="checkbox"
                        checked={passPruning}
                        onChange={() => setPassPruning(!passPruning)}
                        className="accent-electric-blue"
                      />
                      <span>Weight Pruning</span>
                    </label>
                    <label className="flex items-center gap-2 p-2.5 rounded bg-slate-900 border border-slate-800 text-sm text-slate-300 cursor-pointer hover:border-slate-700">
                      <input
                        type="checkbox"
                        checked={passTransformer}
                        onChange={() => setPassTransformer(!passTransformer)}
                        className="accent-electric-blue"
                      />
                      <span>Attention Fusions</span>
                    </label>
                  </div>
                </fieldset>

                <div className="flex justify-end pt-2">
                  <Button
                    variant="default"
                    className="px-6 text-sm bg-electric-blue text-white"
                    disabled={!newModelName.trim()}
                    onClick={handleAddCustom}
                  >
                    Inject Into Serials Queues
                  </Button>
                </div>
              </div>
            )}

            {/* Queue Jobs Cards */}
            <div className="space-y-2.5">
              <BatchJobList
                jobs={jobs}
                selectedJobId={selectedJobId}
                onSelectJob={setSelectedJobId}
                onDeleteJob={handleDeleteJob}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Selected Job details Panel */}
      <div className="space-y-6">
        <Card className="h-[calc(100vh-140px)] flex flex-col overflow-hidden">
          <CardHeader
            title="Run Pipeline Analysis"
            description="Inspect selected batch execution profiles and log outputs."
            badge={<Layers className="h-4 w-4 text-slate-500" />}
          />

          <CardContent className="flex-1 overflow-y-auto space-y-5 flex flex-col p-6 pt-0">
            {selectedJob ? (
              <>
                <div className="space-y-3.5 bg-slate-950/40 p-4 border border-slate-900 rounded-xl text-sm">
                  <div className="flex justify-between items-center text-slate-450 border-b border-slate-900 pb-2">
                    <span className="font-semibold text-slate-300">Run Configuration Overview</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 font-mono">
                    <div>
                      <span className="text-slate-500 text-[11px] block uppercase font-bold">Model Base</span>
                      <span className="text-slate-350 text-sm truncate block mt-0.5">
                        {selectedJob.modelIdentifier}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[11px] block uppercase font-bold">
                        Provider target
                      </span>
                      <span className="text-slate-350 text-sm truncate block mt-0.5">
                        {selectedJob.provider}
                      </span>
                    </div>
                  </div>
                </div>

                {selectedJob.status === "completed" && selectedJob.metrics ? (
                  <div className="grid grid-cols-2 gap-2.5 animate-in fade-in">
                    <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800 text-center">
                      <span className="text-slate-500 text-[11px] block uppercase font-bold font-mono">
                        Latency
                      </span>
                      <span className="text-base font-bold text-slate-200 block mt-0.5 font-mono">
                        {selectedJob.metrics.latency}
                      </span>
                    </div>
                    <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800 text-center">
                      <span className="text-slate-500 text-[11px] block uppercase font-bold font-mono">
                        Throughput
                      </span>
                      <span className="text-base font-bold text-emerald-400 block mt-0.5 font-mono">
                        {selectedJob.metrics.throughput}
                      </span>
                    </div>
                    <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800 text-center">
                      <span className="text-slate-500 text-[11px] block uppercase font-bold font-mono font-mono">
                        VRAM Size
                      </span>
                      <span className="text-base font-bold text-electric-blue block mt-0.5 font-mono">
                        {selectedJob.metrics.memory}
                      </span>
                    </div>
                    <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800 text-center font-mono">
                      <span className="text-slate-500 text-[11px] block uppercase font-bold">
                        Compression
                      </span>
                      <span className="text-base font-bold text-electric-blue block mt-0.5 font-mono">
                        {selectedJob.metrics.compression}
                      </span>
                    </div>
                  </div>
                ) : selectedJob.status === "completed" ? (
                  <div className="p-4 rounded-lg bg-slate-900 border border-slate-850 flex items-center gap-3 text-sm text-slate-450">
                    <Sparkles className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span>Metrics will appear when Olive reports them in output.</span>
                  </div>
                ) : selectedJob.status === "running" ? (
                  <div className="p-4 rounded-lg bg-electric-blue/5 border border-electric-blue/10 flex items-center justify-between gap-3 text-sm text-electric-blue">
                    <span className="flex items-center gap-2 font-semibold">
                      <Play className="h-4 w-4 fill-electric-blue" />
                      Serial runner active...
                    </span>
                    <span className="font-mono">
                      {selectedJob.progress >= 0 ? `${selectedJob.progress}% complete` : "running…"}
                    </span>
                  </div>
                ) : (
                  <div className="p-4 rounded-lg bg-slate-900 border border-slate-850 flex items-center gap-3 text-sm text-slate-450">
                    <AlertCircle className="h-4.5 w-4.5 text-slate-500 shrink-0" />
                    <span>Execution logs will stream in live once queue is triggered.</span>
                  </div>
                )}

                {/* MCP Diagnostic for failed jobs (matched_entry from keyed MCP parse enables thumbs) */}
                {selectedJob.status === "failed" && (
                  <LazyMCPDiagnosticCard
                    diagnostic={batchDiagnostics[selectedJob.id] ?? null}
                    isDiagnosing={diagnosingJobs[selectedJob.id] ?? false}
                    fixApplied={appliedFixJobId === selectedJob.id ? "applied" : ""}
                    error={batchDiagnoseErrors[selectedJob.id] ?? null}
                    onApplyFix={() => {
                      const diagnostic = batchDiagnostics[selectedJob.id];
                      if (!diagnostic || !canApplyMcpDiagnostic(diagnostic)) return;
                      const {
                        patches,
                        logs,
                        appliedQuirks,
                        notedQuirks: _notedQuirks,
                      } = applyMcpDiagnosticToUiState(diagnostic, state.passes, state.passRecipeOverrides);
                      if (Object.keys(patches).length > 0 || appliedQuirks.length > 0) {
                        if (Object.keys(patches).length > 0) setState(patches);
                        // Append mapping logs to job logs, matching ExecutionWorkspace behavior
                        setState({
                          batchJobs: (state.batchJobs || []).map((j) =>
                            j.id === selectedJob.id ? { ...j, logs: [...j.logs, ...logs] } : j,
                          ),
                        });
                        // Gate success UI state on actual applied quirks/patches only
                        setAppliedFixJobId(selectedJob.id);
                      } else {
                        console.warn(
                          "[MCP FIX] No mappable config/quirks for batch job",
                          selectedJob.id,
                          logs,
                        );
                      }
                    }}
                    onRunDiagnosis={() => fetchKeyedDiagnostic(selectedJob.id, selectedJob.logs)}
                    onFeedbackSubmitted={handleFeedbackSubmitted}
                  />
                )}

                {/* Logs terminal */}
                <div className="flex-1 flex flex-col min-h-[220px]">
                  <span className="text-[11px] uppercase font-bold tracking-wider text-slate-450 mb-1.5 block font-mono">
                    Sequential Log Output
                  </span>
                  <div className="flex-1 bg-slate-950 rounded-lg p-3 border border-slate-850 overflow-auto font-mono text-xs leading-relaxed text-emerald-400/80">
                    {selectedJob.logs.map((log, i) => (
                      <div key={i} className="mb-1 text-balance">
                        {log}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-500">
                <Layers className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-sm">
                  No job selected. Click any job to inspect its serialization performance.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="xl:col-span-3">
        <BatchComparisonView
          records={comparisonRecords}
          compareResults={compareResults}
          comparing={comparing}
          compareError={compareError}
          onCompare={(preference) => {
            void handleCompare(preference);
          }}
        />
      </div>
    </div>
  );
}

function isTerminalBatchStatusJob(job: BatchJob): job is BatchJob & { status: TerminalBatchStatus } {
  return isTerminalBatchStatus(job.status);
}

function batchJobToHistoryRecord(
  job: BatchJob & { status: TerminalBatchStatus },
): JobHistoryRecord {
  return {
    id: job.id,
    jobId: job.oliveJobId ?? job.id,
    timestamp: new Date(
      job.finishedAtMs ?? job.startedAtMs ?? Date.now(),
    ).toISOString(),
    modelId: job.modelIdentifier,
    ihvProvider: job.provider,
    memoryOffload: "",
    status: job.status,
    exitCode: job.status === "completed" ? 0 : 1,
    durationMs:
      job.startedAtMs != null && job.finishedAtMs != null
        ? Math.max(0, job.finishedAtMs - job.startedAtMs)
        : 0,
    passCount: job.passes.length,
    passNames: job.passes,
    recipeJson: job.recipeJson ?? "",
  };
}
