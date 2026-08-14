import { type MouseEvent as ReactMouseEvent } from "react";
import { type IHVProvider } from "@/types";
import { qnnExplicitRetryProviders } from "@/lib/qnnReadiness";
import { Wrench, Bug } from "lucide-react";
import { DiagnosisHistory, type DiagnosisEntry } from "./DiagnosisHistory";

export interface ExecutionLogPanelProps {
  executionLogs: string[];
  executionStatus: "idle" | "running" | "completed" | "failed" | "cancelled";
  selectedLogIndices: Set<number>;
  handleLogLineClick: (index: number, e: ReactMouseEvent<HTMLParagraphElement>) => void;
  isDiagnosing: boolean;
  handleDiagnose: () => void;
  showQnnRetry: boolean;
  onRetryProvider: (provider: IHVProvider) => void;
  onSendFeedback: () => void;
  diagnosisHistory: DiagnosisEntry[];
  activeHistoryIndex: number;
  onSelectHistory: (index: number) => void;
  onClearHistory: () => void;
}

/**
 * Renders the streaming execution log with line selection, manual diagnosis,
 * send-feedback, QNN retry-provider actions, and the diagnosis history sidebar.
 */
export function ExecutionLogPanel({
  executionLogs,
  executionStatus,
  selectedLogIndices,
  handleLogLineClick,
  isDiagnosing,
  handleDiagnose,
  showQnnRetry,
  onRetryProvider,
  onSendFeedback,
  diagnosisHistory,
  activeHistoryIndex,
  onSelectHistory,
  onClearHistory,
}: ExecutionLogPanelProps) {
  return (
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
                  onClick={onSendFeedback}
                  title="Send feedback"
                  className="flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded border border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 hover:border-amber-500/50 transition-all cursor-pointer"
                >
                  <Bug className="h-3 w-3" /> Send feedback
                </button>
              )}
              {showQnnRetry &&
                qnnExplicitRetryProviders().map((provider) => (
                  <button
                    key={provider}
                    type="button"
                    onClick={() => onRetryProvider(provider)}
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
        onSelect={onSelectHistory}
        onClear={onClearHistory}
      />
    </div>
  );
}
