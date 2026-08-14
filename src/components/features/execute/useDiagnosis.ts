import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { type UIState, type McpTroubleshootFeedbackRating } from "@/types";
import { useMcpDiagnosticKeyed } from "@/lib/hooks/useMcpDiagnostic";
import { applyMcpDiagnosticToUiState, canApplyMcpDiagnostic } from "@/lib/mcpConfigMapping";
import { isStudioHfTaskSpeechFix, isFailureLine, expandLogSelection } from "@/lib/logFailurePatterns";
import { describeAppliedMcpPatches } from "./executionJobUtils";
import { type DiagnosisEntry } from "./DiagnosisHistory";

export interface UseDiagnosisOptions {
  state: UIState;
  setState: (s: Partial<UIState>) => void;
  executionLogs: string[];
  setExecutionLogs: Dispatch<SetStateAction<string[]>>;
  executionStatus: "idle" | "running" | "completed" | "failed" | "cancelled";
  selectedLogIndices: Set<number>;
  mcpFixApplied: string;
  setMcpFixApplied: (value: string) => void;
}

export interface UseDiagnosisReturn {
  diagnosisHistory: DiagnosisEntry[];
  activeHistoryIndex: number;
  mcpDiagnostic: ReturnType<typeof useMcpDiagnosticKeyed>["diagnostics"]["current"] | null;
  isDiagnosing: boolean;
  diagnoseError: string | null;
  viewingHistoricalDiagnosis: boolean;
  displayedDiagnostic: ReturnType<typeof useMcpDiagnosticKeyed>["diagnostics"]["current"] | null;
  displayedFixApplied: string;
  handleDiagnose: () => void;
  handleApplyMcpFix: () => void;
  handleSelectHistory: (index: number) => void;
  handleClearHistory: () => void;
  handleFeedbackSubmitted: (payload: {
    matched_entry: string;
    rating: McpTroubleshootFeedbackRating;
  }) => void;
}

/**
 * Manages the MCP diagnostic lifecycle: keyed diagnostics, manual and
 * auto-diagnose, apply-fix mapping, and diagnosis history.
 */
export function useDiagnosis({
  state,
  setState,
  executionLogs,
  setExecutionLogs,
  executionStatus,
  selectedLogIndices,
  mcpFixApplied,
  setMcpFixApplied,
}: UseDiagnosisOptions): UseDiagnosisReturn {
  const {
    fetchKeyedDiagnostic,
    diagnostics: keyedDiagnostics,
    diagnosingKeys,
    errors: diagnoseErrors,
  } = useMcpDiagnosticKeyed();
  const mcpDiagnostic = keyedDiagnostics["current"] ?? null;
  const isDiagnosing = diagnosingKeys?.["current"] ?? false;
  const diagnoseError = diagnoseErrors?.["current"] ?? null;

  const [diagnosisHistory, setDiagnosisHistory] = useState<DiagnosisEntry[]>([]);
  const [activeHistoryIndex, setActiveHistoryIndex] = useState(-1);

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

  return {
    diagnosisHistory,
    activeHistoryIndex,
    mcpDiagnostic,
    isDiagnosing,
    diagnoseError,
    viewingHistoricalDiagnosis,
    displayedDiagnostic,
    displayedFixApplied,
    handleDiagnose,
    handleApplyMcpFix,
    handleSelectHistory,
    handleClearHistory,
    handleFeedbackSubmitted,
  };
}
