import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useDeferredValue,
  useTransition,
  Suspense,
  lazy,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { UIState, type McpTroubleshootFeedbackRating } from "@/types";
import { usePipelineState } from "@/lib/stores/pipelineStore";
import { useAutoClearError } from "@/lib/hooks/useAutoClearError";
import { useMcpDiagnosticKeyed } from "@/lib/hooks/useMcpDiagnostic";
import { applyMcpDiagnosticToUiState, canApplyMcpDiagnostic } from "@/lib/mcpConfigMapping";
import {
  expandLogSelection,
  isFailureLine,
  isStudioHfTaskSpeechFix,
} from "@/lib/logFailurePatterns";
import { useOliveStream } from "./useOliveStream";
import { navigatePipeline } from "@/lib/pipelineNavigation";
import { usePlaygroundStore } from "@/lib/stores/playgroundStore";
import { DiagnosisHistory, type DiagnosisEntry } from "./DiagnosisHistory";
import { LazyMCPDiagnosticCard } from "./LazyMCPDiagnosticCard";
import {
  Code,
  Play,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  FileJson,
  X,
  Workflow,
  Globe,
  RefreshCw,
  Download,
  AlertTriangle,
  CircleDot,
  History,
  Square,
  Wrench,
  MoreHorizontal,
  FileText,
  Bug,
} from "lucide-react";
import { cn } from "@/lib/utils";

import { buildRecipeFromState, buildRecipeJsonFromState } from "@/lib/recipePipeline";
import { buildOwrConfigs } from "@/lib/owrExportConfigs";
import { useHardwareProbe } from "@/lib/hooks/useHardwareProbe";
import { qnnExplicitRetryProviders } from "@/lib/qnnReadiness";
import { prepareProviderChange } from "@/lib/pipelineValidation";
import { VramEstimateBanner } from "@/components/features/VramEstimateBanner";
import { GpuMetricsBar } from "@/components/features/execute/GpuMetricsBar";

import { getJobHistory } from "@/lib/jobHistoryStore";
import { downloadMarkdownReport } from "@/lib/reportGenerator";
import { JobHistoryModal } from "@/components/features/execute/JobHistoryModal";
import { ReportIssueModal } from "@/components/ReportIssueModal";
import { OwrExportOverlay } from "./OwrExportOverlay";
import type { ReportArea } from "@/lib/issueReport";

const RecipeGraphView = lazy(() => import("./recipe-graph/RecipeGraphView").then((m) => ({ default: m.RecipeGraphView })));

/**
 * Renders a centered loading spinner with a descriptive label.
 *
 * @param label - The text displayed below the spinner
 * @param minH - The optional minimum height of the loading container
 */

function collectActivePassNames(passes: UIState["passes"]): string[] {
  const names: string[] = [];
  if (passes.conversion) {
    names.push(`Conversion (${passes.conversionFormat === "onnx" ? "ONNX" : "OpenVINO"})`);
  }
  if (passes.quantization) names.push(`Quantization (${passes.quantPrecision})`);
  if (passes.pruning) names.push(`Pruning (${passes.pruningMethod})`);
  if (passes.onnxTransforms) names.push("ORT Transforms");
  return names.length > 0 ? names : ["Default Baseline Export"];
}

function resolveQueuedModelIdentifier(state: UIState): string {
  if (state.modelSource === "huggingface") return state.hfModelId || "unspecified-hf-model";
  if (state.modelSource === "azure") return state.azureModelPath || "AzureML Asset Container";
  return "Offline Weights Folder";
}

function buildQueuedBatchJob(state: UIState) {
  const mid = resolveQueuedModelIdentifier(state);
  const activePassesNames = collectActivePassNames(state.passes);
  const jobName = `Staged: ${mid.split("/").pop()} - ${state.ihvProvider.replace("ExecutionProvider", "")}`;
  return {
    id: "job-" + Date.now(),
    name: jobName,
    modelSource: state.modelSource,
    modelIdentifier: mid,
    provider: state.ihvProvider,
    passes: activePassesNames,
    recipeJson: buildRecipeJsonFromState(state),
    status: "queued" as const,
    progress: 0,
    progressKnown: true,
    logs: ["Job created from active template configuration. Awaiting queue start."],
  };
}

function describeAppliedMcpPatches(
  patches: Partial<UIState>,
  statePasses: UIState["passes"],
  appliedQuirks: string[],
): string[] {
  const appliedParts: string[] = [];
  if (patches.cacheDir) appliedParts.push(`cacheDir=${patches.cacheDir}`);
  if (patches.passRecipeOverrides) {
    appliedParts.push(`passOverrides=${Object.keys(patches.passRecipeOverrides).join("+")}`);
  }
  if (patches.passes) {
    const changed = Object.entries(patches.passes)
      .filter(([k, v]) => (statePasses as Record<string, unknown>)[k] !== v)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`);
    if (changed.length) appliedParts.push(...changed.slice(0, 8));
  }
  if (appliedQuirks.length) appliedParts.push(`quirks=${appliedQuirks.join("+")}`);
  return appliedParts;
}

function LoadingFallback({ label, minH }: { label: string; minH?: string }) {
  return (
    <div className="flex items-center justify-center w-full" style={minH ? { minHeight: minH } : undefined}>
      <div className="flex flex-col items-center gap-3 py-16">
        <RefreshCw className="h-5 w-5 text-electric-blue animate-spin" />
        <p className="text-sm text-slate-500">{label}</p>
      </div>
    </div>
  );
}

/**
 * Provides a workspace for reviewing, validating, exporting, queuing, and executing an Olive pipeline.
 *
 * @param state - Controlled pipeline state. Must be provided together with `setState`.
 * @param setState - Updates controlled pipeline state. Must be provided together with `state`.
 * @param onOpenAiAudit - Called when the AI audit review is opened.
 * @param onRunStateChange - Called when live execution starts or stops.
 * @throws Error if only one of `state` or `setState` is provided.
 */
export function ExecutionWorkspace({
  state: propState,
  setState: propSetState,
  onOpenAiAudit,
  onRunStateChange,
  onExecute: _onExecute,
  jobId: _jobId,
  isRunning: _isRunning,
  setIsRunning: _setIsRunning,
}: {
  state?: UIState;
  setState?: (s: Partial<UIState>) => void;
  onOpenAiAudit?: () => void;
  onRunStateChange?: (running: boolean) => void;
  onExecute?: () => void;
  jobId?: string | null;
  isRunning?: boolean;
  setIsRunning?: (v: boolean) => void;
} = {}) {
  const storeState = usePipelineState();
  const setPlaygroundSubView = usePlaygroundStore((s) => s.setActiveSubView);
  // All-or-nothing controlled pair: both props or neither. Mixed mode is rejected.
  const hasState = propState !== undefined;
  const hasSetState = propSetState !== undefined;
  if (hasState !== hasSetState) {
    throw new Error("ExecutionWorkspace: state and setState must both be provided or both omitted.");
  }
  const isControlled = hasState && hasSetState;
  const state = isControlled ? propState : storeState.state;
  const setState = isControlled ? propSetState : storeState.setState;
  // Defer the expensive recipe/validation derivation so text input stays
  // responsive; submit handlers rebuild fresh from `state` at click time.
  const deferredState = useDeferredValue(state);
  // Live execution state
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [reportArea, setReportArea] = useState<ReportArea | undefined>(undefined);
  const [reportDescription, setReportDescription] = useState("");
  const [recipeView, setRecipeViewRaw] = useState<"graph" | "json">("graph");
  const [visitedRecipeViews, setVisitedRecipeViews] = useState<Set<string>>(new Set(["graph"]));
  const [moreToolsOpen, setMoreToolsOpen] = useState(false);
  const moreToolsContainerRef = useRef<HTMLDivElement | null>(null);
  const moreToolsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [, startRecipeTransition] = useTransition();
  const setRecipeView = (view: "graph" | "json") => {
    startRecipeTransition(() => {
      setRecipeViewRaw(view);
      setVisitedRecipeViews((prev) => {
        if (prev.has(view)) return prev;
        return new Set(prev).add(view);
      });
    });
  };
  const [_isCopied, setIsCopied] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [showGraphDot, setShowGraphDot] = useState(true);
  const [isExportCopied, setIsExportCopied] = useState(false);
  const [justQueued, setJustQueued] = useState(false);

  const {
    fetchKeyedDiagnostic,
    diagnostics: keyedDiagnostics,
    diagnosingKeys,
    errors: diagnoseErrors,
  } = useMcpDiagnosticKeyed();
  const mcpDiagnostic = keyedDiagnostics["current"] ?? null;
  const isDiagnosing = diagnosingKeys?.["current"] ?? false;
  const diagnoseError = diagnoseErrors?.["current"] ?? null;
  const [mcpFixApplied, setMcpFixApplied] = useAutoClearError(3000);
  // Diagnosis history for comparing across runs
  const [diagnosisHistory, setDiagnosisHistory] = useState<DiagnosisEntry[]>([]);
  const [activeHistoryIndex, setActiveHistoryIndex] = useState(-1);

  // Browse diagnosis history entries on the card; -1 means "live" (current MCP result).
  const viewingHistoricalDiagnosis =
    activeHistoryIndex >= 0 && activeHistoryIndex < diagnosisHistory.length;
  const displayedDiagnostic = viewingHistoricalDiagnosis
    ? diagnosisHistory[activeHistoryIndex]!.diagnostic
    : mcpDiagnostic;
  const displayedFixApplied = viewingHistoricalDiagnosis
    ? diagnosisHistory[activeHistoryIndex]!.fixApplied
      ? "applied"
      : ""
    : mcpFixApplied;

  // Log line selection state for manual diagnosis
  const [selectedLogIndices, setSelectedLogIndices] = useState<Set<number>>(new Set());
  const lastClickedIndexRef = useRef<number | null>(null);

  /** Card self-submits feedback; parent hook is optional analytics / future history annotation. */
  const handleFeedbackSubmitted = (payload: {
    matched_entry: string;
    rating: McpTroubleshootFeedbackRating;
  }) => {
    // No UI mutation — diagnosis display and history stay as-is after thumbs.
    void payload.matched_entry;
  };

  const handleApplyMcpFix = () => {
    if (!displayedDiagnostic || !canApplyMcpDiagnostic(displayedDiagnostic)) {
      setExecutionLogs((prev) => [
        ...prev,
        "[MCP FIX] Nothing auto-applyable. Follow Recommended Fix / Known Quirks manually.",
      ]);
      return;
    }

    if (isStudioHfTaskSpeechFix(displayedDiagnostic)) {
      setState({ hfTask: "automatic-speech-recognition" });
      setExecutionLogs((prev) => [
        ...prev,
        "[FIX] Hugging Face task corrected to `automatic-speech-recognition` for Whisper. Rebuild/refresh the recipe, then run Execute Live again.",
      ]);
      setMcpFixApplied("applied");
      // Mark the history row that matches the applied diagnostic (live = index 0).
      const historyIdx = viewingHistoricalDiagnosis ? activeHistoryIndex : 0;
      if (historyIdx >= 0 && historyIdx < diagnosisHistory.length) {
        setDiagnosisHistory((prev) =>
          prev.map((entry, idx) => (idx === historyIdx ? { ...entry, fixApplied: true } : entry)),
        );
      }
      return;
    }

    const {
      patches,
      logs,
      appliedQuirks,
      notedQuirks: _notedQuirks,
    } = applyMcpDiagnosticToUiState(displayedDiagnostic, state.passes, state.passRecipeOverrides);

    const hasPatches = Object.keys(patches).length > 0;
    if (!hasPatches && logs.length === 0) {
      setExecutionLogs((prev) => [
        ...prev,
        "[MCP FIX] Could not map this diagnostic to UI/recipe fields. See Recommended Fix and Known Quirks.",
      ]);
      return;
    }

    if (hasPatches) {
      setState(patches);
    }

    const appliedParts = describeAppliedMcpPatches(patches, state.passes, appliedQuirks);

    setExecutionLogs((prev) => [
      ...prev,
      ...logs,
      hasPatches
        ? `[MCP FIX] Applied config + quirks: ${appliedParts.join(", ") || Object.keys(patches).join(", ")}. Re-run Execute (recipe order: Convert → Optimize → Quantize).`
        : "[MCP FIX] Logged notes only. No UI fields changed.",
    ]);
    // Gate success UI state on actual applied quirks/patches only, not noted quirks
    const applied = hasPatches || appliedQuirks.length > 0;
    setMcpFixApplied(applied ? "applied" : "");
    if (applied) {
      const historyIdx = viewingHistoricalDiagnosis ? activeHistoryIndex : 0;
      if (historyIdx >= 0 && historyIdx < diagnosisHistory.length) {
        setDiagnosisHistory((prev) =>
          prev.map((entry, idx) => (idx === historyIdx ? { ...entry, fixApplied: true } : entry)),
        );
      }
    }
  };



  const handleSelectHistory = (index: number) => {
    setActiveHistoryIndex(index);
  };

  const handleClearHistory = () => {
    setDiagnosisHistory([]);
    setActiveHistoryIndex(-1);
  };

  const isUnmountedRef = useRef(false);
  const justQueuedTimerRef = useRef<NodeJS.Timeout | null>(null);
  const copiedTimerRef = useRef<NodeJS.Timeout | null>(null);
  const exportCopiedTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
      if (justQueuedTimerRef.current) clearTimeout(justQueuedTimerRef.current);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      if (exportCopiedTimerRef.current) clearTimeout(exportCopiedTimerRef.current);
    };
  }, []);

  // States for Exporting to ONNX Runtime Web/Mobile (OWR)
  const [isOwrExportOpen, setIsOwrExportOpen] = useState(false);
  const [owrPlatform, setOwrPlatform] = useState<"web" | "mobile">("web");
  const [owrThreads, setOwrThreads] = useState("4");
  const [owrVramMode, setOwrVramMode] = useState<"performance" | "memory">("performance");
  const [owrSelectedFile, setOwrSelectedFile] = useState<
    "ort_config.json" | "web_init.js" | "mobile_init.kt" | "onnx_model_manifest.json"
  >("ort_config.json");
  const [owrDownloadError, setOwrDownloadError] = useState<string | null>(null);
  const [isOwrDownloading, setIsOwrDownloading] = useState(false);

  const { data: hardwareProbe = null } = useHardwareProbe();

  useEffect(() => {
    if (!moreToolsOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && moreToolsContainerRef.current?.contains(target)) return;
      setMoreToolsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMoreToolsOpen(false);
      moreToolsTriggerRef.current?.focus();
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [moreToolsOpen]);

  const owrConfigs = useMemo(
    () =>
      buildOwrConfigs({
        state,
        platform: owrPlatform,
        threads: owrThreads,
        vramMode: owrVramMode,
      }),
    [state, owrPlatform, owrThreads, owrVramMode],
  );

  const handleDownloadOwrBundle = async () => {
    if (isOwrDownloading) return;
    setIsOwrDownloading(true);
    try {
      setOwrDownloadError(null);
      const { ortConfig, manifestConfig, webInitCode, mobileInitCode } = owrConfigs;
      const rawModelId = state.hfModelId || (state.localFiles && state.localFiles[0]?.name) || "model";
      const modelName = rawModelId.split("/").pop() || "model";

      let zipData: Uint8Array;
      // Dynamic import for code-splitting: fflate is only needed for OWR export
      let zipSync: typeof import("fflate").zipSync;
      let strToU8: typeof import("fflate").strToU8;
      try {
        ({ zipSync, strToU8 } = await import("fflate"));
      } catch (e) {
        console.error("Failed to load ZIP module", e);
        setOwrDownloadError("Couldn't load the ZIP module. Check your connection and try again.");
        return;
      }

      try {
        const files: Record<string, Uint8Array> = {};
        files["ort_config.json"] = strToU8(JSON.stringify(ortConfig, null, 2));
        files["onnx_model_manifest.json"] = strToU8(JSON.stringify(manifestConfig, null, 2));

        if (owrPlatform === "web") {
          files["web_init.js"] = strToU8(webInitCode);
        } else {
          files["mobile_init.kt"] = strToU8(mobileInitCode);
        }

        const readme = `ONNX Runtime Web/Mobile (OWR) Deployment Bundle
  ==================================================
  Created: ${new Date().toLocaleString()}
  Target Environment: ONNX Runtime ${owrPlatform === "web" ? "Web (WebGPU/WASM)" : "Mobile (Android/iOS)"}
  Optimized Model: ${modelName}

  Contents of this bundle:
  1. onnx_model_manifest.json - Full optimization and pipeline conversion audit trail from MS Olive.
  2. ort_config.json - Direct configuration rules for loading the model session dynamically.
  3. ${owrPlatform === "web" ? "web_init.js" : "mobile_init.kt"} - Boilerplate initialization and execution patterns.

  Deployment Steps:
  ${owrPlatform === "web"
          ? "- Place the optimized model file (model.onnx) in your public asset folder.\\n- Install 'onnxruntime-web' dependency using pnpm.\\n- Import and invoke your customized initializeOrtSession() function. "
          : "- Place the compiled ORT flatbuffer file (model.ort) under your Android App's 'src/main/assets' directory.\\n- Implement 'ai.onnxruntime:onnxruntime-android' via gradle.\\n- Wire up your OnnxModelExecutor wrapper inside Activities/Handlers."
        }
  `;
        files["README.txt"] = strToU8(readme);

        zipData = zipSync(files);
      } catch (e) {
        console.error("Archive generation failed", e);
        setOwrDownloadError("Failed to create the ZIP archive. Check the browser console for details.");
        return;
      }

      try {
        const content = new Blob([zipData as unknown as ArrayBuffer], { type: "application/zip" });
        const url = URL.createObjectURL(content);
        const link = document.createElement("a");
        link.href = url;
        const modelCleanName = modelName.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
        link.download = `owr_bundle_${owrPlatform}_${modelCleanName}.zip`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } catch (e) {
        console.error("ZIP Generation failed", e);
        setOwrDownloadError("ZIP generation failed. Try again, or check the browser console for details.");
      }
    } finally {
      setIsOwrDownloading(false);
    }
  };

  const pipeline = buildRecipeFromState(deferredState, { hardwareProbe });
  const { recipe, recipeJson: _recipeJson, validation, schema, advisories, isRunnable } = pipeline;

  // SSE streaming lifecycle managed by useOliveStream hook
  const {
    liveJobId,
    isRunning,
    executionLogs,
    setExecutionLogs,
    executionStatus,
    executionExitCode,
    gpuMetrics,
    runRecipeJson,
    handleExecuteLive,
    handleCancelJob,
  } = useOliveStream({
    state,
    hardwareProbe,
    setState,
    onRunStateChange,
    isUnmountedRef,
    setMcpFixApplied,
  });

  const schemaErrors = schema.errors ?? [];
  // Local structure/compat checks only. A green badge must not imply Execute Live succeeded.
  const localValidationLabel = !schema.valid
    ? `Schema invalid (${schemaErrors.length} issue${schemaErrors.length === 1 ? "" : "s"})`
    : validation.statusLabel;
  const localValidationTone = !schema.valid ? "error" : validation.statusTone;
  const runFailed = executionStatus === "failed";
  const validationLabel = runFailed
    ? `Run failed (exit ${executionExitCode ?? "?"}) · ${localValidationTone === "success" ? "local checks still OK" : localValidationLabel
    }`
    : localValidationLabel;
  const validationTone = runFailed ? "error" : localValidationTone;

  // Clear log selection once when a new live run starts (not on every streamed line).
  useLayoutEffect(() => {
    setSelectedLogIndices(new Set()); // eslint-disable-line react-hooks/set-state-in-effect
    lastClickedIndexRef.current = null;
  }, [liveJobId]);

  // Auto-select error lines when a job fails so Diagnose can focus on them.
  const prevStatusRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (executionStatus === "failed" && prevStatusRef.current !== "failed") {
      if (executionLogs.length > 0) {
        const errorIndices = new Set<number>();
        for (let i = 0; i < executionLogs.length; i++) {
          if (isFailureLine(executionLogs[i]!)) {
            errorIndices.add(i);
          }
        }
        if (errorIndices.size > 0) {
          setSelectedLogIndices(errorIndices); // eslint-disable-line react-hooks/set-state-in-effect
        }
      }
    }
    prevStatusRef.current = executionStatus;
  }, [executionStatus, executionLogs]);

  // Log line selection for manual diagnosis
  const handleLogLineClick = (index: number, e: ReactMouseEvent<HTMLParagraphElement>) => {
    setSelectedLogIndices((prev) => {
      const next = new Set(prev);
      if (e.shiftKey && lastClickedIndexRef.current !== null) {
        const start = Math.min(lastClickedIndexRef.current, index);
        const end = Math.max(lastClickedIndexRef.current, index);
        for (let i = start; i <= end; i++) next.add(i);
      } else if (e.ctrlKey || e.metaKey) {
        if (next.has(index)) next.delete(index);
        else next.add(index);
      } else {
        next.clear();
        next.add(index);
      }
      return next;
    });
    lastClickedIndexRef.current = index;
  };

  /** Prefer selected lines when present; expand traceback context; else full log. */
  const handleDiagnose = () => {
    if (executionLogs.length === 0) return;
    setMcpFixApplied("");
    const logs =
      selectedLogIndices.size > 0
        ? expandLogSelection(executionLogs, Array.from(selectedLogIndices))
        : executionLogs;
    void fetchKeyedDiagnostic("current", logs);
  };

  // Auto-diagnose once when a run fails (same pattern as BatchProcessingPanel).
  const autoDiagnoseRef = useRef(false);
  useEffect(() => {
    if (executionStatus === "failed" && executionLogs.length > 0 && !autoDiagnoseRef.current) {
      autoDiagnoseRef.current = true;
      const errorIndices: number[] = [];
      for (let i = 0; i < executionLogs.length; i++) {
        if (isFailureLine(executionLogs[i]!)) {
          errorIndices.push(i);
        }
      }
      const logs = errorIndices.length > 0 ? expandLogSelection(executionLogs, errorIndices) : executionLogs;
      void fetchKeyedDiagnostic("current", logs);
    }
    if (executionStatus !== "failed") {
      autoDiagnoseRef.current = false;
    }
  }, [executionStatus, executionLogs, fetchKeyedDiagnostic]);

  // Capture the submitted recipe when Execute completes so Playground uses the exact recipe that ran,
  // not a rebuilt version that might include post-run state edits.
  const setCapturedRunRecipe = usePlaygroundStore((s) => s.setCapturedRunRecipe);
  useEffect(() => {
    if (executionStatus === "completed" && runRecipeJson) {
      setCapturedRunRecipe(runRecipeJson);
    }
  }, [executionStatus, runRecipeJson, setCapturedRunRecipe]);

  // Auto-save completed diagnoses to history
  const prevDiagnosticRef = useRef(mcpDiagnostic);
  useEffect(() => {
    if (mcpDiagnostic && mcpDiagnostic !== prevDiagnosticRef.current) {
      const entry: DiagnosisEntry = {
        id: `diag-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        diagnostic: mcpDiagnostic,
        logSnippet: executionLogs.slice(-20).join("\n"),
        fixApplied: false,
      };
      setDiagnosisHistory((prev) => [entry, ...prev].slice(0, 50));
      setActiveHistoryIndex(0);
    }
    prevDiagnosticRef.current = mcpDiagnostic;
  }, [mcpDiagnostic, executionLogs]);

  const handleQueueJob = () => {
    // Rebuild from live state — the deferred display pipeline may lag the latest keystroke.
    const fresh = buildRecipeFromState(state, { hardwareProbe });
    if (!fresh.isRunnable) {
      const blockingCount = fresh.validation.criticalCount + fresh.localExecutionIssues.length;
      const freshSchemaErrors = fresh.schema.errors ?? [];
      const freshBlockLines = fresh.localExecutionIssues.map(
        (issue) => `[BLOCK] ${issue.title}: ${issue.description}`,
      );
      setExecutionLogs([
        fresh.schema.valid
          ? `[ERROR] Cannot queue batch job: ${blockingCount} blocking issue(s). Resolve in the graph or passes panel.`
          : `[ERROR] Cannot queue batch job: recipe schema invalid.\n${freshSchemaErrors.map((e) => `[SCHEMA] ${e}`).join("\n")}`,
        ...(fresh.schema.valid
          ? [
            ...fresh.validation.issues
              .filter((issue) => issue.severity === "critical")
              .map((issue) => `[BLOCK] ${issue.title}: ${issue.description}`),
            ...freshBlockLines,
          ]
          : []),
      ]);
      return;
    }

    const newJob = buildQueuedBatchJob(state);
    const currentJobs = state.batchJobs || [];
    setState({ batchJobs: [...currentJobs, newJob] });
    setJustQueued(true);
    if (justQueuedTimerRef.current) clearTimeout(justQueuedTimerRef.current);
    justQueuedTimerRef.current = setTimeout(() => setJustQueued(false), 3000);
  };



  const _handleCopy = () => {
    // Rebuild from live state — the displayed (deferred) recipe may lag the latest keystroke.
    navigator.clipboard.writeText(buildRecipeJsonFromState(state));
    setIsCopied(true);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setIsCopied(false), 2000);
  };

  const handleExportCopy = () => {
    // Rebuild from live state — the displayed (deferred) recipe may lag the latest keystroke.
    navigator.clipboard.writeText(buildRecipeJsonFromState(state));
    setIsExportCopied(true);
    if (exportCopiedTimerRef.current) clearTimeout(exportCopiedTimerRef.current);
    exportCopiedTimerRef.current = setTimeout(() => setIsExportCopied(false), 2000);
  };

  const handleExportDownload = () => {
    // Rebuild from live state — the displayed (deferred) recipe may lag the latest keystroke.
    const jsonString = buildRecipeJsonFromState(state);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const modelCleanName = (state.hfModelId || (state.localFiles && state.localFiles[0]?.name) || "model")
      .replace(/[^a-z0-9_-]/gi, "_")
      .toLowerCase();
    link.href = url;
    link.download = `olive_recipe_${modelCleanName}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      data-testid="execution-workspace"
      className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-2 duration-300 relative"
    >
      {/* Export Recipe Overlay */}
      {isExportOpen && (
        <div className="absolute inset-0 z-55 bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 animate-in fade-in overflow-y-auto">
          <Card className="w-full max-w-2xl border-electric-blue/30 flex flex-col max-h-[85vh]">
            <CardHeader
              title="Export Microsoft Olive Recipe"
              description="Download your dynamic JSON recipe configuration or copy the schema to run with the MS Olive CLI."
              badge={
                <Button
                  variant="ghost"
                  className="h-8 w-8 p-0 hover:bg-slate-800"
                  onClick={() => setIsExportOpen(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              }
            />
            <CardContent className="flex flex-col gap-4 overflow-hidden flex-1 p-6">
              <div className="flex-1 min-h-[300px] relative flex flex-col overflow-hidden bg-slate-950 border border-slate-800 rounded-lg">
                <div className="flex items-center justify-between px-4 py-2 border-b border-slate-900 bg-slate-900/40">
                  <div className="flex items-center gap-2">
                    <FileJson className="h-4 w-4 text-emerald-400" />
                    <span className="text-sm font-mono text-slate-300">olive_recipe.json</span>
                  </div>
                  <span className="text-[11px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded font-mono font-semibold">
                    VALID OLIVE SCHEMA
                  </span>
                </div>
                <textarea
                  readOnly
                  className="w-full flex-1 bg-transparent p-4 font-mono text-sm text-emerald-400 focus-visible:outline-none resize-none overflow-y-auto cursor-text"
                  value={JSON.stringify(recipe, null, 2)}
                  onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                />
              </div>

              <div className="flex justify-between items-center gap-3 pt-2">
                <span className="text-sm text-slate-500 font-mono hidden sm:inline">
                  Generated dynamic recipe mapping
                </span>
                <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                  <Button variant="outline" className="text-sm h-9" onClick={() => setIsExportOpen(false)}>
                    Close
                  </Button>
                  <Button
                    variant="outline"
                    className="text-sm h-9 border-electric-blue/30 text-electric-blue hover:text-white hover:bg-electric-blue/10"
                    onClick={handleExportCopy}
                  >
                    {isExportCopied ? (
                      <Check className="h-4 w-4 mr-1.5 text-emerald-500" />
                    ) : (
                      <Copy className="h-4 w-4 mr-1.5" />
                    )}
                    {isExportCopied ? "Copied!" : "Copy to Clipboard"}
                  </Button>
                  <Button
                    variant="default"
                    className="text-sm h-9 bg-electric-blue hover:bg-electric-blue/90 text-slate-950"
                    onClick={handleExportDownload}
                  >
                    <Download className="h-4 w-4 mr-1.5" /> Save File (.json)
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* OWR Export Bundle Overlay */}
      <OwrExportOverlay
        open={isOwrExportOpen}
        onClose={() => setIsOwrExportOpen(false)}
        configs={owrConfigs}
        platform={owrPlatform}
        onPlatformChange={setOwrPlatform}
        selectedFile={owrSelectedFile}
        onFileSelect={setOwrSelectedFile}
        threads={owrThreads}
        onThreadsChange={setOwrThreads}
        vramMode={owrVramMode}
        onVramModeChange={setOwrVramMode}
        onDownloadBundle={handleDownloadOwrBundle}
        isDownloading={isOwrDownloading}
        downloadError={owrDownloadError}
      />

      {/* Recipe Preview */}
      <Card
        className={cn(
          "flex flex-col overflow-hidden",
          recipeView === "graph" ? "min-h-[560px] wide:min-h-[680px]" : "min-h-[420px]",
        )}
      >
        <CardHeader
          title="Olive Recipe Definition"
          description={
            recipeView === "graph"
              ? undefined
              : "The exact JSON schema that will be sent to the Olive Engine."
          }
          badge={
            <div className="flex flex-wrap items-center gap-2">
              <div
                className="flex bg-slate-900 border border-slate-800 rounded p-0.5"
                role="group"
                aria-label="Recipe view"
              >
                <button
                  type="button"
                  aria-pressed={recipeView === "graph"}
                  onClick={() => setRecipeView("graph")}
                  className={`px-2.5 py-1 text-xs font-semibold rounded transition-all flex items-center gap-1 cursor-pointer ${recipeView === "graph"
                    ? "bg-electric-blue text-slate-950"
                    : "text-slate-400 hover:text-slate-200"
                    }`}
                >
                  <Workflow className="h-3 w-3" /> Graph Flow
                </button>
                <button
                  type="button"
                  aria-pressed={recipeView === "json"}
                  onClick={() => setRecipeView("json")}
                  className={`px-2.5 py-1 text-xs font-semibold rounded transition-all flex items-center gap-1 cursor-pointer ${recipeView === "json"
                    ? "bg-electric-blue text-slate-950"
                    : "text-slate-400 hover:text-slate-200"
                    }`}
                >
                  <Code className="h-3 w-3" /> JSON Code
                </button>
              </div>
              {recipeView === "graph" && (
                <button
                  type="button"
                  onClick={() => setShowGraphDot((v) => !v)}
                  title={showGraphDot ? "Hide flow dot" : "Show flow dot"}
                  aria-label={showGraphDot ? "Hide flow dot" : "Show flow dot"}
                  className={`h-8 w-8 flex items-center justify-center rounded border transition-colors cursor-pointer ${showGraphDot
                    ? "border-electric-blue/30 text-electric-blue hover:bg-electric-blue/10"
                    : "border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300"
                    }`}
                >
                  <CircleDot className="h-3.5 w-3.5" />
                </button>
              )}
              <Button
                variant="outline"
                className="h-8 px-3 text-sm border-electric-blue/30 text-electric-blue hover:text-white hover:bg-electric-blue/10"
                onClick={() => setIsExportOpen(true)}
              >
                <Download className="h-3.5 w-3.5 mr-1.5" /> Export Recipe
              </Button>
              <div className="relative" ref={moreToolsContainerRef}>
                <Button
                  ref={moreToolsTriggerRef}
                  variant="outline"
                  className="h-8 px-2.5 text-sm border-slate-700 text-slate-300 hover:border-slate-500"
                  aria-expanded={moreToolsOpen}
                  aria-haspopup="menu"
                  onClick={() => setMoreToolsOpen((open) => !open)}
                >
                  <MoreHorizontal className="h-3.5 w-3.5 mr-1" /> More
                </Button>
                {moreToolsOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 z-20 mt-1 min-w-[180px] rounded-lg border border-slate-800 bg-slate-950 p-1 shadow-xl"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-slate-300 hover:bg-slate-900 cursor-pointer"
                      onClick={() => {
                        setIsHistoryOpen(true);
                        setMoreToolsOpen(false);
                      }}
                    >
                      <History className="h-3 w-3" /> Run History
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-slate-300 hover:bg-slate-900 cursor-pointer"
                      onClick={() => {
                        void getJobHistory()
                          .then((records) => downloadMarkdownReport(records))
                          .catch((err: unknown) => {
                            console.error(
                              "Failed to export Markdown report:",
                              err instanceof Error ? err.message : err,
                            );
                          });
                        setMoreToolsOpen(false);
                      }}
                    >
                      <FileText className="h-3 w-3" /> Export Report
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-slate-300 hover:bg-slate-900 cursor-pointer"
                      onClick={() => {
                        setIsOwrExportOpen(true);
                        setMoreToolsOpen(false);
                      }}
                    >
                      <Globe className="h-3 w-3" /> Export for OWR
                    </button>
                  </div>
                )}
              </div>
            </div>
          }
        />
        {(["graph", "json"] as const).map((view) => {
          if (!visitedRecipeViews.has(view)) return null;
          const isActive = recipeView === view;
          return (
            <CardContent
              key={view}
              className={cn(
                "flex-1 overflow-hidden p-0",
                view === "graph" ? "min-h-[560px]" : "min-h-[420px]",
                isActive ? "block" : "hidden",
              )}
            >
              {view === "graph" && (
                <Suspense fallback={<LoadingFallback label="Loading graph editor..." minH="560px" />}>
                  <RecipeGraphView state={state} setState={setState} showDot={showGraphDot} />
                </Suspense>
              )}
              {view === "json" && (
                <div className="overflow-auto bg-slate-950 p-4 m-6 mt-0 rounded-lg border border-slate-800 min-h-[360px]">
                  <pre className="text-sm font-mono text-emerald-400">{JSON.stringify(recipe, null, 2)}</pre>
                </div>
              )}
            </CardContent>
          );
        })}
      </Card>

      {/* Active Draft — execution controls + live log in one card */}
      <Card className="border-slate-800 bg-slate-900/40">
        <CardHeader
          title="Active Draft"
          description={
            executionStatus === "running"
              ? "Olive is running. Streaming optimization logs."
              : executionStatus === "completed"
                ? `Run completed (exit 0)`
                : executionStatus === "failed"
                  ? `Run failed (exit ${executionExitCode ?? "?"})`
                  : "Review recipe above, then execute live or add to batch queue."
          }
          badge={
            <div className="flex items-center gap-2 flex-wrap">
              {executionStatus === "running" && (
                <span className="flex items-center gap-1.5 text-sm font-mono bg-electric-blue/10 text-electric-blue border border-electric-blue/30 px-2.5 py-1 rounded">
                  <RefreshCw className="h-3 w-3 animate-spin" /> Running
                </span>
              )}
              {executionStatus === "completed" && (
                <>
                  <span className="flex items-center gap-1.5 text-sm font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded">
                    <CheckCircle2 className="h-3 w-3" /> Done
                  </span>
                  <Button
                    variant="outline"
                    className="h-8 px-2.5 text-sm border-electric-blue/40 text-electric-blue hover:bg-electric-blue/10"
                    onClick={() => {
                      setPlaygroundSubView("browser-test");
                      navigatePipeline("playground");
                    }}
                  >
                    Test in Playground →
                  </Button>
                </>
              )}
              {executionStatus === "failed" && (
                <span className="flex items-center gap-1.5 text-sm font-mono bg-red-500/10 text-red-400 border border-red-500/30 px-2.5 py-1 rounded">
                  <AlertCircle className="h-3 w-3" /> Failed
                </span>
              )}
              <Button
                variant="ghost"
                className="h-8 px-2.5 text-sm text-slate-400 hover:text-electric-blue"
                onClick={() => onOpenAiAudit?.()}
              >
                Review with Assistant
              </Button>
            </div>
          }
        />
        <CardContent className="flex flex-col gap-4 p-4">
          <VramEstimateBanner state={state} compact />
          {schemaErrors.length > 0 && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-950/20 p-3 space-y-2">
              {schemaErrors.map((error) => (
                <div key={error} className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-rose-200 leading-relaxed">{error}</p>
                </div>
              ))}
            </div>
          )}
          {advisories.length > 0 && (
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2">
              {advisories.map((issue) => (
                <div key={issue.id} className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-amber-300">{issue.title}</p>
                    <p className="text-xs text-slate-400 leading-relaxed">{issue.description}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-between items-center gap-3 flex-wrap sm:flex-nowrap">
            <div className="flex items-center gap-2">
              {validationTone === "success" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : validationTone === "warning" ? (
                <AlertTriangle className="h-4 w-4 text-amber-400" />
              ) : (
                <AlertCircle className="h-4 w-4 text-rose-400" />
              )}
              <span
                className={`text-sm sm:text-sm font-medium ${validationTone === "success"
                  ? "text-emerald-400"
                  : validationTone === "warning"
                    ? "text-amber-300"
                    : "text-rose-300"
                  }`}
              >
                {validationLabel}
              </span>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              {isRunning && (
                <Button
                  variant="outline"
                  onClick={handleCancelJob}
                  className="h-9 px-3 text-sm border-rose-500/40 text-rose-400 hover:bg-rose-500/10 hover:border-rose-500 cursor-pointer"
                >
                  <Square className="h-3.5 w-3.5 mr-1.5 fill-rose-400 text-rose-400" /> Cancel Run
                </Button>
              )}
              {justQueued ? (
                <span className="text-sm text-electric-blue font-semibold font-mono mr-2">Queued</span>
              ) : (
                <Button
                  variant="outline"
                  className="h-9 px-3 text-sm border-dashed border-slate-700 hover:border-electric-blue hover:text-electric-blue disabled:opacity-40"
                  onClick={handleQueueJob}
                  disabled={!isRunnable}
                >
                  + Queue
                </Button>
              )}
              <Button
                variant="success"
                onClick={handleExecuteLive}
                disabled={isRunning || !isRunnable}
                className="h-9 text-sm"
              >
                {isRunning ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Olive running...
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5 mr-1.5" fill="currentColor" /> Execute Live
                  </>
                )}
              </Button>
            </div>
          </div>
          {/* GPU metrics live bar */}
          {isRunning && gpuMetrics && <GpuMetricsBar metrics={gpuMetrics} />}
          {/* Log panel with selection, manual diagnosis, and history sidebar */}
          <div className="flex gap-0 rounded-md border border-slate-800 overflow-hidden">
            <div className="flex-1 space-y-1.5 min-w-0">
              {executionLogs.length > 0 && (
                <div className="flex items-center justify-between gap-2 px-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 font-mono">
                      {selectedLogIndices.size > 0
                        ? `${selectedLogIndices.size} line${selectedLogIndices.size > 1 ? "s" : ""} selected`
                        : `${executionLogs.length} lines`}
                    </span>
                    <span className="text-xs text-slate-400 hidden sm:inline">
                      Click to select · Shift+click for range · Ctrl/Cmd+click for multi
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleDiagnose}
                      disabled={isDiagnosing || executionLogs.length === 0}
                      title={
                        selectedLogIndices.size > 0
                          ? `Diagnose ${selectedLogIndices.size} selected line(s)`
                          : "Diagnose full log (error lines are auto-selected on failure)"
                      }
                      className="flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded border border-electric-blue/30 bg-electric-blue/10 text-electric-blue hover:bg-electric-blue/20 hover:border-electric-blue/50 transition-all cursor-pointer disabled:opacity-50"
                    >
                      <Wrench className="h-3 w-3" />{" "}
                      {selectedLogIndices.size > 0 ? `Diagnose (${selectedLogIndices.size})` : "Diagnose"}
                    </button>
                    {executionStatus === "failed" && (
                      <button
                        type="button"
                        onClick={() => {
                          setReportArea("execution-batch");
                          setReportDescription(
                            `Execution failed with exit code ${executionExitCode ?? "?"}.\n\nRecent logs:\n${executionLogs.slice(-20).join("\n")}`,
                          );
                          setIsReportOpen(true);
                        }}
                        title="Report this failure as a GitHub issue"
                        className="flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded border border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 hover:border-amber-500/50 transition-all cursor-pointer"
                      >
                        <Bug className="h-3 w-3" /> Report
                      </button>
                    )}
                    {executionStatus === "failed" &&
                      state.ihvProvider === "QNNExecutionProvider" &&
                      qnnExplicitRetryProviders().map((provider) => (
                        <button
                          key={provider}
                          type="button"
                          onClick={() => {
                            const patch = prepareProviderChange(state, provider, hardwareProbe, {
                              skipHardwareBlock: true,
                            });
                            setState(patch ?? { ihvProvider: provider });
                            setExecutionLogs((prev) => [
                              ...prev,
                              `[INFO] Switched target to ${provider} (explicit retry, QNN does not auto-fallback). Rebuild/refresh the recipe, then Execute Live again.`,
                            ]);
                          }}
                          title={`Explicit retry with ${provider} (no automatic EP fallback)`}
                          className="flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded border border-slate-600/50 bg-slate-800/60 text-slate-300 hover:bg-slate-700/60 transition-all cursor-pointer"
                        >
                          Retry with {provider === "DmlExecutionProvider" ? "DirectML" : "CPU"}
                        </button>
                      ))}
                  </div>
                </div>
              )}
              <div
                data-testid="execution-log-panel"
                className="bg-slate-950 border border-slate-800 rounded-md p-4 font-mono text-sm text-emerald-400 space-y-0.5 h-[220px] overflow-y-auto"
              >
                {executionLogs.length === 0 ? (
                  <p className="text-slate-500 italic">
                    Ready. Click &quot;Execute Live&quot; to begin an Olive optimization run.
                  </p>
                ) : (
                  executionLogs.map((line, i) => {
                    const isSelected = selectedLogIndices.has(i);
                    const lineClass = line.includes("[ERROR]")
                      ? "text-red-400"
                      : line.includes("[WARN]")
                        ? "text-amber-300"
                        : line.includes("[SETUP]")
                          ? "text-amber-400"
                          : line.includes("[DONE]") || line.includes("[info] Job cancelled")
                            ? "text-emerald-300 font-bold"
                            : "text-emerald-400";
                    return (
                      <p
                        key={i}
                        onClick={(e) => handleLogLineClick(i, e)}
                        className={`${lineClass} cursor-pointer rounded px-1 -mx-1 transition-colors ${isSelected
                          ? "bg-electric-blue/15 ring-1 ring-electric-blue/30"
                          : "hover:bg-slate-800/50"
                          }`}
                      >
                        {line}
                      </p>
                    );
                  })
                )}
              </div>
            </div>

            {/* Diagnosis history sidebar */}
            <DiagnosisHistory
              entries={diagnosisHistory}
              activeIndex={activeHistoryIndex}
              onSelect={handleSelectHistory}
              onClear={handleClearHistory}
            />
          </div>

          {/* MCP Diagnostic & Auto-Fix Card (matched_entry from MCP/local parsers enables thumbs) */}
          {executionStatus === "failed" && (
            <LazyMCPDiagnosticCard
              diagnostic={displayedDiagnostic}
              isDiagnosing={isDiagnosing}
              fixApplied={displayedFixApplied}
              onApplyFix={handleApplyMcpFix}
              onRunDiagnosis={handleDiagnose}
              error={diagnoseError}
              onFeedbackSubmitted={handleFeedbackSubmitted}
            />
          )}
        </CardContent>
      </Card>

      {/* History & Side-by-Side Comparison Modal */}
      <JobHistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        onSelectRecipe={(recipeJsonStr) => {
          try {
            const parsed = JSON.parse(recipeJsonStr);
            // Optionally update UI state if needed
            setExecutionLogs([
              `[INFO] Loaded recipe from history (${parsed.input_model?.type || "Olive recipe"})`,
            ]);
          } catch {
            /* ignore */
          }
        }}
      />

      {/* Report Issue Modal */}
      <ReportIssueModal
        open={isReportOpen}
        onClose={() => {
          setIsReportOpen(false);
          setReportArea(undefined);
          setReportDescription("");
        }}
        state={state}
        hardwareProbe={hardwareProbe}
        executionLogs={executionLogs}
        mcpDiagnostic={mcpDiagnostic}
        defaultArea={reportArea}
        defaultDescription={reportDescription}
      />
    </div>
  );
}
