import { Database } from "lucide-react";
import { navigatePipeline } from "@/lib/pipelineNavigation";
import { getModelSourceSummary } from "../nodePreview";
import type { InspectorProps } from "./types";

const SOURCE_LABELS = {
  huggingface: "HuggingFace Hub Registry",
  azure: "AzureML Asset Workspace",
  local: "Local Directory Framework Weights",
} as const;

/**
 * Displays the selected model source and current model summary for the input pipeline step.
 *
 * @param state - Current recipe state used to determine the source label and model summary
 * @returns The rendered input inspector panel
 */
export function InputInspector({ state }: InspectorProps) {
  const sourceLabel = SOURCE_LABELS[state.modelSource] ?? state.modelSource;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <h3 className="text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1">
          <Database className="h-3.5 w-3.5 text-electric-blue" />
          Input Framework Model Source
        </h3>
        <p className="text-xs text-slate-400 leading-relaxed">
          Loads baseline weights into PyTorch abstract structure. Model is parsed into computational nodes
          before launching the Olive engine execution cascade.
        </p>
        <button
          type="button"
          onClick={() => navigatePipeline("input")}
          className="mt-2 text-[10px] text-electric-blue hover:text-white underline underline-offset-2 cursor-pointer"
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
