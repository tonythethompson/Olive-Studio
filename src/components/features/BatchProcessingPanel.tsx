import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, Button, Label, Input, Select } from "@/components/ui";
import { UIState, BatchJob, IHVProvider, ModelSource } from "@/types";
import { usePipelineState } from "@/lib/stores/pipelineStore";
import { useAutoClearError, useMcpDiagnosticKeyed } from "@/lib/hooks";
import { applyMcpDiagnosticToUiState, canApplyMcpDiagnostic } from "@/lib/mcpConfigMapping";
import { buildRecipeJsonFromState, buildOliveRecipeFromBatchJob } from "@/lib/recipePipeline";
import { parseOliveMetricsFromLogs } from "@/lib/oliveLogMetrics";
import { commitUiStateUpdate, getPipelineValidation } from "@/lib/pipelineValidation";
import { DEFAULT_PASSES } from "@/lib/defaultPasses";
import { fetchHardwareProbe, getSelectableProviders, type HardwareProbeResult } from "@/lib/hardwareProbe";
import { PROVIDER_CATALOG } from "@/lib/providerCatalog";
import { MCPDiagnosticCard } from "./MCPDiagnosticCard";
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

/**
 * Renders a panel for managing, running, and inspecting sequential batch-processing jobs.
 *
 * @param state - Optional pipeline state; uses the pipeline store state when omitted.
 * @param setState - Optional state updater; uses the pipeline store updater when omitted.
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

  // Custom job creation states
  const [newModelName, setNewModelName] = useState("");
  const [newModelId, setNewModelId] = useState("meta-llama/Llama-3-8B");
  const [newSource, setNewSource] = useState<ModelSource>("huggingface");
  const [newProvider, setNewProvider] = useState<IHVProvider>("CUDAExecutionProvider");
  const [hardwareProbe, setHardwareProbe] = useState<HardwareProbeResult | null>(null);

  // Enabled passes for custom job
  const [passConv, setPassConv] = useState(true);
  const [passQuant, setPassQuant] = useState(true);
  const [passPruning, setPassPruning] = useState(false);
  const [passTransformer, setPassTransformer] = useState(false);

  // Keep jobsRef in sync with the latest batchJobs so SSE async callbacks can read current state
  useEffect(() => {
    jobsRef.current = state.batchJobs || [];
  }, [state.batchJobs]);

  useEffect(() => {
    fetchHardwareProbe()
      .then((probe) => {
        setHardwareProbe(probe);
        if (!getSelectableProviders(probe).includes(newProvider)) {
          setNewProvider(probe.recommendedProvider);
        }
      })
      .catch(() => setHardwareProbe(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectableBatchProviders = useMemo(
    () => PROVIDER_CATALOG.filter((p) => getSelectableProviders(hardwareProbe).includes(p.id)),
    [hardwareProbe],
  );

  const jobs = state.batchJobs || [];

  const handleStartQueue = async () => {
    if (isProcessing) {
      // Halt: request cancel and keep the open SSE so the server `done` event
      // settles the queue waiter. Do not clear isProcessing here — the running
      // start loop exits after the stream completes.
      haltRequestedRef.current = true;
      const oliveJobId = currentOliveJobIdRef.current;
      if (oliveJobId) {
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
                }
              : j,
          ),
        });
      }
      // No live job id yet (POST still in flight): the start loop cancels after jobId.
      return;
    }

    const queuedJobs = (state.batchJobs || []).filter((j) => j.status === "queued");
    if (queuedJobs.length === 0) return;

    haltRequestedRef.current = false;
    setIsProcessing(true);

    // Process jobs sequentially
    for (const job of queuedJobs) {
      if (haltRequestedRef.current) break;

      // Materialize this job's state to validate it before execution
      const jobState: UIState = {
        ...state,
        modelSource: job.modelSource,
        hfModelId: job.modelSource === "huggingface" ? job.modelIdentifier : state.hfModelId,
        azureModelPath: job.modelSource === "azure" ? job.modelIdentifier : state.azureModelPath,
        ihvProvider: job.provider,
      };
      const jobValidation = getPipelineValidation(jobState, { forLocalExecution: true });
      if (jobValidation.isBlocked) {
        const errorLogs = [
          ...((jobsRef.current ?? []).find((j) => j.id === job.id)?.logs || []),
          `[ERROR] Job validation failed: ${jobValidation.statusLabel}`,
          ...jobValidation.issues.filter((i) => i.severity === "critical").map((i) => `[ERROR] ${i.title}`),
        ];
        setState({
          batchJobs: (jobsRef.current ?? []).map((j) =>
            j.id === job.id ? { ...j, status: "failed", logs: errorLogs } : j,
          ),
        });
        fetchKeyedDiagnostic(job.id, errorLogs);
        continue;
      }

      const recipe = buildOliveRecipeFromBatchJob(job, state);
      setState({
        batchJobs: (jobsRef.current ?? []).map((j) =>
          j.id === job.id
            ? { ...j, status: "running", progress: -1, logs: ["[INFO] Starting Olive run..."] }
            : j,
        ),
      });

      // POST to /api/olive/run
      let jobId: string;
      try {
        const resp = await fetch("/api/olive/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipeJson: JSON.stringify(recipe, null, 2) }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
          const errorLogs = [
            ...((jobsRef.current ?? []).find((j) => j.id === job.id)?.logs || []),
            `[ERROR] ${err.error}`,
          ];
          setState({
            batchJobs: (jobsRef.current ?? []).map((j) =>
              j.id === job.id ? { ...j, status: "failed", logs: errorLogs } : j,
            ),
          });
          fetchKeyedDiagnostic(job.id, errorLogs);
          continue;
        }
        const data = await resp.json();
        jobId = data.jobId;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const errorLogs = [
          ...((jobsRef.current ?? []).find((j) => j.id === job.id)?.logs || []),
          `[ERROR] ${message}`,
        ];
        setState({
          batchJobs: (jobsRef.current ?? []).map((j) =>
            j.id === job.id ? { ...j, status: "failed", logs: errorLogs } : j,
          ),
        });
        fetchKeyedDiagnostic(job.id, errorLogs);
        continue;
      }

      if (haltRequestedRef.current) {
        // No SSE yet — apply the cancel endpoint's terminal status (or force
        // cancelled if cancel fails) so the row cannot stick on "running".
        type TerminalBatchStatus = "cancelled" | "completed" | "failed";
        const isTerminal = (s: string | undefined): s is TerminalBatchStatus =>
          s === "cancelled" || s === "completed" || s === "failed";
        let terminalStatus: TerminalBatchStatus = "cancelled";
        let haltLog = "[INFO] Halted before stream started.";
        try {
          const cancelResp = await fetch("/api/olive/cancel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId }),
          });
          const cancelData = (await cancelResp.json().catch(() => ({}))) as { status?: string };
          if (cancelResp.ok && isTerminal(cancelData.status)) {
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
        setState({
          batchJobs: (jobsRef.current ?? []).map((j) =>
            j.id === job.id
              ? {
                  ...j,
                  oliveJobId: jobId,
                  status: terminalStatus,
                  logs: [...(j.logs || []), haltLog],
                }
              : j,
          ),
        });
        break;
      }

      currentOliveJobIdRef.current = jobId;
      setState({
        batchJobs: (jobsRef.current ?? []).map((j) =>
          j.id === job.id ? { ...j, oliveJobId: jobId } : j,
        ),
      });

      // Open SSE stream and wait for completion
      await new Promise<void>((resolve) => {
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

        // Helper: try to extract a 0-100 progress percentage from a log line.
        // Returns the parsed number if found, otherwise -1 (indeterminate).
        const parseProgress = (line: string): number => {
          const lower = line.toLowerCase();
          if (lower.includes("pass") || lower.includes("step") || lower.includes("%")) {
            // Try to extract an explicit percentage, e.g. "45%" or "45 %"
            const match = line.match(/(\d+(?:\.\d+)?)\s*%/);
            if (match) {
              const pct = parseFloat(match[1]);
              if (!isNaN(pct)) return Math.min(Math.max(Math.round(pct), 0), 100);
            }
            // Progress-related line but no explicit %; keep indeterminate
            return -1;
          }
          return -1;
        };

        // Named 'log' SSE events: { line: string }
        evtSource.addEventListener("log", (e: MessageEvent) => {
          let line = String(e.data ?? "");
          try {
            const payload = JSON.parse(line) as { line?: string };
            if (typeof payload.line === "string") line = payload.line;
          } catch {
            /* raw line fallback */
          }
          const parsedPct = parseProgress(line);
          const currentJobs = jobsRef.current ?? [];
          setState({
            batchJobs: currentJobs.map((j) =>
              j.id === job.id
                ? {
                    ...j,
                    logs: [...j.logs, line],
                    // Use explicit percentage if available; otherwise keep existing
                    // progress (or -1 if not yet set)
                    progress: parsedPct >= 0 ? parsedPct : j.progress >= 0 ? j.progress : -1,
                  }
                : j,
            ),
          });
        });

        // Named 'done' SSE event with { exitCode, status }
        evtSource.addEventListener("done", (e: MessageEvent) => {
          let exitCode = 1;
          let serverStatus: string | undefined;
          try {
            const payload = JSON.parse(e.data) as { exitCode?: number; status?: string };
            exitCode = typeof payload.exitCode === "number" ? payload.exitCode : 1;
            serverStatus = payload.status;
          } catch {
            exitCode = 1;
          }
          const finalStatus =
            serverStatus === "cancelled" || haltRequestedRef.current
              ? "cancelled"
              : exitCode === 0
                ? "completed"
                : "failed";
          const currentJobs = jobsRef.current ?? [];
          const completedJob = currentJobs.find((j) => j.id === job.id);
          const metrics =
            finalStatus === "completed" && completedJob
              ? parseOliveMetricsFromLogs(completedJob.logs)
              : undefined;
          setState({
            batchJobs: currentJobs.map((j) =>
              j.id === job.id
                ? {
                    ...j,
                    status: finalStatus,
                    progress: finalStatus === "completed" ? 100 : j.progress,
                    metrics: metrics ?? j.metrics,
                  }
                : j,
            ),
          });
          // Auto-diagnose failed jobs via MCP knowledge base
          if (finalStatus === "failed" && completedJob) {
            fetchKeyedDiagnostic(job.id, completedJob.logs);
          }
          evtSource.close();
          const idx = activeSourcesRef.current.indexOf(evtSource);
          if (idx !== -1) activeSourcesRef.current.splice(idx, 1);
          finish();
        });

        evtSource.onerror = () => {
          const currentJobs = jobsRef.current ?? [];
          if (haltRequestedRef.current) {
            setState({
              batchJobs: currentJobs.map((j) =>
                j.id === job.id
                  ? {
                      ...j,
                      status: "cancelled",
                      logs: [...(j.logs || []), "[INFO] Halted by user."],
                    }
                  : j,
              ),
            });
            evtSource.close();
            finish();
            return;
          }
          const failedJob = currentJobs.find((j) => j.id === job.id);
          const errorLogs = [...(failedJob?.logs || []), "[ERROR] SSE connection lost."];
          setState({
            batchJobs: currentJobs.map((j) =>
              j.id === job.id ? { ...j, status: "failed", logs: errorLogs } : j,
            ),
          });
          // Auto-diagnose SSE failures via MCP knowledge base
          fetchKeyedDiagnostic(job.id, errorLogs);
          evtSource.close();
          finish();
        };
      });

      currentOliveJobIdRef.current = null;
      if (haltRequestedRef.current) break;
    }

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
                className="h-8 text-xs bg-electric-blue text-white shrink-0"
                onClick={handleToggleAddForm}
              >
                <Plus className="h-4 w-4 mr-1" /> Custom Job
              </Button>
            }
          />

          <CardContent className="space-y-4">
            {/* Info Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border border-slate-800 bg-slate-900/40 text-xs font-mono">
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
                  className="h-8 text-xs font-semibold px-4"
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
                    className="text-slate-500 hover:text-slate-300 text-xs cursor-pointer"
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
                  <legend className="text-xs text-slate-400 uppercase tracking-wider px-0">
                    Pass Pipeline Elements
                  </legend>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <label className="flex items-center gap-2 p-2.5 rounded bg-slate-900 border border-slate-800 text-xs text-slate-300 cursor-pointer hover:border-slate-700">
                      <input
                        type="checkbox"
                        checked={passConv}
                        onChange={() => setPassConv(!passConv)}
                        className="accent-electric-blue"
                      />
                      <span>Conversion</span>
                    </label>
                    <label className="flex items-center gap-2 p-2.5 rounded bg-slate-900 border border-slate-800 text-xs text-slate-300 cursor-pointer hover:border-slate-700">
                      <input
                        type="checkbox"
                        checked={passQuant}
                        onChange={() => setPassQuant(!passQuant)}
                        className="accent-electric-blue"
                      />
                      <span>Quantization</span>
                    </label>
                    <label className="flex items-center gap-2 p-2.5 rounded bg-slate-900 border border-slate-800 text-xs text-slate-300 cursor-pointer hover:border-slate-700">
                      <input
                        type="checkbox"
                        checked={passPruning}
                        onChange={() => setPassPruning(!passPruning)}
                        className="accent-electric-blue"
                      />
                      <span>Weight Pruning</span>
                    </label>
                    <label className="flex items-center gap-2 p-2.5 rounded bg-slate-900 border border-slate-800 text-xs text-slate-300 cursor-pointer hover:border-slate-700">
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
                    className="px-6 text-xs bg-electric-blue text-white"
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
              {jobs.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-slate-800 rounded-xl bg-slate-950/20 text-slate-500">
                  <Layers className="h-10 w-10 mx-auto mb-3 opacity-30 text-slate-400" />
                  <h5 className="font-semibold text-slate-400 mb-1">Queue Empty</h5>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    Configure your source models and trigger passes to queue jobs or add a custom sequence
                    manually.
                  </p>
                </div>
              ) : (
                jobs.map((job) => {
                  const isSelected = selectedJobId === job.id;
                  return (
                    <div
                      key={job.id}
                      onClick={() => setSelectedJobId(job.id)}
                      className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl border cursor-pointer transition-all ${
                        isSelected
                          ? "border-electric-blue bg-electric-blue/5"
                          : "border-slate-800/80 bg-slate-900/30 hover:border-slate-700 hover:bg-slate-900/50"
                      }`}
                    >
                      <div className="flex items-start gap-3.5 min-w-0">
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
                              className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full font-bold ${
                                job.status === "completed"
                                  ? "bg-emerald-500/10 text-emerald-400"
                                  : job.status === "running"
                                    ? "bg-electric-blue/10 text-electric-blue"
                                    : "bg-slate-800 text-slate-400"
                              }`}
                            >
                              {job.status}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 mt-1">
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
                                className="text-[10px] font-mono bg-slate-950 px-1.5 py-0.5 rounded border border-slate-850 text-slate-400"
                              >
                                {p}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-4 mt-4 sm:mt-0 pt-3 sm:pt-0 border-t sm:border-0 border-slate-900 shrink-0">
                        {job.status === "running" && (
                          <div className="flex flex-col items-end gap-1.5 w-24">
                            {job.progress >= 0 ? (
                              <>
                                <span className="text-[10px] font-mono text-electric-blue">
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
                                <span className="text-[10px] font-mono text-electric-blue">running…</span>
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
                          <div className="text-right text-xs bg-emerald-500/5 px-2.5 py-1.5 rounded-md border border-emerald-500/10">
                            <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider font-mono">
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
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteJob(job.id);
                            }}
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
                })
              )}
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
                <div className="space-y-3.5 bg-slate-950/40 p-4 border border-slate-900 rounded-xl text-xs">
                  <div className="flex justify-between items-center text-slate-450 border-b border-slate-900 pb-2">
                    <span className="font-semibold text-slate-300">Run Configuration Overview</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 font-mono">
                    <div>
                      <span className="text-slate-500 text-[10px] block uppercase font-bold">Model Base</span>
                      <span className="text-slate-350 text-xs truncate block mt-0.5">
                        {selectedJob.modelIdentifier}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 text-[10px] block uppercase font-bold">
                        Provider target
                      </span>
                      <span className="text-slate-350 text-xs truncate block mt-0.5">
                        {selectedJob.provider}
                      </span>
                    </div>
                  </div>
                </div>

                {selectedJob.status === "completed" && selectedJob.metrics ? (
                  <div className="grid grid-cols-2 gap-2.5 animate-in fade-in">
                    <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800 text-center">
                      <span className="text-slate-500 text-[10px] block uppercase font-bold font-mono">
                        Latency
                      </span>
                      <span className="text-base font-bold text-slate-200 block mt-0.5 font-mono">
                        {selectedJob.metrics.latency}
                      </span>
                    </div>
                    <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800 text-center">
                      <span className="text-slate-500 text-[10px] block uppercase font-bold font-mono">
                        Throughput
                      </span>
                      <span className="text-base font-bold text-emerald-400 block mt-0.5 font-mono">
                        {selectedJob.metrics.throughput}
                      </span>
                    </div>
                    <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800 text-center">
                      <span className="text-slate-500 text-[10px] block uppercase font-bold font-mono font-mono">
                        VRAM Size
                      </span>
                      <span className="text-base font-bold text-electric-blue block mt-0.5 font-mono">
                        {selectedJob.metrics.memory}
                      </span>
                    </div>
                    <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800 text-center font-mono">
                      <span className="text-slate-500 text-[10px] block uppercase font-bold">
                        Compression
                      </span>
                      <span className="text-base font-bold text-electric-blue block mt-0.5 font-mono">
                        {selectedJob.metrics.compression}
                      </span>
                    </div>
                  </div>
                ) : selectedJob.status === "completed" ? (
                  <div className="p-4 rounded-lg bg-slate-900 border border-slate-850 flex items-center gap-3 text-xs text-slate-450">
                    <Sparkles className="h-4 w-4 text-emerald-500 shrink-0" />
                    <span>Metrics will appear when Olive reports them in output.</span>
                  </div>
                ) : selectedJob.status === "running" ? (
                  <div className="p-4 rounded-lg bg-electric-blue/5 border border-electric-blue/10 flex items-center justify-between gap-3 text-xs text-electric-blue">
                    <span className="flex items-center gap-2 font-semibold">
                      <Play className="h-4 w-4 fill-electric-blue" />
                      Serial runner active...
                    </span>
                    <span className="font-mono">
                      {selectedJob.progress >= 0 ? `${selectedJob.progress}% complete` : "running…"}
                    </span>
                  </div>
                ) : (
                  <div className="p-4 rounded-lg bg-slate-900 border border-slate-850 flex items-center gap-3 text-xs text-slate-450">
                    <AlertCircle className="h-4.5 w-4.5 text-slate-500 shrink-0" />
                    <span>Execution logs will stream in live once queue is triggered.</span>
                  </div>
                )}

                {/* MCP Diagnostic for failed jobs */}
                {selectedJob.status === "failed" && (
                  <MCPDiagnosticCard
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
                  />
                )}

                {/* Logs terminal */}
                <div className="flex-1 flex flex-col min-h-[220px]">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-slate-450 mb-1.5 block font-mono">
                    Sequential Log Output
                  </span>
                  <div className="flex-1 bg-slate-950 rounded-lg p-3 border border-slate-850 overflow-auto font-mono text-[11px] leading-relaxed text-emerald-400/80">
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
                <p className="text-xs">
                  No job selected. Click any job to inspect its serialization performance.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
