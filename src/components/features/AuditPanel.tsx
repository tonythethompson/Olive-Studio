import { RefreshCw, AlertTriangle, CheckCircle2, Zap, Check } from "lucide-react";
import { ProviderErrorBlock } from "./ProviderErrorBlock";
import type { AnalysisResult, Suggestion } from "./gemini/types";

interface AuditPanelProps {
  analysis: AnalysisResult | null;
  isAnalyzing: boolean;
  analysisError: string;
  onApplyAutofix: (autofix: Suggestion["autofix"]) => void;
  onRunAnalysis: () => void;
  onGoSettings: () => void;
}

/**
 * Renders the pipeline audit analysis: score ring, suggestions list with
 * Apply buttons, and the Analyze CTA.
 */
export function AuditPanel({
  analysis,
  isAnalyzing,
  analysisError,
  onApplyAutofix,
  onRunAnalysis,
  onGoSettings,
}: AuditPanelProps) {
  return (
    <div className="space-y-4">
      {analysis && !isAnalyzing && (
        <div className="bg-slate-950/70 rounded border border-slate-800 flex items-center gap-4 p-4">
          <div className="relative h-16 w-16 shrink-0 flex items-center justify-center">
            <svg className="w-full h-full transform -rotate-90">
              <circle
                cx="32"
                cy="32"
                r="28"
                stroke="currentColor"
                className="text-slate-800"
                strokeWidth="4"
                fill="transparent"
              />
              <circle
                cx="32"
                cy="32"
                r="28"
                stroke="currentColor"
                className="text-electric-blue transition-all duration-1000"
                strokeWidth="4"
                fill="transparent"
                strokeDasharray={176}
                strokeDashoffset={176 - (176 * analysis.score) / 100}
              />
            </svg>
            <span className="absolute text-sm font-extrabold font-mono text-slate-100">
              {analysis.score}%
            </span>
          </div>
          <div>
            <h4 className="text-sm font-medium text-slate-100">Pipeline efficiency</h4>
            <div
              className={`mt-0.5 text-[10px] inline-block px-1.5 py-0.5 rounded font-mono font-bold ${
                analysis.level === "Optimized"
                  ? "bg-emerald-500/10 text-emerald-400"
                  : analysis.level === "Suboptimal"
                    ? "bg-amber-500/10 text-amber-400"
                    : "bg-rose-500/10 text-rose-400"
              }`}
            >
              {analysis.level} Mode
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed mt-1">{analysis.summary}</p>
          </div>
        </div>
      )}

      {isAnalyzing && (
        <div className="text-center py-12 bg-slate-950/30 border border-slate-800 rounded-lg flex flex-col items-center justify-center">
          <RefreshCw className="h-7 w-7 text-electric-blue animate-spin mb-3" />
          <p className="text-xs font-medium text-slate-300">Auditing pipeline...</p>
          <p className="text-xs text-slate-500 mt-0.5">Inspecting workspace…</p>
        </div>
      )}

      {analysisError ? <ProviderErrorBlock msg={analysisError} onGoSettings={onGoSettings} /> : null}

      {analysis && !isAnalyzing && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 font-medium">Suggestions</span>
            <button
              type="button"
              onClick={onRunAnalysis}
              className="text-[10px] text-electric-blue hover:text-white flex items-center gap-1 cursor-pointer font-bold"
            >
              <RefreshCw className="h-3 w-3" /> Refresh
            </button>
          </div>
          <div className="space-y-2.5 max-h-[50vh] overflow-y-auto pr-0.5">
            {analysis.suggestions.map((s, i) => (
              <div
                key={i}
                className={`p-3.5 rounded-lg border text-xs flex flex-col gap-3 bg-slate-950/45 transition-all ${
                  s.type === "warning"
                    ? "border-rose-500/20 hover:border-rose-500/40"
                    : s.type === "success"
                      ? "border-emerald-500/25 hover:border-emerald-500/40"
                      : "border-slate-800 hover:border-slate-700"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-bold text-slate-100 flex items-center gap-1.5">
                      {s.type === "warning" ? (
                        <AlertTriangle className="h-3.5 w-3.5 text-rose-450 shrink-0" />
                      ) : s.type === "success" ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-450 shrink-0" />
                      ) : (
                        <Zap className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                      )}
                      {s.title}
                    </span>
                    <span
                      className={`text-[9px] font-mono uppercase tracking-widest px-1.5 rounded font-bold ${
                        s.impact === "High" ? "bg-rose-500/10 text-rose-400" : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {s.impact}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">{s.description}</p>
                </div>
                {s.autofix?.pass && (
                  <div className="pt-2 border-t border-slate-900/60 flex items-center justify-between">
                    <span className="text-[9px] font-mono text-slate-500">→ {s.autofix.pass}</span>
                    <button
                      type="button"
                      onClick={() => onApplyAutofix(s.autofix)}
                      className="bg-electric-blue/10 text-electric-blue hover:bg-electric-blue hover:text-white border border-electric-blue/30 text-[10px] px-2.5 py-1 rounded font-bold flex items-center gap-1 transition-all cursor-pointer"
                    >
                      <Check className="h-3 w-3" /> Apply
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={onRunAnalysis}
        disabled={isAnalyzing}
        className="w-full h-10 bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs text-slate-200 font-bold flex items-center justify-center gap-2 rounded-lg cursor-pointer transition-colors"
      >
        <RefreshCw className={`h-3.5 w-3.5 text-electric-blue ${isAnalyzing ? "animate-spin" : ""}`} />
        Analyze Optimization Pipeline
      </button>
    </div>
  );
}
