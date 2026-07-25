import { Check, Wrench } from "lucide-react";
import type { McpDiagnostic } from "@/types";

export interface MCPDiagnosticCardProps {
  /** The diagnostic result from the MCP knowledge base. Null = loading/querying. */
  diagnostic: McpDiagnostic | null;
  /** True while the diagnostic fetch is in flight. */
  isDiagnosing: boolean;
  /** Non-empty string means a fix has been applied (auto-clears after timeout). */
  fixApplied: string;
  /** Called when the user clicks "Apply Fix". */
  onApplyFix: () => void;
}

/**
 * Displays an MCP diagnostic result for a failed Olive run.
 *
 * States:
 * - **Loading**: `diagnostic` is null, `isDiagnosing` is true → pulsing "Diagnosing..." message
 * - **Querying**: `diagnostic` is null, `isDiagnosing` is false → italic "Querying..." message
 * - **Result**: `diagnostic` is non-null → shows title, root cause, workaround, config changes, quirks
 * - **Applied**: `fixApplied` is non-empty → button shows "Fix Applied" with checkmark
 */
export function MCPDiagnosticCard({
  diagnostic,
  isDiagnosing,
  fixApplied,
  onApplyFix,
}: MCPDiagnosticCardProps) {
  return (
    <div className="mt-2 p-3.5 rounded-lg border border-rose-500/30 bg-rose-950/20 text-slate-200 animate-in fade-in space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold text-rose-300 text-xs">
          <Wrench className="h-4 w-4 text-rose-400 shrink-0" />
          <span>Olive MCP Error Diagnostic & Fix</span>
        </div>
        {isDiagnosing && (
          <span className="text-[10px] text-slate-400 animate-pulse">Diagnosing with MCP KB...</span>
        )}
      </div>

      {diagnostic ? (
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
                {diagnostic.relevant_quirks.map((quirk, i) => (
                  <li key={i} className="text-[10px] text-slate-400">
                    • {quirk}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="pt-1.5">
            <button
              type="button"
              onClick={onApplyFix}
              disabled={fixApplied !== ""}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded border transition-all cursor-pointer ${
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
                  <Wrench className="h-3 w-3" /> Apply Fix
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-slate-400 italic">
          Querying Olive MCP Knowledge Base for matching error patterns...
        </p>
      )}
    </div>
  );
}
