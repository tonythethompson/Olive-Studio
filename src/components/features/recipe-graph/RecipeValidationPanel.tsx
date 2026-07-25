import { useEffect, useState } from "react";
import { getPipelineValidation, applyIssueAutofix, type PipelineIssue } from "@/lib/pipelineValidation";
import { buildPipelineSteps } from "./graphLayout";
import { UIState } from "@/types";
import { AlertTriangle, CheckCircle, ChevronDown, ChevronRight, Info, Zap } from "lucide-react";

interface McpValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  chain: Array<{ name: string; type: string; known: boolean }>;
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
  const [expanded, setExpanded] = useState(true);
  const [showMcpDetails, setShowMcpDetails] = useState(false);

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

  const handleApplyAutofix = (issue: PipelineIssue) => {
    const patch = applyIssueAutofix(state, issue);
    setState(patch);
  };

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
  ];

  const criticalCount = allIssues.filter((i) => i.severity === "critical").length;
  const warningCount = allIssues.filter((i) => i.severity === "warning").length;

  if (allIssues.length === 0 && !mcpLoading && !mcpError && mcpValidated) {
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
          {mcpLoading && <span className="text-[10px] text-slate-500 animate-pulse">MCP checking...</span>}
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

          {/* MCP error */}
          {mcpError && (
            <div className="px-3 py-2 text-[10px] text-slate-500">MCP validation unavailable: {mcpError}</div>
          )}
        </div>
      )}
    </div>
  );
}
