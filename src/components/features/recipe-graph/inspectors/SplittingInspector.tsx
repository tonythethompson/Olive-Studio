import { Check, Workflow } from "lucide-react";
import type { InspectorProps } from "./types";

export function SplittingInspector({ state }: InspectorProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <h4 className="text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1">
          <Workflow className="h-3.5 w-3.5 text-amber-500" />
          Multi-Device Model Splitting
        </h4>
        <p className="text-xs text-slate-400 leading-relaxed">
          Partitions massive multi-billion parameter networks across pipeline boundaries to process layers
          parallelly on low-compute edge devices.
        </p>
      </div>
      <div className="border-l border-slate-800/50 pl-4 flex flex-col justify-center">
        {state.passes.splitting ? (
          <div className="p-3 bg-slate-950/80 rounded border border-slate-800 flex items-center gap-3">
            <div className="p-1.5 rounded-full bg-amber-500/10">
              <Check className="h-4 w-4 text-amber-400" />
            </div>
            <div className="flex-1">
              <div className="text-xs font-bold text-slate-200">Balanced Split Pipeline</div>
              <div className="text-[10px] text-slate-400 leading-tight">
                Layers subdivided evenly according to memory footprint coefficients.
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center text-xs text-slate-500 font-mono italic">
            Model Splitting is disabled. Model is compiled as a unified single binary file.
          </div>
        )}
      </div>
    </div>
  );
}
