import { Check, Wrench } from "lucide-react";
import type { McpDiagnostic } from "@/types";
import { canApplyMcpDiagnostic, matchActionableQuirks } from "@/lib/mcpConfigMapping";
import type { LocalLogDiagnostic } from "@/lib/logFailurePatterns";

export interface MCPDiagnosticCardProps {
  /** The diagnostic result from the MCP knowledge base. Null = no result yet. */
  diagnostic: (McpDiagnostic & Partial<Pick<LocalLogDiagnostic, "evidence">>) | null;
  /** True while the diagnostic fetch is in flight. */
  isDiagnosing: boolean;
  /** Non-empty string means a fix has been applied (auto-clears after timeout). */
  fixApplied: string;
  /** Called when the user clicks "Apply Fix". */
  onApplyFix: () => void;
  /** Called when the user clicks "Diagnose" / "Run MCP Diagnosis". */
  onRunDiagnosis?: () => void;
  /** Fetch/proxy failure message to show instead of a fake "Querying..." state. */
  error?: string | null;
}

/**
 * Displays MCP-based diagnostics and available fixes for a failed Olive run.
 *
 * Shows loading, error, idle, or diagnostic-result content, including optional
 * log evidence, recommended guidance, automatic fix controls, and diagnosis
 * retry actions.
 *
 * @param diagnostic - The diagnostic result to display, or `null` when no result is available
 * @param error - An error message to display when diagnosis fails
 * @param fixApplied - Indicates that the recommended fix has been applied
 */
export function MCPDiagnosticCard({
  diagnostic,
  isDiagnosing,
  fixApplied,
  onApplyFix,
  onRunDiagnosis,
  error = null,
}: MCPDiagnosticCardProps) {
  const canApply = canApplyMcpDiagnostic(diagnostic);
  const actionableQuirkIds = diagnostic ? matchActionableQuirks(diagnostic.relevant_quirks) : [];

  return (
    <div className="mt-2 p-3.5 rounded-lg border border-rose-500/30 bg-rose-950/20 text-slate-200 animate-in fade-in space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold text-rose-300 text-xs">
          <Wrench className="h-4 w-4 text-rose-400 shrink-0" />
          <span>Olive MCP Error Diagnostic & Fix</span>
          {diagnostic?.domain === "studio" ? (
            <span className="rounded border border-amber-500/40 bg-amber-950/40 px-1.5 py-0.5 text-[9px] font-medium text-amber-300">
              Studio
            </span>
          ) : diagnostic?.domain === "olive" ? (
            <span className="rounded border border-sky-500/40 bg-sky-950/40 px-1.5 py-0.5 text-[9px] font-medium text-sky-300">
              Olive
            </span>
          ) : null}
        </div>
        {isDiagnosing && (
          <span className="text-[10px] text-slate-400 animate-pulse">Diagnosing with MCP KB...</span>
        )}
      </div>

      {isDiagnosing ? (
        <p className="text-[11px] text-slate-400 italic">
          Querying Olive MCP Knowledge Base for matching error patterns...
        </p>
      ) : error ? (
        <div className="space-y-2">
          <p className="text-[11px] text-rose-300/90">{error}</p>
          {onRunDiagnosis && (
            <button
              type="button"
              onClick={onRunDiagnosis}
              disabled={isDiagnosing}
              className="text-[11px] text-slate-300 hover:text-rose-300 transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
            >
              <Wrench className="h-3 w-3" /> Retry diagnosis
            </button>
          )}
        </div>
      ) : diagnostic ? (
        <div className="space-y-1.5 text-xs font-sans">
          <div>
            <span className="font-semibold text-rose-300">Issue: </span>
            <span className="text-slate-200">{diagnostic.title}</span>
          </div>
          <div>
            <span className="font-semibold text-slate-400">Root Cause: </span>
            <span className="text-slate-300">{diagnostic.root_cause}</span>
          </div>
          <div>
            <span className="font-semibold text-emerald-400">Recommended Fix: </span>
            <span className="text-slate-300">{diagnostic.workaround}</span>
          </div>

          {Array.isArray(diagnostic.evidence) && diagnostic.evidence.length > 0 && (
            <div className="pt-1">
              <span className="font-semibold text-slate-400">Found in log: </span>
              <ul className="mt-1 space-y-0.5 rounded border border-slate-800 bg-slate-950/60 p-2 font-mono text-[10px] text-rose-200/90">
                {diagnostic.evidence.map((line, i) => (
                  <li key={i} className="break-all whitespace-pre-wrap">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {diagnostic.matched_entry && (
            <div className="pt-0.5 text-[10px] text-slate-500">
              Matcher: <code className="font-mono text-slate-400">{diagnostic.matched_entry}</code>
              {diagnostic.domain ? ` · ${diagnostic.domain}` : ""}
            </div>
          )}

          {diagnostic.updated_config && (
            <div className="pt-1">
              <span className="font-semibold text-electric-blue">Config Changes: </span>
              <span className="text-slate-400 font-mono text-[10px]">
                {Object.entries(diagnostic.updated_config)
                  .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                  .join(", ")}
              </span>
            </div>
          )}

          {diagnostic.relevant_quirks && diagnostic.relevant_quirks.length > 0 && (
            <div className="pt-1">
              <span className="font-semibold text-amber-400">Known Quirks: </span>
              <ul className="mt-0.5 space-y-0.5">
                {diagnostic.relevant_quirks.map((quirk, i) => {
                  const isActionable = matchActionableQuirks([quirk]).length > 0;
                  return (
                    <li key={i} className="text-[10px] text-slate-400">
                      • {quirk}
                      {isActionable && (
                        <span className="ml-1 text-emerald-500/80 font-semibold">(auto-fixable)</span>
                      )}
                    </li>
                  );
                })}
              </ul>
              {actionableQuirkIds.length > 0 && (
                <p className="mt-1 text-[10px] text-slate-500">
                  Apply Fix also applies: {actionableQuirkIds.join(", ")}
                </p>
              )}
            </div>
          )}

          <div className="pt-1.5 space-y-1">
            <button
              type="button"
              onClick={onApplyFix}
              disabled={fixApplied !== "" || !canApply}
              title={
                !canApply
                  ? diagnostic?.applyable === false
                    ? "Guidance-only diagnostic — follow Recommended Fix manually"
                    : "No auto-applyable config — follow Recommended Fix manually"
                  : "Apply recommended config into the pipeline UI"
              }
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded border transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                fixApplied !== ""
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                  : "border-electric-blue/30 bg-electric-blue/10 text-electric-blue hover:bg-electric-blue/20 hover:border-electric-blue/50"
              }`}
            >
              {fixApplied !== "" ? (
                <>
                  <Check className="h-3 w-3" /> Fix Applied
                </>
              ) : (
                <>
                  <Wrench className="h-3 w-3" />{" "}
                  {diagnostic.matched_entry === "studio-hf-task-speech-recognition"
                    ? "Confirm fix"
                    : "Apply Fix"}
                </>
              )}
            </button>
            {fixApplied !== "" && (
              <p className="text-[10px] text-emerald-400/80">
                {diagnostic.matched_entry === "studio-hf-task-speech-recognition"
                  ? "Task fix acknowledged. Rebuild/refresh the recipe, then run Execute Live again."
                  : "Pipeline updated (config + quirks). Re-run Execute so the recipe uses Convert → Optimize → Quantize order and any new cache_dir / output_name values."}
              </p>
            )}
            {!canApply && (
              <p className="text-[10px] text-slate-500">
                No auto-applyable config or quirks for this diagnostic. Follow Recommended Fix and the log
                evidence above.
              </p>
            )}
            {onRunDiagnosis && (
              <button
                type="button"
                onClick={onRunDiagnosis}
                disabled={isDiagnosing}
                className="text-[11px] text-slate-500 hover:text-rose-300 transition-colors cursor-pointer disabled:opacity-50"
              >
                Re-run diagnosis
              </button>
            )}
          </div>
        </div>
      ) : onRunDiagnosis ? (
        <button
          type="button"
          onClick={onRunDiagnosis}
          className="text-[11px] text-slate-400 hover:text-rose-300 transition-colors cursor-pointer flex items-center gap-1.5"
        >
          <Wrench className="h-3 w-3" /> Run MCP Diagnosis
        </button>
      ) : (
        <p className="text-[11px] text-slate-500">
          No diagnosis yet. Use Diagnose on the log panel after a failed run.
        </p>
      )}
    </div>
  );
}
