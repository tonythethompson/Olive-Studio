import { Label, Select } from "@/components/ui";
import { UIState } from "@/types";
import { Database } from "lucide-react";
import { getModelSourceSummary } from "../nodePreview";
import type { InspectorProps } from "./types";

export function InputInspector({ state, setState }: InspectorProps) {
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
          onClick={() => document.getElementById("input")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          className="mt-2 text-[10px] text-electric-blue hover:text-white underline underline-offset-2 cursor-pointer"
        >
          Full model options in step 01
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 border-l border-slate-800/50 pl-4">
        <div>
          <Label className="text-[10px] font-mono text-slate-400">Selected Source</Label>
          <Select
            value={state.modelSource}
            onChange={(e) => setState({ modelSource: e.target.value as UIState["modelSource"] })}
            className="h-8 text-xs bg-slate-950"
          >
            <option value="huggingface">HuggingFace Hub Registry</option>
            <option value="azure">AzureML Asset Workspace</option>
            <option value="local">Local Directory Framework Weights</option>
          </Select>
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
