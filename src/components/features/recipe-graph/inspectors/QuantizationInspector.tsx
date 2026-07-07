import { Label, Select } from "@/components/ui";
import { getAllowedQuantMethods } from "@/lib/pipelineValidation";
import { UIState } from "@/types";
import type { InspectorProps } from "./types";

export function QuantizationInspector({ state, setState }: InspectorProps) {
  const allowedQuantMethods = getAllowedQuantMethods(state.ihvProvider);

  if (!state.passes.quantization) {
    return (
      <p className="text-sm text-slate-500 font-mono italic text-center py-4">
        Quantization is skipped — model stays in floating point (FP16/FP32).
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500">Pass settings</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="quant-target-precision" className="text-xs text-slate-400">Target precision</Label>
          <Select
            id="quant-target-precision"
            value={state.passes.quantPrecision}
            onChange={(e) =>
              setState({
                passes: { ...state.passes, quantPrecision: e.target.value as UIState["passes"]["quantPrecision"] },
              })
            }
            className="h-9 text-xs bg-slate-950"
          >
            <option value="int4">INT4 — maximum compression</option>
            <option value="int8">INT8 — balanced</option>
            <option value="fp16">FP16 — half precision</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="quant-method" className="text-xs text-slate-400">Method</Label>
          <Select
            id="quant-method"
            value={state.passes.quantMethod}
            onChange={(e) =>
              setState({
                passes: { ...state.passes, quantMethod: e.target.value as UIState["passes"]["quantMethod"] },
              })
            }
            className="h-9 text-xs bg-slate-950"
          >
            {allowedQuantMethods.includes("ptq") && (
              <option value="ptq">PTQ — post-training</option>
            )}
            {allowedQuantMethods.includes("awq") && (
              <option value="awq">AWQ — activation-aware</option>
            )}
            {allowedQuantMethods.includes("qat") && (
              <option value="qat">QAT — quantization-aware training</option>
            )}
          </Select>
        </div>
      </div>
    </div>
  );
}
