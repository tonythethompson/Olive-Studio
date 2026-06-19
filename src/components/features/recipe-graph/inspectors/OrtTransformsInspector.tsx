import { Check, Layers } from "lucide-react";
import type { InspectorProps } from "./types";

export function OrtTransformsInspector({ state }: InspectorProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <h4 className="text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1">
          <Layers className="h-3.5 w-3.5 text-slate-400" />
          ONNX Runtime Layout Fusion Operators
        </h4>
        <p className="text-xs text-slate-400 leading-relaxed">
          Combines individual operators into highly-optimized unified kernels for target accelerators.
        </p>
      </div>
      <div className="border-l border-slate-800/50 pl-4 flex flex-col justify-center">
        {state.passes.onnxTransforms ? (
          <div className="p-3 bg-slate-950/80 rounded border border-slate-800 flex items-center gap-3">
            <div className="p-1.5 rounded-full bg-slate-800/50">
              <Check className="h-4 w-4 text-slate-400" />
            </div>
            <div className="flex-1">
              <div className="text-xs font-bold text-slate-200">Active Stage Fusions</div>
              <div className="text-[10px] text-slate-400 leading-tight">
                Attention blocks, bias layernorms, and softmax routines fused dynamically.
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center text-xs text-slate-500 font-mono italic">
            ORT Optimization passes are disabled. Computational graphs preserve base node steps.
          </div>
        )}
      </div>
    </div>
  );
}
