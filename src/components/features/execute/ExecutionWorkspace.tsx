import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useDeferredValue,
  useCallback,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { type UIState } from "@/types";
import { usePipelineState } from "@/lib/stores/pipelineStore";
import { useAutoClearError } from "@/lib/hooks/useAutoClearError";
import { useOliveStream } from "./useOliveStream";
import { useRecipeView } from "./useRecipeView";
import { useOwrExport } from "./useOwrExport";
import { useDiagnosis } from "./useDiagnosis";
import { buildQueuedBatchJob } from "./executionJobUtils";
import { currentTimestamp, generateEntryId } from "@/lib/activityLog";
import { navigatePipeline } from "@/lib/pipelineNavigation";
import { usePlaygroundStore } from "@/lib/stores/playgroundStore";
import { isFailureLine } from "@/lib/logFailurePatterns";
import { LazyMCPDiagnosticCard } from "./LazyMCPDiagnosticCard";
import { useAgentMode } from "./useAgentMode";
import { useAgentStream } from "./useAgentStream";
import { AgentModeSection } from "./AgentModeSection";
import { RecipePreviewCard } from "./RecipePreviewCard";
import { ExportRecipeOverlay } from "./ExportRecipeOverlay";
import { ExecutionLogPanel } from "./ExecutionLogPanel";
import { ManualExecutionControls } from "./ManualExecutionControls";

import { buildRecipeFromState } from "@/lib/recipePipeline";
import { useHardwareProbe } from "@/lib/hooks/useHardwareProbe";
import { prepareProviderChange } from "@/lib/pipelineValidation";

import { getJobHistory, type JobHistoryRecord } from "@/lib/jobHistoryStore";
import { JobHistoryModal } from "@/components/features/execute/JobHistoryModal";
import { ReportIssueModal } from "@/components/ReportIssueModal";
import { OwrExportOverlay } from "./OwrExportOverlay";
import type { ReportArea } from "@/lib/issueReport";

type ExecutionStatus = "idle" | "running" | "completed" | "failed" | "cancelled";

/**
 * Provides a workspace for reviewing, validating, exporting, queuing, and executing an Olive pipeline.
 *
 * Thin orchestrator: pipeline/recipe derivation, live execution streaming,
 * diagnosis, recipe-view/export, OWR export, and agent-mode are delegated to
 * colocated hooks; presentational sections live in colocated components.
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

  const { data: hardwareProbe = null } = useHardwareProbe();
  const pipeline = buildRecipeFromState(deferredState, { hardwareProbe });
  const { recipe, validation, schema, advisories, isRunnable } = pipeline;
  const schemaErrors = schema.errors ?? [];

  const isUnmountedRef = useRef(false);
  useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
    };
  }, []);

  // Live execution streaming lifecycle (SSE) — managed by useOliveStream.
  const [mcpFixApplied, setMcpFixApplied] = useAutoClearError(3000);
  const {
    liveJobId,
    isRunning,
    executionLogs,
    setExecutionLogs,
    executionStatus,
    executionExitCode,
    gpuMetrics,
    handleExecuteLive,
    handleCancelJob,
    runRecipeJsonRef,
  } = useOliveStream({
    state,
    hardwareProbe,
    setState,
    onRunStateChange,
    isUnmountedRef,
    setMcpFixApplied,
  });

  // Log line selection for manual diagnosis.
  const [selectedLogIndices, setSelectedLogIndices] = useState<Set<number>>(new Set());
  const lastClickedIndexRef = useRef<number | null>(null);
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

  // Clear log selection once when a new live run starts (not on every streamed line).
  useLayoutEffect(() => {
    setSelectedLogIndices(new Set()); // eslint-disable-line react-hooks/set-state-in-effect
    lastClickedIndexRef.current = null;
  }, [liveJobId]);

  // Auto-select error lines when a job fails so Diagnose can focus on them.
  const prevStatusRef = useRef<ExecutionStatus | null>(null);
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

  const diagnosis = useDiagnosis({
    state,
    setState,
    executionLogs,
    setExecutionLogs,
    executionStatus,
    selectedLogIndices,
    mcpFixApplied,
    setMcpFixApplied,
  });

  const recipeViewState = useRecipeView({ state });
  const owrExport = useOwrExport({ state });

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
  const validationTone: "success" | "warning" | "error" = runFailed
    ? "error"
    : localValidationTone;

  // Queue feedback + batch job creation.
  const [justQueued, setJustQueued] = useState(false);
  const justQueuedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  useEffect(() => {
    return () => {
      if (justQueuedTimerRef.current) clearTimeout(justQueuedTimerRef.current);
    };
  }, []);

  // Capture the submitted recipe when Execute completes so Playground uses the exact recipe that ran.
  const setCapturedRunRecipe = usePlaygroundStore((s) => s.setCapturedRunRecipe);
  useEffect(() => {
    if (executionStatus === "completed" && runRecipeJsonRef.current) {
      setCapturedRunRecipe(runRecipeJsonRef.current);
    }
  }, [executionStatus, setCapturedRunRecipe, runRecipeJsonRef]);

  // Report issue modal state.
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [reportArea, setReportArea] = useState<ReportArea | undefined>(undefined);
  const [reportTitle, setReportTitle] = useState("");
  const [reportDescription, setReportDescription] = useState("");

  // Job history modal state.
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // ─── Agent Mode State ────────────────────────────────────────────────────────
  const {
    mode: agentMode,
    agentRunning,
    entries: agentEntries,
    outcome: agentOutcome,
    startedAt: agentStartedAt,
    setMode: setAgentMode,
    startAgent,
    jobId: agentJobId,
    stopAgent,
    appendEntry: appendAgentEntry,
    confirmStart,
    completeAgent,
  } = useAgentMode();

  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);

  const handleStartAgent = useCallback(() => {
    startAgent();
  }, [startAgent]);

  // SSE stream for agent activity
  const handleAgentStreamEntry = useCallback(
    (entry: Parameters<typeof appendAgentEntry>[0]) => {
      // Confirm start on first entry received (clears 10s timeout)
      confirmStart();
      appendAgentEntry(entry);
    },
    [appendAgentEntry, confirmStart],
  );

  const handleAgentStreamError = useCallback(
    (errorMsg: string) => {
      // totalSteps: 0 — completeAgent() takes Math.max() against its own
      // stepCountRef, which counts only entries with stepRef set. Passing
      // agentEntries.length here would overcount (every log/metrics/error
      // entry, not just steps) and win the max.
      completeAgent({
        status: "failure",
        totalSteps: 0,
        elapsedMs: agentStartedAt ? Date.now() - new Date(agentStartedAt).getTime() : 0,
        errorDescription: errorMsg,
      });
    },
    [completeAgent, agentStartedAt],
  );

  const handleAgentStreamComplete = useCallback((streamStatus: "completed" | "failed" | "cancelled") => {
    completeAgent({
      status: streamStatus === "completed" ? "success" : streamStatus === "failed" ? "failure" : "cancelled",
      totalSteps: 0,
      elapsedMs: agentStartedAt ? Date.now() - new Date(agentStartedAt).getTime() : 0,
    });
  }, [completeAgent, agentStartedAt]);

  useAgentStream({
    enabled: agentRunning,
    jobId: agentJobId,
    onEntry: handleAgentStreamEntry,
    onError: handleAgentStreamError,
    onComplete: handleAgentStreamComplete,
  });

  /** Handle tab switches — prompt if agent is actively running. */
  const handleModeChange = useCallback(
    (newMode: "manual" | "agent") => {
      if (newMode === agentMode) return;
      if (agentMode === "agent" && agentRunning) {
        setConfirmDialogOpen(true);
        return;
      }
      setAgentMode(newMode);
    },
    [agentMode, agentRunning, setAgentMode],
  );

  const handleAgentStop = useCallback(async () => {
    const stopped = await stopAgent();
    if (!stopped) {
      // stopAgent() intentionally leaves agentRunning true on a failed cancel
      // (so Stop can be retried) — surface the failure in the log instead of
      // silently doing nothing.
      appendAgentEntry({
        id: generateEntryId(),
        kind: "error",
        timestamp: currentTimestamp(),
        text: "Failed to cancel agent — Stop again to retry.",
      });
    }
  }, [stopAgent, appendAgentEntry]);

  /** User confirmed stopping the agent and switching to manual. */
  const handleConfirmStopAndSwitch = useCallback(() => {
    void (async () => {
      if (agentRunning) {
        const cancelled = await stopAgent();
        if (!cancelled) {
          setConfirmDialogOpen(false);
          return;
        }
      }
      setAgentMode("manual");
      setConfirmDialogOpen(false);
    })();
  }, [agentRunning, stopAgent, setAgentMode]);

  /** User cancelled the confirmation dialog — stay in agent mode. */
  const handleCancelDialog = useCallback(() => {
    setConfirmDialogOpen(false);
  }, []);

  const handleRetryProvider = useCallback(
    (provider: UIState["ihvProvider"]) => {
      const patch = prepareProviderChange(state, provider, hardwareProbe, {
        skipHardwareBlock: true,
      });
      setState(patch ?? { ihvProvider: provider });
      setExecutionLogs((prev) => [
        ...prev,
        `[INFO] Switched target to ${provider} (explicit retry, QNN does not auto-fallback). Rebuild/refresh the recipe, then Execute Live again.`,
      ]);
    },
    [state, hardwareProbe, setState, setExecutionLogs],
  );

  const [exportRecords, setExportRecords] = useState<JobHistoryRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    getJobHistory()
      .then((records) => {
        if (!cancelled) setExportRecords(records);
      })
      .catch(() => {
        if (!cancelled) setExportRecords([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      data-testid="execution-workspace"
      className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-2 duration-300 relative"
    >
      <AgentModeSection
        agentMode={agentMode}
        onModeChange={handleModeChange}
        isRunning={isRunning}
        records={exportRecords}
        confirmDialogOpen={confirmDialogOpen}
        onConfirmDialog={handleConfirmStopAndSwitch}
        onCancelDialog={handleCancelDialog}
        agentRunning={agentRunning}
        onStartAgent={handleStartAgent}
        onStopAgent={handleAgentStop}
        outcome={agentOutcome}
        entries={agentEntries}
      />

      {/* Manual Mode Controls — hidden when in Agent mode */}
      {agentMode === "manual" && <>
        {/* Export Recipe Overlay */}
        {recipeViewState.isExportOpen && (
          <ExportRecipeOverlay
            open={recipeViewState.isExportOpen}
            onClose={() => recipeViewState.setIsExportOpen(false)}
            recipe={recipe}
            isCopied={recipeViewState.isExportCopied}
            onCopy={recipeViewState.handleExportCopy}
            onDownload={recipeViewState.handleExportDownload}
          />
        )}

        {/* OWR Export Bundle Overlay */}
        <OwrExportOverlay
          open={owrExport.isOwrExportOpen}
          onClose={() => owrExport.setIsOwrExportOpen(false)}
          configs={owrExport.owrConfigs}
          platform={owrExport.owrPlatform}
          onPlatformChange={owrExport.setOwrPlatform}
          selectedFile={owrExport.owrSelectedFile}
          onFileSelect={owrExport.setOwrSelectedFile}
          threads={owrExport.owrThreads}
          onThreadsChange={owrExport.setOwrThreads}
          vramMode={owrExport.owrVramMode}
          onVramModeChange={owrExport.setOwrVramMode}
          onDownloadBundle={owrExport.handleDownloadOwrBundle}
          isDownloading={owrExport.isOwrDownloading}
          downloadError={owrExport.owrDownloadError}
        />

        {/* Recipe Preview */}
        <RecipePreviewCard
          recipe={recipe}
          state={state}
          setState={setState}
          recipeView={recipeViewState.recipeView}
          setRecipeView={recipeViewState.setRecipeView}
          visitedRecipeViews={recipeViewState.visitedRecipeViews}
          onExportRecipe={() => recipeViewState.setIsExportOpen(true)}
          moreToolsOpen={recipeViewState.moreToolsOpen}
          setMoreToolsOpen={recipeViewState.setMoreToolsOpen}
          moreToolsContainerRef={recipeViewState.moreToolsContainerRef}
          moreToolsTriggerRef={recipeViewState.moreToolsTriggerRef}
          onOpenHistory={() => setIsHistoryOpen(true)}
          onOpenOwrExport={() => owrExport.setIsOwrExportOpen(true)}
        />

        {/* Active Draft — execution controls + live log in one card */}
        <ManualExecutionControls
          state={state}
          executionStatus={executionStatus}
          executionExitCode={executionExitCode}
          isRunning={isRunning}
          validationLabel={validationLabel}
          validationTone={validationTone}
          schemaErrors={schemaErrors}
          advisories={advisories}
          isRunnable={isRunnable}
          justQueued={justQueued}
          gpuMetrics={gpuMetrics}
          onQueueJob={handleQueueJob}
          onExecuteLive={handleExecuteLive}
          onCancelJob={handleCancelJob}
          onOpenAiAudit={onOpenAiAudit}
          onTestInPlayground={() => {
            setPlaygroundSubView("browser-test");
            navigatePipeline("playground");
          }}
        >
          <ExecutionLogPanel
            executionLogs={executionLogs}
            executionStatus={executionStatus}
            selectedLogIndices={selectedLogIndices}
            handleLogLineClick={handleLogLineClick}
            isDiagnosing={diagnosis.isDiagnosing}
            handleDiagnose={diagnosis.handleDiagnose}
            showQnnRetry={
              executionStatus === "failed" && state.ihvProvider === "QNNExecutionProvider"
            }
            onRetryProvider={handleRetryProvider}
            onSendFeedback={() => {
              setReportArea("execution-batch");
              setReportTitle(`Execution failed (exit code ${executionExitCode ?? "?"})`);
              setReportDescription(
                `Execution failed with exit code ${executionExitCode ?? "?"}.\n\nRecent logs:\n${executionLogs.slice(-20).join("\n")}`,
              );
              setIsReportOpen(true);
            }}
            diagnosisHistory={diagnosis.diagnosisHistory}
            activeHistoryIndex={diagnosis.activeHistoryIndex}
            onSelectHistory={diagnosis.handleSelectHistory}
            onClearHistory={diagnosis.handleClearHistory}
          />

          {/* MCP Diagnostic & Auto-Fix Card (matched_entry from MCP/local parsers enables thumbs) */}
          {executionStatus === "failed" && (
            <LazyMCPDiagnosticCard
              diagnostic={diagnosis.displayedDiagnostic}
              isDiagnosing={diagnosis.isDiagnosing}
              fixApplied={diagnosis.displayedFixApplied}
              onApplyFix={diagnosis.handleApplyMcpFix}
              onRunDiagnosis={diagnosis.handleDiagnose}
              error={diagnosis.diagnoseError}
              onFeedbackSubmitted={diagnosis.handleFeedbackSubmitted}
            />
          )}
        </ManualExecutionControls>
      </>}

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
          setReportTitle("");
          setReportDescription("");
        }}
        state={state}
        hardwareProbe={hardwareProbe}
        executionLogs={executionLogs}
        mcpDiagnostic={diagnosis.mcpDiagnostic}
        defaultArea={reportArea}
        defaultTitle={reportTitle}
        defaultDescription={reportDescription}
      />
    </div>
  );
}
