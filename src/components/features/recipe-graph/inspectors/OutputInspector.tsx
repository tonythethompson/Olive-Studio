import { Package } from "lucide-react";
import type { InspectorProps } from "./types";

export function OutputInspector({ state }: InspectorProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <h4 className="text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1">
          <Package className="h-3.5 w-3.5 text-emerald-400" />
          Finalized Optimized Deployment Runtime Package
        </h4>
        <p className="text-xs text-slate-400 leading-relaxed">
          Once compilation is executed, binary assets and runtime drivers are bundled for deployment.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4 border-l border-slate-800/50 pl-4 items-center">
        <div className="col-span-2 text-[10px] text-amber-400/90 font-mono uppercase tracking-wide bg-amber-500/5 border border-amber-500/15 rounded px-2 py-1">
          Simulated heuristics — not profiled. Run Olive for real metrics.
        </div>
        <div className="bg-slate-950 border border-slate-800 p-2.5 rounded text-center">
          <div className="text-[10px] text-slate-500 font-mono uppercase">Sim. Size (heuristic)</div>
          <div className="text-sm font-bold text-emerald-400 font-mono mt-0.5">
            {state.passes.quantization && state.passes.quantPrecision === "int4"
              ? "~1.40 GB"
              : state.passes.quantization && state.passes.quantPrecision === "int8"
                ? "~2.80 GB"
                : "~14.0 GB"}
          </div>
        </div>
        <div className="bg-slate-950 border border-slate-800 p-2.5 rounded text-center col-span-1">
          <div className="text-[10px] text-slate-500 font-mono uppercase">Sim. Latency (heuristic)</div>
          <div className="text-sm font-bold text-electric-blue/80 font-mono mt-0.5">
            {state.passes.quantization
              ? state.passes.quantPrecision === "int4"
                ? "~-84% (est.)"
                : "~-68% (est.)"
              : state.passes.pruning
                ? "~-34% (est.)"
                : "Not estimated"}
          </div>
        </div>
      </div>
    </div>
  );
}
