import { Label, Select, Slider, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui";
import { getAllowedPruningTypes } from "@/lib/pipelineValidation";
import { UIState } from "@/types";
import { Info } from "lucide-react";
import type { InspectorProps } from "./types";

export function PruningInspector({ state, setState }: InspectorProps) {
  const allowedPruningTypes = getAllowedPruningTypes(state.ihvProvider);
  const awqBlocksPruning = state.passes.quantMethod === "awq";

  if (!state.passes.pruning) {
    return (
      <p className="text-sm text-slate-500 font-mono italic text-center py-4">
        Pruning is skipped — weights stay dense.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {awqBlocksPruning && (
        <p className="text-xs text-amber-500/90 leading-relaxed rounded border border-amber-500/20 bg-amber-950/20 px-3 py-2">
          AWQ is active — pruning cannot run until you switch to PTQ or disable quantization.
        </p>
      )}
      <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500">Pass settings</p>
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <Label className="text-xs text-slate-400 flex items-center gap-1.5">
            Sparsity ratio
            <TooltipProvider delayDuration={100}>
              <Tooltip>
                <TooltipTrigger type="button" className="cursor-help text-slate-500 hover:text-slate-300">
                  <Info className="h-3.5 w-3.5" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>Fraction of weights set to zero. Higher = smaller model, more accuracy risk.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </Label>
          <span className="text-sm font-bold text-amber-400 font-mono tabular-nums">
            {(state.passes.pruningSparsity * 100).toFixed(0)}%
          </span>
        </div>
        <Slider
          value={[state.passes.pruningSparsity]}
          onValueChange={(val) => setState({ passes: { ...state.passes, pruningSparsity: val[0] } })}
          min={0}
          max={0.99}
          step={0.01}
          className="py-2"
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="pruning-method" className="text-xs text-slate-400">Method</Label>
          <Select
            id="pruning-method"
            value={state.passes.pruningMethod}
            onChange={(e) =>
              setState({
                passes: { ...state.passes, pruningMethod: e.target.value as UIState["passes"]["pruningMethod"] },
              })
            }
            className="h-9 text-xs bg-slate-950"
          >
            <option value="sparsegpt">SparseGPT</option>
            <option value="wanda">Wanda</option>
            <option value="magnitude">Magnitude (L1/L2)</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pruning-pattern" className="text-xs text-slate-400">Sparsity pattern</Label>
          <Select
            id="pruning-pattern"
            value={state.passes.pruningType}
            onChange={(e) =>
              setState({
                passes: { ...state.passes, pruningType: e.target.value as UIState["passes"]["pruningType"] },
              })
            }
            className="h-9 text-xs bg-slate-950"
          >
            {allowedPruningTypes.includes("unstructured") && (
              <option value="unstructured">Unstructured</option>
            )}
            {allowedPruningTypes.includes("structured") && (
              <option value="structured">Structured 2:4</option>
            )}
          </Select>
        </div>
        {state.passes.pruningMethod === "magnitude" && (
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="pruning-criteria" className="text-xs text-slate-400">Pruning criteria</Label>
            <Select
              id="pruning-criteria"
              value={state.passes.pruningCriteria}
              onChange={(e) =>
                setState({
                  passes: {
                    ...state.passes,
                    pruningCriteria: e.target.value as UIState["passes"]["pruningCriteria"],
                  },
                })
              }
              className="h-9 text-xs bg-slate-950 max-w-xs"
            >
              <option value="l1_norm">L1 norm</option>
              <option value="l2_norm">L2 norm</option>
            </Select>
          </div>
        )}
      </div>
    </div>
  );
}
