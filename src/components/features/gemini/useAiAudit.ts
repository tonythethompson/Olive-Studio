import { useRef, useState } from "react";
import { resolveAuditAutofix } from "@/lib/auditAutofix";
import type { UIState } from "@/types";
import type { AnalysisResult, Suggestion } from "./types";

interface UseAiAuditOptions {
  state: UIState;
  setState: (partial: Partial<UIState>) => void;
}

/**
 * Owns the pipeline audit: running `/api/ai/analyze-state` and applying the
 * assistant's autofix patches back onto the pipeline state.
 */
export function useAiAudit({ state, setState }: UseAiAuditOptions) {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  /** When true, the next analyze call includes previousScore for continuity. */
  const continuityScoreRef = useRef<number | null>(null);

  const runAnalysis = async (opts?: { previousScore?: number | null }) => {
    setIsAnalyzing(true);
    setAnalysisError("");
    const previousScore = opts?.previousScore !== undefined ? opts.previousScore : continuityScoreRef.current;
    continuityScoreRef.current = null;
    try {
      const r = await fetch("/api/ai/analyze-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state,
          ...(typeof previousScore === "number" ? { previousScore } : {}),
        }),
      });
      const contentType = r.headers.get("content-type") ?? "";
      const data = contentType.includes("application/json") ? await r.json().catch(() => ({})) : {};
      if (!r.ok) throw new Error((data as { error?: string }).error || `HTTP ${r.status}`);
      if (!contentType.includes("application/json")) {
        throw new Error(
          "Server returned non-JSON. Restart with npm run dev (Express + API), not vite alone.",
        );
      }
      setAnalysis(data as AnalysisResult);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setAnalysisError(err.message || "Analysis failed.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  /** Drop the current result so the next open/provider change re-audits. */
  const resetAnalysis = () => setAnalysis(null);

  /** Clear the previous result and immediately audit again. */
  const restartAnalysis = () => {
    setAnalysis(null);
    setAnalysisError("");
    continuityScoreRef.current = null;
    void runAnalysis();
  };

  const applyAutofix = (autofix: Suggestion["autofix"]) => {
    if (!autofix?.pass) return;
    const patch = resolveAuditAutofix(autofix, state);
    if (!patch) return;
    const prior = analysis?.score ?? null;
    setState(patch);
    continuityScoreRef.current = prior;
    setTimeout(() => void runAnalysis({ previousScore: prior }), 400);
  };

  return {
    analysis,
    isAnalyzing,
    analysisError,
    runAnalysis,
    resetAnalysis,
    restartAnalysis,
    applyAutofix,
  };
}
