import { Label, Select, Switch } from "@/components/ui";
import { getAllowedPeftMethods, isPeftAllowed } from "@/lib/pipelineValidation";
import { getPeftBlockReason, isDiffusionModel } from "@/lib/modelFamily";
import { UIState } from "@/types";
import { Fingerprint, Layers } from "lucide-react";
import type { InspectorProps } from "./types";

export function PeftInspector({ state, setState }: InspectorProps) {
  const peftAllowed = isPeftAllowed(state.ihvProvider);
  const allowedPeftMethods = getAllowedPeftMethods(state.ihvProvider);
  const showDiffusionLora = isDiffusionModel(state);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <h4 className="text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1">
          <Layers className="h-3.5 w-3.5 text-electric-blue" />
          Parameter-Efficient Fine-Tuning (PEFT)
        </h4>
        <p className="text-xs text-slate-400 leading-relaxed">
          Applies custom LoRA or QLoRA adapter layers to freeze the base model parameters while adding a
          small pool of trainable weights.
        </p>
        {!peftAllowed && (
          <span className="inline-block mt-2 text-[10px] font-mono text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded">
            {getPeftBlockReason(state.ihvProvider)}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 border-l border-slate-800/50 pl-4">
        {!peftAllowed ? (
          <div className="col-span-2 flex items-center justify-center text-xs text-slate-500 font-mono italic text-center px-4">
            PEFT is not supported on the selected execution provider. Change target in step 02 or the
            provider node below.
          </div>
        ) : state.passes.peft ? (
          <>
            <div>
              <Label htmlFor="peft-tuning-method" className="text-[10px] font-mono text-slate-400">Tuning Method</Label>
              <Select
                id="peft-tuning-method"
                value={state.passes.peftMethod}
                onChange={(e) =>
                  setState({ passes: { ...state.passes, peftMethod: e.target.value as UIState["passes"]["peftMethod"] } })
                }
                className="h-8 text-xs bg-slate-950"
              >
                {allowedPeftMethods.includes("lora") && (
                  <option value="lora">LoRA Standard Adapters</option>
                )}
                {allowedPeftMethods.includes("qlora") && (
                  <option value="qlora">QLoRA Quantized Adapters</option>
                )}
              </Select>
            </div>
            <div className="bg-slate-950 border border-slate-900/60 p-2.5 rounded text-center">
              <div className="text-[10px] text-slate-500 font-mono uppercase">Trainable Params</div>
              <div className="text-xs font-bold text-electric-blue font-mono mt-0.5">~0.08% Coefs</div>
            </div>
            {showDiffusionLora && (
              <div className="col-span-2 pt-2 border-t border-slate-800/60">
                <div className="flex items-center gap-2">
                  <Switch
                    id="diffusionLora"
                    checked={state.passes.diffusionLora}
                    onCheckedChange={(v) => setState({ passes: { ...state.passes, diffusionLora: v } })}
                  />
                  <Label htmlFor="diffusionLora" className="flex items-center gap-2 text-xs text-slate-300">
                    Diffusion LoRA mode
                    <Fingerprint className="w-3.5 h-3.5 text-electric-blue" />
                  </Label>
                </div>
                <p className="text-[10px] text-slate-500 mt-1 pl-10">
                  Specialized UNet/Text Encoder extraction for Stable Diffusion, SDXL, and Flux.
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="col-span-2 flex items-center justify-center text-xs text-slate-500 font-mono italic">
            PEFT adapter tuning is bypassed. Model weights are static baseline.
          </div>
        )}
      </div>
    </div>
  );
}
