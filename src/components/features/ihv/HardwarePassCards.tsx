import { Switch } from "@/components/ui/Switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/Tooltip";
import { UIState } from "@/types";
import { getQuantMethodActivationBlock } from "@/lib/pipelineValidation";
import { PROVIDER_CATALOG } from "@/lib/providerCatalog";
import {
  QUANT_METHOD_BY_PASS_ID,
  type OptimizationPassValidation,
} from "./hardwarePassCompatibility";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Lock,
} from "lucide-react";

interface HardwarePassCardsProps {
  filteredValidations: OptimizationPassValidation[];
  state: UIState;
  setState: (s: Partial<UIState>) => void;
}

/**
 * Interactive card grid for toggling optimization passes on the selected provider.
 * Extracted from IHVIntegrationPanel's "Interactive Cards" tab.
 */
export function HardwarePassCards({
  filteredValidations,
  state,
  setState,
}: HardwarePassCardsProps) {
  return (
    <TooltipProvider delayDuration={150}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2 animate-in fade-in">
        {filteredValidations.map((v) => {
          const isUnsupportedOnCurrent = v.isUnsupported(state.ihvProvider);
          const quantMethod = QUANT_METHOD_BY_PASS_ID[v.id];
          const configBlock =
            quantMethod != null
              ? getQuantMethodActivationBlock(quantMethod, state.passes, state.ihvProvider)
              : null;
          const isBlockedByConfig = !isUnsupportedOnCurrent && configBlock !== null;
          const isActiveState = v.isActive(state.passes);
          const reason = v.getIncompatibilityReason(state.ihvProvider);
          const toggleDisabled = isUnsupportedOnCurrent || isBlockedByConfig;

          return (
            <div
              key={v.id}
              className={`flex flex-col justify-between p-4.5 rounded-xl border transition-all relative overflow-hidden ${
                isUnsupportedOnCurrent || isBlockedByConfig
                  ? "bg-slate-950/40 border-slate-900/60 opacity-40 shadow-none hover:border-slate-800/40"
                  : isActiveState
                    ? "bg-electric-blue/5 border-electric-blue/40 shadow-[0_2px_12px_rgba(59,130,246,0.02)] hover:border-electric-blue/60"
                    : "bg-slate-900/30 border-slate-800/80 hover:bg-slate-900/65 hover:border-slate-700"
              }`}
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-2">
                    <span
                      className={`inline-block text-[9px] uppercase font-mono px-2 py-0.5 rounded border tracking-wider font-bold ${
                        v.category === "Conversion"
                          ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                          : v.category === "Quantization"
                            ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                            : v.category === "Compression"
                              ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                              : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                      }`}
                    >
                      {v.category}
                    </span>
                    <h5
                      className={`text-sm font-semibold leading-snug ${
                        isUnsupportedOnCurrent ? "text-slate-500" : "text-slate-100"
                      }`}
                    >
                      {v.name}
                    </h5>
                  </div>

                  {isUnsupportedOnCurrent ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="cursor-help shrink-0 p-1 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-lg flex items-center gap-1 text-[11px] font-mono font-bold px-2 py-0.5 leading-none">
                          <Lock className="h-3 w-3" /> Incompatible
                        </div>
                      </TooltipTrigger>
                      <TooltipContent
                        side="top"
                        className="max-w-[280px] bg-slate-950 border border-slate-800 text-slate-300 p-3 shadow-xl leading-relaxed"
                      >
                        <div className="space-y-1">
                          <p className="font-bold text-rose-400 flex items-center gap-1 text-sm">
                            <AlertCircle className="h-3.5 w-3.5" /> Hardware Incompatibility
                          </p>
                          <p className="text-slate-200 font-semibold">{reason}</p>
                          <p className="text-slate-450 border-t border-slate-900 pt-1 mt-1 text-xs font-sans leading-normal">
                            {v.requiresExplanation}
                          </p>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  ) : isBlockedByConfig ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="cursor-help shrink-0 p-1 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg flex items-center gap-1 text-[11px] font-mono font-bold px-2 py-0.5 leading-none">
                          <AlertTriangle className="h-3 w-3" /> Blocked
                        </div>
                      </TooltipTrigger>
                      <TooltipContent
                        side="top"
                        className="max-w-[280px] bg-slate-950 border border-slate-800 text-slate-300 p-3 shadow-xl leading-relaxed"
                      >
                        <div className="space-y-1">
                          <p className="font-bold text-amber-400 flex items-center gap-1 text-sm">
                            <AlertCircle className="h-3.5 w-3.5" /> Active pipeline conflict
                          </p>
                          <p className="text-slate-200 font-semibold">{configBlock?.reason}</p>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    <span
                      className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-lg border flex items-center gap-1 leading-none shrink-0 ${
                        isActiveState
                          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                          : "bg-slate-850/40 border-slate-800 text-slate-500"
                      }`}
                    >
                      {isActiveState ? (
                        <>
                          <CheckCircle className="h-3 w-3" /> Enabled
                        </>
                      ) : (
                        "Inactive"
                      )}
                    </span>
                  )}
                </div>

                <p
                  className={`text-sm text-slate-400 leading-relaxed ${isUnsupportedOnCurrent ? "text-slate-600" : ""}`}
                >
                  {v.description}
                </p>
                <p className="text-xs text-slate-500 leading-relaxed border-l border-slate-800 pl-3">
                  <span className="text-slate-400 font-medium">Note: </span>
                  {v.requiresExplanation}
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-900/60 flex items-center justify-between">
                <span className="text-[11px] font-mono text-slate-500 font-medium">
                  {isUnsupportedOnCurrent
                    ? v.id === "awq-quantization"
                      ? "Requires CUDA, TensorRT, or ROCm — switch hardware target above"
                      : "Pass locked on current backend"
                    : isBlockedByConfig
                      ? "Resolve the conflict in Optimization passes first"
                      : `Direct toggle on ${PROVIDER_CATALOG.find((p) => p.id === state.ihvProvider)?.name}`}
                </span>
                <Switch
                  aria-label={`Toggle ${v.name} pass`}
                  disabled={toggleDisabled}
                  checked={toggleDisabled ? false : isActiveState}
                  onCheckedChange={(checked) => {
                    if (toggleDisabled) return;
                    const updated = v.toggle(state.passes, !checked);
                    setState({ passes: { ...state.passes, ...updated } });
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
