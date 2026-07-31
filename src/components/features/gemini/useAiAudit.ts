import { useState } from "react";
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

  const runAnalysis = async () => {
    setIsAnalyzing(true);
    setAnalysisError("");
    try {
      const r = await fetch("/api/ai/analyze-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
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
    void runAnalysis();
  };

  const applyAutofix = (autofix: Suggestion["autofix"]) => {
    if (!autofix?.pass) return;
    const { pass, value } = autofix;
    // Multi-field JSON patches from the assistant: {"quantMethod":"awq","quantPrecision":"int4"}
    if (value.trim().startsWith("{")) {
      try {
        const obj = JSON.parse(value) as Record<string, unknown>;
        if (pass === "ihvProvider" || pass === "cudaVersion") {
          setState({ [pass]: obj[pass] } as Partial<UIState>);
        } else {
          const passKey = pass.startsWith("passes.") ? pass.slice(7) : pass;
          // If the object has multiple pass keys, merge all; else set single key
          const looksLikePasses = Object.keys(obj).some((k) => k in state.passes || k === passKey);
          if (looksLikePasses && !("ihvProvider" in obj)) {
            setState({
              passes: {
                ...state.passes,
                ...(obj as Partial<UIState["passes"]>),
                // TRT RTX / AWQ suggestions should not leave structured pruning on
                ...(obj.quantMethod === "awq" ? { pruning: false } : {}),
              },
            });
          } else {
            setState(obj as Partial<UIState>);
          }
        }
        setTimeout(() => void runAnalysis(), 400);
        return;
      } catch {
        /* fall through to scalar apply */
      }
    }
    if (pass === "ihvProvider") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setState({ ihvProvider: value as any });
    } else if (pass === "cudaVersion") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setState({ cudaVersion: value as any });
    } else {
      const passKey = pass.startsWith("passes.") ? pass.slice(7) : pass;
      const parsed =
        value === "true" ? true : value === "false" ? false : isNaN(Number(value)) ? value : Number(value);
      const nextPasses: UIState["passes"] = {
        ...state.passes,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [passKey]: parsed as any,
      };
      // Enabling structured pruning on TensorRT RTX: leave quant as-is; validation will suggest AWQ
      if (passKey === "quantMethod" && value === "awq") {
        nextPasses.pruning = false;
        nextPasses.quantization = true;
      }
      if (passKey === "quantPrecision" && (value === "int4" || value === "int8")) {
        nextPasses.quantization = true;
      }
      setState({ passes: nextPasses });
    }
    setTimeout(() => void runAnalysis(), 400);
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
