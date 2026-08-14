import { useEffect, useState, useCallback, useRef } from "react";
import { getPipelineValidation, applyIssueAutofix, hasSelectedModel, type PipelineIssue } from "@/lib/pipelineValidation";
import { validatePassParameters } from "@/lib/passParameterValidation";
import { validateMcpParams, clearParamCache, type McpParamWarning } from "@/lib/mcpParamValidation";
import { useMcpDiagnostic } from "@/lib/hooks/useMcpDiagnostic";
import { useHardwareProbe } from "@/lib/hooks/useHardwareProbe";
import { OLIVE_EXPAND_VALIDATION, OLIVE_EMPHASIZE_VALIDATION, takePendingExpandValidation, takePendingEmphasizeValidation } from "@/lib/pipelineNavigation";
import { buildPipelineSteps } from "./graphLayout";
import { UIState, type IHVProvider } from "@/types";
import { AlertTriangle, CheckCircle, ChevronDown, ChevronRight, Info, RefreshCw, Zap } from "lucide-react";

interface CompatibilityWarning {
  pass_name: string;
  note: string;
  typical_accuracy_drop: string;
}

interface PassCompat {
  support: string;
  note: string;
  typical_accuracy_drop: string;
}

interface CompatibilityResult {
  model?: string;
  framework?: string;
  framework_supported?: boolean;
  hardware_profiles?: Record<string, Record<string, PassCompat>>;
  selected_hardware?: string;
  hardware_compatibility?: Record<string, PassCompat>;
  compatibility_warnings?: CompatibilityWarning[];
  note?: string;
  hardware_note?: string;
}

interface RecipeValidationPanelProps {
  state: UIState;
  setState: (s: Partial<UIState>) => void;
}

function getHardwareTargetFromProvider(provider: IHVProvider): string {
  switch (provider) {
    case "CUDAExecutionProvider":
    case "TensorrtExecutionProvider":
    case "NvTensorRTRTXExecutionProvider":
      return "NVIDIA RTX 4090";
    case "DmlExecutionProvider":
      return "Windows DirectML GPU";
    case "OpenVINOExecutionProvider":
    case "CPUExecutionProvider":
      return "Intel Core i9 CPU";
    case "QNNExecutionProvider":
      return "Qualcomm Snapdragon NPU";
    case "ROCMExecutionProvider":
      return "AMD MI300X / ROCm";
    case "WebGpuExecutionProvider":
      return "WebGPU (Browser)";
    case "CoreMLExecutionProvider":
      return "Apple M2/M3 (CoreML)";
    case "NNAPIExecutionProvider":
      return "Android NNAPI";
    case "VitisAIExecutionProvider":
      return "Xilinx Vitis AI DPU";
    case "SNPEExecutionProvider":
      return "Qualcomm SNPE (Legacy)";
    case "TensorflowLiteExecutionProvider":
      return "TensorFlow Lite Export";
    case "XnnpackExecutionProvider":
      return "XNNPACK (Mobile)";
    case "WasmExecutionProvider":
      return "WASM (Browser)";
    case "QnnAbiExecutionProvider":
      return "QNN ABI";
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}

/**
 * Renders validation results and compatibility diagnostics for a recipe.
 *
 * @param state - The current recipe configuration to validate
 * @param setState - Updates the recipe configuration when an issue autofix is applied
 */
export function RecipeValidationPanel({ state, setState }: RecipeValidationPanelProps) {
  const [compatResult, setCompatResult] = useState<CompatibilityResult | null>(null);
  const [compatLoading, setCompatLoading] = useState(false);
  const [compatError, setCompatError] = useState<string | null>(null);
  const [compatValidated, setCompatValidated] = useState(false);
  const [mcpParamWarnings, setMcpParamWarnings] = useState<McpParamWarning[]>([]);
  const [mcpParamLoading, setMcpParamLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [emphasized, setEmphasized] = useState(false);
  const [showCompatDetails, setShowCompatDetails] = useState(false);

  useEffect(() => {
    const handleExpand = () => {
      takePendingExpandValidation();
      setExpanded(true);
    };
    window.addEventListener(OLIVE_EXPAND_VALIDATION, handleExpand);
    // Catch expand requests that fired before this listener registered
    // (common when Resolve Issues races a lazy Execute mount).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- flush module-level pending flag from before mount
    if (takePendingExpandValidation()) setExpanded(true);
    return () => window.removeEventListener(OLIVE_EXPAND_VALIDATION, handleExpand);
  }, []);

  useEffect(() => {
    let emphasizeTimer: number | undefined;
    const handleEmphasize = () => {
      takePendingEmphasizeValidation();
      if (emphasizeTimer !== undefined) window.clearTimeout(emphasizeTimer);
      setEmphasized(true);
      emphasizeTimer = window.setTimeout(() => setEmphasized(false), 1200);
    };
    window.addEventListener(OLIVE_EMPHASIZE_VALIDATION, handleEmphasize);
    if (takePendingEmphasizeValidation()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- flush module-level pending flag from before mount
      setEmphasized(true);
      emphasizeTimer = window.setTimeout(() => setEmphasized(false), 1200);
    }
    return () => {
      window.removeEventListener(OLIVE_EMPHASIZE_VALIDATION, handleEmphasize);
      if (emphasizeTimer !== undefined) window.clearTimeout(emphasizeTimer);
    };
  }, []);
  const [refreshKey, setRefreshKey] = useState(0);
  const forceRefreshRef = useRef(false);
  const { diagnostic: mcpDiagnostic, isDiagnosing: mcpDiagnosing, fetchDiagnostic, clearDiagnostic } = useMcpDiagnostic();
  const { data: hardwareProbe } = useHardwareProbe();

  const validation = getPipelineValidation(state, { forLocalExecution: true, hardwareProbe: hardwareProbe ?? null });
  // Pass-parameter advisories (quant method preferences, precision tips, etc.) are all
  // about tuning a model that doesn't exist yet — showing them next to "No model
  // selected" reads as a wall of unrelated noise around the one thing to actually fix.
  const modelSelected = hasSelectedModel(state);
  const pipelineSteps = buildPipelineSteps(state.passes);
  const activePassNames = pipelineSteps
    .filter((s) => s.active && s.id !== "input" && s.id !== "output" && s.id !== "provider")
    .map((s) => s.id);

  // Reuse the pre-built recipe from validation to avoid redundant builds
  const recipe = validation.recipe;

  // Call MCP server for model-hardware compatibility check
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    const forceRun = forceRefreshRef.current;
    forceRefreshRef.current = false;

    const timer = setTimeout(
      async () => {
        // Determine model name and framework from UIState
        const modelName = state.hfModelId || (state.localFiles.length > 0 ? state.localFiles[0].name : "");
        const framework = state.passes.conversionSourceFormat === "pytorch" ? "PyTorch" : "ONNX";
        const hardwareTarget = getHardwareTargetFromProvider(state.ihvProvider);

        if (!modelName) {
          if (!cancelled) {
            setCompatResult(null);
            setCompatError(null);
            setCompatLoading(false);
            setCompatValidated(true);
          }
          return;
        }

        setCompatLoading(true);
        setCompatError(null);

        try {
          const res = await fetch("/api/validate-compatibility", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ modelName, framework, hardwareTarget }),
            signal: controller.signal,
          });

          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || `HTTP ${res.status}`);
          }

          const result = await res.json();
          if (!cancelled) {
            setCompatResult(result);
            setCompatValidated(true);
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          if (!cancelled) {
            setCompatError(err instanceof Error ? err.message : "Compatibility check failed");
            setCompatResult(null);
            setCompatValidated(true);
          }
        } finally {
          if (!cancelled) setCompatLoading(false);
        }
      },
      forceRun ? 0 : 600,
    );

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [state.hfModelId, state.localFiles, state.passes.conversionSourceFormat, state.ihvProvider, refreshKey]);

  const handleApplyAutofix = (issue: PipelineIssue, e?: React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    const patch = applyIssueAutofix(state, issue);
    if (!patch || Object.keys(patch).length === 0) return;
    setState(patch);
  };

  const handleRefreshValidation = useCallback(() => {
    clearParamCache();
    forceRefreshRef.current = true;
    setRefreshKey((k) => k + 1);
  }, []);

  // MCP parameter validation (async — validates required_params, valid_range, interactions)
  useEffect(() => {
    if (activePassNames.length === 0) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag for async fetch, safe
    setMcpParamLoading(true);
    validateMcpParams(state, activePassNames)
      .then((warnings) => {
        if (!cancelled) setMcpParamWarnings(warnings);
      })
      .catch(() => {
        if (!cancelled) setMcpParamWarnings([]);
      })
      .finally(() => {
        if (!cancelled) setMcpParamLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- activePassNames is derived from state.passes via buildPipelineSteps; join() stabilizes the reference
  }, [state.passes, activePassNames.join(","), refreshKey]);

  // MCP error diagnostics — auto-fetch when critical pipeline issues are detected
  const prevIssueCountRef = useRef(0);
  useEffect(() => {
    // Nothing to diagnose yet — "No model selected" isn't a runtime error pattern.
    // Reset ref and clear stale diagnostics when model is deselected.
    if (!modelSelected) {
      prevIssueCountRef.current = 0;
      clearDiagnostic();
      return;
    }
    const criticalIssues = validation.issues.filter((i) => i.severity === "critical");
    const count = criticalIssues.length;
    if (count === 0) {
      prevIssueCountRef.current = 0;
      return;
    }
    if (count === prevIssueCountRef.current) return;
    prevIssueCountRef.current = count;

    const logLines = criticalIssues.map((i) => `[VALIDATION] ${i.title}: ${i.description}`);
    void fetchDiagnostic(logLines).catch(() => {});
  }, [validation.issues, modelSelected, fetchDiagnostic, clearDiagnostic]);

  // Hardware-specific parameter validation (synchronous, cheap — runs every render with state)
  const paramWarnings = validatePassParameters(state, activePassNames, recipe);

  // Build compatibility warnings for active passes
  const compatWarnings = compatResult?.compatibility_warnings ?? [];
  const activePassWarnings = compatWarnings.filter((w) =>
    activePassNames.some(
      (n) =>
        n.toLowerCase().includes(w.pass_name.toLowerCase()) ||
        w.pass_name.toLowerCase().includes(n.toLowerCase()),
    ),
  );

  const allIssues = !modelSelected ? validation.issues : [
    ...validation.issues,
    ...activePassWarnings.map((w, i) => ({
      id: `compat-${i}-${w.pass_name}`,
      severity: "warning" as const,
      title: `${w.pass_name}: ${w.note}`,
      description: w.typical_accuracy_drop
        ? `Expected accuracy impact: ${w.typical_accuracy_drop}`
        : "Check compatibility matrix",
      source: "compatibility" as const,
    })),
    // Framework not supported warning
    ...(compatResult && compatResult.framework_supported === false
      ? [
        {
          id: "compat-framework-unsupported",
          severity: "warning" as const,
          title: `Framework '${compatResult.framework}' may not be fully supported for this model`,
          description: "Consider converting to ONNX first",
          source: "compatibility" as const,
        },
      ]
      : []),
    // Hardware-specific parameter warnings
    ...paramWarnings.map((w) => ({
      id: w.id,
      severity: w.severity as "warning" | "critical",
      title: w.title,
      description: w.description,
      source: "parameter" as const,
      actionLabel: w.actionLabel,
      autofix: w.autofix as PipelineIssue["autofix"],
    })),
    // MCP parameter constraint warnings (required_params, valid_range, interactions)
    ...mcpParamWarnings.map((w) => ({
      id: w.id,
      severity: w.severity as "warning" | "critical",
      title: w.title,
      description: w.description,
      source: "mcp-param" as const,
    })),
    // MCP error diagnostic — known error patterns from the troubleshooting knowledge base
    ...(mcpDiagnostic
      ? [
        {
          id: `mcp-diag-${mcpDiagnostic.matched_entry ?? "unknown"}`,
          severity: "critical" as const,
          title: `[MCP] ${mcpDiagnostic.title}`,
          description: `Root cause: ${mcpDiagnostic.root_cause}. Workaround: ${mcpDiagnostic.workaround}`,
          source: "mcp-diagnostic" as const,
        },
      ]
      : []),
    // MCP diagnostic loading indicator
    ...(mcpDiagnosing
      ? [
        {
          id: "mcp-diag-loading",
          severity: "warning" as const,
          title: "Querying MCP knowledge base for known solutions...",
          description: "Checking if this error pattern has a documented workaround.",
          source: "mcp-diagnostic" as const,
        },
      ]
      : []),
  ];

  const criticalCount = allIssues.filter((i) => i.severity === "critical").length;
  const warningCount = allIssues.filter((i) => i.severity === "warning").length;

  if (allIssues.length === 0 && !compatLoading && !compatError && compatValidated) {
    return (
      <div
        data-testid="recipe-validation-panel"
        className="rounded-lg border border-emerald-800/50 bg-emerald-950/20 px-3 py-1.5"
      >
        <div className="flex items-center gap-2 text-emerald-400">
          <CheckCircle className="h-4 w-4 shrink-0" />
          <span className="text-sm font-medium">Local checks passed. No issues found.</span>
        </div>
      </div>
    );
  }

  return (
    <div
      id="recipe-validation-panel"
      data-testid="recipe-validation-panel"
      className={`rounded-lg border border-slate-700 bg-slate-900/80 overflow-hidden transition-all duration-300 ease-out ${
        emphasized
          ? "ring-2 ring-sky-400 ring-offset-4 ring-offset-slate-950 bg-sky-400/15 border-sky-400 shadow-[0_0_24px_rgba(56,189,248,0.35)]"
          : ""
      }`}
    >
      {/* Header */}
      <div className="w-full flex items-center justify-between p-2 hover:bg-slate-800/50 transition-colors">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls="recipe-validation-issue-list"
          className="flex items-center gap-2 flex-1 min-w-0 text-left cursor-pointer"
        >
          {criticalCount > 0 ? (
            <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
          ) : warningCount > 0 ? (
            <Info className="h-4 w-4 text-amber-400 shrink-0" />
          ) : (
            <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
          )}
          <span className="text-sm font-medium text-slate-300">
            {criticalCount > 0
              ? `${criticalCount} blocking issue${criticalCount !== 1 ? "s" : ""}`
              : warningCount > 0
                ? `${warningCount} warning${warningCount !== 1 ? "s" : ""}`
                : "All checks passed"}
          </span>
          {compatLoading && (
            <span className="text-[11px] text-slate-500 animate-pulse">Checking compatibility...</span>
          )}
          {mcpParamLoading && (
            <span className="text-[11px] text-slate-500 animate-pulse">Validating parameters...</span>
          )}
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-slate-500 ml-auto shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-slate-500 ml-auto shrink-0" />
          )}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleRefreshValidation();
          }}
          disabled={compatLoading}
          className="h-6 w-6 flex items-center justify-center rounded text-slate-500 hover:text-electric-blue hover:bg-slate-800/50 transition-colors disabled:opacity-40 ml-1"
          title="Refresh validation"
          aria-label="Refresh validation"
        >
          <RefreshCw className={`h-3 w-3 ${compatLoading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Issue list */}
      {expanded && (
        <div
          id="recipe-validation-issue-list"
          className="border-t border-slate-800 divide-y divide-slate-800/50"
        >
          {" "}
          {allIssues.map((issue) => (
            <div
              key={issue.id}
              className={`px-3 py-2 ${issue.severity === "critical" ? "bg-rose-950/10" : "bg-amber-950/5"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {issue.severity === "critical" ? (
                      <AlertTriangle className="h-3 w-3 text-rose-400 shrink-0" />
                    ) : (
                      <Info className="h-3 w-3 text-amber-400 shrink-0" />
                    )}
                    <span
                      className={`text-xs font-medium ${issue.severity === "critical" ? "text-rose-300" : "text-amber-300"
                        }`}
                    >
                      {issue.title}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{issue.description}</p>
                </div>
                {"autofix" in issue && issue.autofix && (
                  <button
                    type="button"
                    onClick={(e) => handleApplyAutofix(issue, e)}
                    className="shrink-0 flex items-center gap-1 px-2 py-1 text-[9px] font-medium rounded border border-electric-blue/30 bg-electric-blue/10 text-electric-blue hover:bg-electric-blue/20 transition-colors cursor-pointer"
                    title={issue.actionLabel || "Apply fix"}
                  >
                    <Zap className="h-2.5 w-2.5" />
                    {issue.actionLabel || "Fix"}
                  </button>
                )}
              </div>
            </div>
          ))}
          {/* Compatibility details toggle */}
          {compatResult && (
            <div className="px-3 py-2">
              <button
                type="button"
                onClick={() => setShowCompatDetails(!showCompatDetails)}
                className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-400 transition-colors"
              >
                {showCompatDetails ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                Model compatibility ({compatResult.model ?? "unknown"} / {compatResult.framework})
              </button>
              {showCompatDetails && (
                <div className="mt-2 space-y-1">
                  {compatResult.selected_hardware && (
                    <div className="text-[11px]">
                      <span className="text-slate-500">Hardware: </span>
                      <span className="text-slate-300">{compatResult.selected_hardware}</span>
                    </div>
                  )}
                  {compatResult.hardware_compatibility &&
                    Object.entries(compatResult.hardware_compatibility).map(
                      ([passName, info]: [string, PassCompat]) => (
                        <div key={passName} className="flex items-start gap-2 text-[11px]">
                          <span
                            className={info.support === "supported" ? "text-emerald-400" : "text-amber-400"}
                          >
                            {info.support === "supported" ? "✓" : "⚠"}
                          </span>
                          <div className="flex-1">
                            <span className="text-slate-300 font-medium">{passName}</span>
                            <span className="text-slate-500 ml-1">({info.support})</span>
                            {info.note && <p className="text-slate-400 mt-0.5">{info.note}</p>}
                            {info.typical_accuracy_drop && info.typical_accuracy_drop !== "n/a" && (
                              <p className="text-slate-500">Accuracy: {info.typical_accuracy_drop}</p>
                            )}
                          </div>
                        </div>
                      ),
                    )}
                  {compatResult.note && (
                    <div className="text-[11px] text-slate-400 mt-1">{compatResult.note}</div>
                  )}
                </div>
              )}
            </div>
          )}
          {/* Compatibility errors */}
          {compatError && (
            <div className="px-3 py-2 text-[11px] text-slate-500">
              {compatError && <div>Compatibility check: {compatError}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
