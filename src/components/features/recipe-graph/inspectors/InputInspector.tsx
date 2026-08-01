import { useSyncExternalStore } from "react";
import { Database } from "lucide-react";
import {
  isPipelineOliveRunning,
  navigatePipeline,
  PIPELINE_NAV_BLOCKED_MESSAGE,
  subscribePipelineOliveRunning,
} from "@/lib/pipelineNavigation";
import { getModelSourceSummary } from "../nodePreview";
import type { InspectorProps } from "./types";

const SOURCE_LABELS = {
  huggingface: "HuggingFace Hub Registry",
  azure: "AzureML Asset Workspace",
  local: "Local Directory Framework Weights",
} as const;

/**
 * Displays the selected input model source and current model summary.
 *
 * @param state - The current inspector state containing model source details
 */
export function InputInspector({ state }: InspectorProps) {
  const sourceLabel = SOURCE_LABELS[state.modelSource] ?? state.modelSource;
  const navBlocked = useSyncExternalStore(subscribePipelineOliveRunning, isPipelineOliveRunning, () => false);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <h4 className="text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1">
          <Database className="h-3.5 w-3.5 text-electric-blue" />
          Input Framework Model Source
        </h4>
        <p className="text-xs text-slate-400 leading-relaxed">
          Loads baseline weights into PyTorch abstract structure. Model is parsed into computational nodes
          before launching the Olive engine execution cascade.
        </p>
        <button
          type="button"
          aria-disabled={navBlocked}
          title={navBlocked ? PIPELINE_NAV_BLOCKED_MESSAGE : undefined}
          onClick={() => navigatePipeline("input")}
          className={
            navBlocked
              ? "mt-2 text-[10px] text-electric-blue opacity-40 cursor-not-allowed"
              : "mt-2 text-[10px] text-electric-blue hover:text-white underline underline-offset-2 cursor-pointer"
          }
        >
          Edit model source in step 01
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 border-l border-slate-800/50 pl-4">
        <div className="rounded border border-slate-800 bg-slate-950/80 px-3 py-2">
          <p className="text-[10px] font-mono text-slate-500 uppercase mb-1">Selected source</p>
          <p className="text-[11px] font-mono text-slate-200">{sourceLabel}</p>
        </div>
        <div className="rounded border border-slate-800 bg-slate-950/80 px-3 py-2">
          <p className="text-[10px] font-mono text-slate-500 uppercase mb-1">Current model</p>
          <p className="text-[11px] font-mono text-slate-300 truncate" title={getModelSourceSummary(state)}>
            {getModelSourceSummary(state)}
          </p>
        </div>
      </div>
    </div>
  );
}
