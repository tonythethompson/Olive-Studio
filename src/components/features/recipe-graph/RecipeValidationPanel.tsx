import { useEffect, useState } from "react";
import { getPipelineValidation, applyIssueAutofix, type PipelineIssue } from "@/lib/pipelineValidation";
import { validatePassParameters } from "@/lib/passParameterValidation";
import { buildPipelineSteps } from "./graphLayout";
import { UIState } from "@/types";
import { AlertTriangle, CheckCircle, ChevronDown, ChevronRight, Info, Zap } from "lucide-react";

interface McpValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  chain: Array<{ name: string; type: string; known: boolean }>;
}

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

export function RecipeValidationPanel({ state, setState }: RecipeValidationPanelProps) {
  const [mcpResult, setMcpResult] = useState<McpValidationResult | null>(null);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [mcpValidated, setMcpValidated] = useState(false);
  const [compatResult, setCompatResult] = useState<CompatibilityResult | null>(null);
  const [compatLoading, setCompatLoading] = useState(false);
  const [compatError, setCompatError] = useState<string | null>(null);
  const [compatValidated, setCompatValidated] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [showMcpDetails, setShowMcpDetails] = useState(false);
  const [showCompatDetails, setShowCompatDetails] = useState(false);

  const validation = getPipelineValidation(state);
  const pipelineSteps = buildPipelineSteps(state.passes);
  const activePassNames = pipelineSteps
    .filter((s) => s.active && s.id !== "input" && s.id !== "output" && s.id !== "provider")
    .map((s) => s.id);

  // Call MCP server for deeper validation with request cancellation
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    const timer = setTimeout(async () => {
      if (activePassNames.length === 0) {
        if (!cancelled) {
          setMcpResult(null);
          setMcpError(null);
          setMcpLoading(false);
          setMcpValidated(true);
        }
        return;
      }

      setMcpLoading(true);
      setMcpError(null);

      try {
        const res = await fetch("/api/validate-recipe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ passNames: activePassNames }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }

        const result = await res.json();
        if (!cancelled) {
          setMcpResult(result);
          setMcpValidated(true);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (!cancelled) {
          setMcpError(err instanceof Error ? err.message : "MCP validation failed");
          setMcpResult(null);
          setMcpValidated(true);
        }
      } finally {
        if (!cancelled) setMcpLoading(false);
      }
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [activePassNames]);

  // Call MCP server for model-hardware compatibility check
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    const timer = setTimeout(async () => {
      // Determine model name and framework from UIState
      const modelName = state.hfModelId || (state.localFiles.length > 0 ? state.localFiles[0].name : "");
      const framework = state.passes.conversionSourceFormat === "pytorch" ? "PyTorch" : "ONNX";
      const hardwareTarget =
        state.ihvProvider === "CUDAExecutionProvider"
          ? "NVIDIA RTX 4090"
          : state.ihvProvider === "TensorrtExecutionProvider"
            ? "NVIDIA RTX 4090"
            : state.ihvProvider === "NvTensorRTRTXExecutionProvider"
              ? "NVIDIA RTX 4090"
              : state.ihvProvider === "OpenVINOExecutionProvider"
                ? "Intel Core i9 CPU"
                : state.ihvProvider === "QNNExecutionProvider"
                  ? "Qualcomm Snapdragon NPU"
                  : "";

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
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [state.hfModelId, state.localFiles, state.passes.conversionSourceFormat, state.ihvProvider]);

  const handleApplyAutofix = (issue: PipelineIssue) => {
    const patch = applyIssueAutofix(state, issue);
    setState(patch);
  };

  // Hardware-specific parameter validation (synchronous, cheap — runs every render with state)
  const paramWarnings = validatePassParameters(state, activePassNames);

  // Build compatibility warnings for active passes
  const compatWarnings = compatResult?.compatibility_warnings ?? [];
  const activePassWarnings = compatWarnings.filter((w) =>
    activePassNames.some(
      (n) =>
        n.toLowerCase().includes(w.pass_name.toLowerCase()) ||
        w.pass_name.toLowerCase().includes(n.toLowerCase()),
    ),
  );

  const allIssues = [
    ...validation.issues,
    ...(mcpResult?.errors.map((e, i) => ({
      id: `mcp-error-${i}-${e}`,
      severity: "critical" as const,
      title: e,
      description: "Detected by MCP pass chain validator",
      source: "mcp" as const,
    })) ?? []),
    ...(mcpResult?.warnings.map((w, i) => ({
      id: `mcp-warning-${i}-${w}`,
      severity: "warning" as const,
      title: w,
      description: "Detected by MCP pass chain validator",
      source: "mcp" as const,
    })) ?? []),
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
    })),
  ];

  const criticalCount = allIssues.filter((i) => i.severity === "critical").length;
  const warningCount = allIssues.filter((i) => i.severity === "warning").length;

  const isLoading = mcpLoading || compatLoading;
  const hasError = mcpError || compatError;

  if (allIssues.length === 0 && !isLoading && !hasError && mcpValidated && compatValidated) {
    return (
      <div className="rounded-lg border border-emerald-800/50 bg-emerald-950/20 p-3">
        <div className="flex items-center gap-2 text-emerald-400">
          <CheckCircle className="h-4 w-4" />
          <span className="text-xs font-medium">Recipe validated — no issues found</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/80 overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-slate-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {criticalCount > 0 ? (
            <AlertTriangle className="h-4 w-4 text-rose-400" />
          ) : warningCount > 0 ? (
            <Info className="h-4 w-4 text-amber-400" />
          ) : (
            <CheckCircle className="h-4 w-4 text-emerald-400" />
          )}
          <span className="text-xs font-medium text-slate-300">
            {criticalCount > 0
              ? `${criticalCount} blocking issue${criticalCount !== 1 ? "s" : ""}`
              : warningCount > 0
                ? `${warningCount} warning${warningCount !== 1 ? "s" : ""}`
                : "All checks passed"}
          </span>
          {(mcpLoading || compatLoading) && (
            <span className="text-[10px] text-slate-500 animate-pulse">MCP checking...</span>
          )}
        </div>
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
        )}
      </button>

      {/* Issue list */}
      {expanded && (
        <div className="border-t border-slate-800 divide-y divide-slate-800/50">
          {allIssues.map((issue) => (
            <div
              key={issue.id}
              className={`px-3 py-2.5 ${issue.severity === "critical" ? "bg-rose-950/10" : "bg-amber-950/5"}`}
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
                      className={`text-[11px] font-medium ${
                        issue.severity === "critical" ? "text-rose-300" : "text-amber-300"
                      }`}
                    >
                      {issue.title}
                    </span>
                    {"source" in issue && issue.source === "mcp" && (
                      <span className="text-[8px] px-1 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700">
                        MCP
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">{issue.description}</p>
                </div>
                {"autofix" in issue && issue.autofix && (
                  <button
                    type="button"
                    onClick={() => handleApplyAutofix(issue)}
                    className="shrink-0 flex items-center gap-1 px-2 py-1 text-[9px] font-medium rounded border border-electric-blue/30 bg-electric-blue/10 text-electric-blue hover:bg-electric-blue/20 transition-colors"
                    title={issue.actionLabel || "Apply fix"}
                  >
                    <Zap className="h-2.5 w-2.5" />
                    {issue.actionLabel || "Fix"}
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* MCP details toggle */}
          {mcpResult && (
            <div className="px-3 py-2">
              <button
                type="button"
                onClick={() => setShowMcpDetails(!showMcpDetails)}
                className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-400 transition-colors"
              >
                {showMcpDetails ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                MCP pass chain details ({mcpResult.chain.length} passes)
              </button>
              {showMcpDetails && (
                <div className="mt-2 space-y-1">
                  {mcpResult.chain.map((pass, i) => (
                    <div key={i} className="flex items-center gap-2 text-[10px]">
                      <span className="text-slate-600 font-mono">{i + 1}.</span>
                      <span className={pass.known ? "text-slate-300" : "text-rose-400"}>{pass.name}</span>
                      <span className="text-slate-600">({pass.type})</span>
                      {!pass.known && <span className="text-[8px] text-rose-500">unknown</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Compatibility details toggle */}
          {compatResult && (
            <div className="px-3 py-2">
              <button
                type="button"
                onClick={() => setShowCompatDetails(!showCompatDetails)}
                className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-400 transition-colors"
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
                    <div className="text-[10px]">
                      <span className="text-slate-500">Hardware: </span>
                      <span className="text-slate-300">{compatResult.selected_hardware}</span>
                    </div>
                  )}
                  {compatResult.hardware_compatibility &&
                    Object.entries(compatResult.hardware_compatibility).map(
                      ([passName, info]: [string, PassCompat]) => (
                        <div key={passName} className="flex items-start gap-2 text-[10px]">
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
                    <div className="text-[10px] text-slate-400 mt-1">{compatResult.note}</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* MCP errors */}
          {(mcpError || compatError) && (
            <div className="px-3 py-2 text-[10px] text-slate-500">
              {mcpError && <div>MCP validation: {mcpError}</div>}
              {compatError && <div>Compatibility check: {compatError}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
