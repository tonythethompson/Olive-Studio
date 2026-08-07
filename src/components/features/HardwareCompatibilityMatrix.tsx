import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui";
import { IHVProvider, UIState } from "@/types";
import { prepareProviderChange } from "@/lib/pipelineValidation";
import { isProviderDetectedLocally, type HardwareProbeResult } from "@/lib/hardwareProbe";
import { PROVIDER_CATALOG } from "@/lib/providerCatalog";
import { getCellCompatibility, type OptimizationPassValidation } from "./IHVIntegrationPanel";
import {
  Check,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  Lock,
} from "lucide-react";

interface HardwareCompatibilityMatrixProps {
  selectableProviders: typeof PROVIDER_CATALOG;
  state: UIState;
  hardwareProbe: HardwareProbeResult | null;
  probeLoading: boolean;
  filteredValidations: OptimizationPassValidation[];
  detectedProviders: IHVProvider[];
  setState: (s: Partial<UIState>) => void;
}

export function HardwareCompatibilityMatrix({
  selectableProviders,
  state,
  hardwareProbe,
  probeLoading,
  filteredValidations,
  detectedProviders,
  setState,
}: HardwareCompatibilityMatrixProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-800/80 bg-slate-950/25 mt-2 shadow-xl animate-in fade-in duration-300">
      <div
        className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
        tabIndex={0}
        role="region"
        aria-label="Pass and execution provider compatibility matrix"
      >
        <table className="w-full text-left border-collapse min-w-[720px]">
          <thead>
            <tr className="border-b border-slate-800/80 bg-slate-900/30">
              {/* Header Cell 1 */}
              <th className="p-2 px-3 text-[10px] font-mono font-semibold tracking-wider text-slate-400 w-[200px]">
                PASS
              </th>

              {/* Hardware target columns */}
              {selectableProviders.map((p) => {
                const isSelectedProvider = p.id === state.ihvProvider;
                const HIcon = p.icon;
                const detectedLocally = isProviderDetectedLocally(p.id, hardwareProbe);

                return (
                  <th
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Select provider ${p.shortName}`}
                    aria-pressed={isSelectedProvider}
                    onClick={() => {
                      // Allow selecting undetected providers for cross-compile / remote targets
                      const detected = detectedProviders.includes(p.id);
                      const patch = prepareProviderChange(state, p.id, hardwareProbe, {
                        skipHardwareBlock: !detected,
                      });
                      if (patch) setState(patch);
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      const detected = detectedProviders.includes(p.id);
                      const patch = prepareProviderChange(state, p.id, hardwareProbe, {
                        skipHardwareBlock: !detected,
                      });
                      if (patch) setState(patch);
                    }}
                    className={`p-2 px-1 text-center cursor-pointer transition-all relative select-none ${
                      isSelectedProvider
                        ? "bg-electric-blue/10 border-l border-r border-t-2 border-t-electric-blue border-l-electric-blue/20 border-r-electric-blue/20"
                        : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/30"
                    }`}
                  >
                    <div className="flex flex-col items-center justify-center gap-1 py-1">
                      <div
                        className={`p-1 rounded border leading-none transition-all ${
                          isSelectedProvider
                            ? "bg-electric-blue/10 border-electric-blue/50 text-electric-blue"
                            : "bg-slate-900 border-slate-800 text-slate-500"
                        }`}
                      >
                        <HIcon className="h-3 w-3" />
                      </div>
                      <span
                        className={`text-[10px] font-mono font-semibold leading-none text-center ${
                          isSelectedProvider
                            ? "text-electric-blue"
                            : detectedLocally
                              ? "text-slate-400"
                              : "text-slate-600"
                        }`}
                      >
                        {p.shortName}
                      </span>
                      {!detectedLocally && !probeLoading && (
                        <span className="text-[7px] font-mono text-slate-600 uppercase tracking-wide leading-none">
                          Absent
                        </span>
                      )}
                      {detectedLocally && !isSelectedProvider && (
                        <span className="text-[7px] font-mono text-emerald-600 uppercase tracking-wide leading-none">
                          Local
                        </span>
                      )}
                      {isSelectedProvider ? (
                        <div className="flex items-center gap-1">
                          <span className="flex h-1.5 w-1.5 relative">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                          </span>
                          <span className="text-[8px] tracking-widest font-mono font-black uppercase text-electric-blue leading-none">
                            Active
                          </span>
                        </div>
                      ) : (
                        <span className="text-[8px] font-mono text-slate-700 uppercase tracking-wider leading-none select-none hover:text-slate-400">
                          Select
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {filteredValidations.map((v) => {
              const isActiveOnSelected = v.isActive(state.passes);

              return (
                <tr
                  key={v.id}
                  className="border-b border-slate-900 hover:bg-slate-900/10 transition-colors"
                >
                  {/* Column 1: Row Title and Category info */}
                  <td className="p-3 px-4 w-[min(100%,280px)] min-w-[220px] align-top">
                    <div className="space-y-2">
                      <span
                        className={`inline-block text-[9px] font-mono uppercase px-2 py-0.5 rounded border tracking-wider font-bold ${
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
                      <p className="text-sm font-semibold text-slate-100 leading-snug pr-2">
                        {v.name}
                      </p>
                      <p className="text-xs text-slate-400 leading-relaxed pr-2">{v.description}</p>
                    </div>
                  </td>

                  {/* Column 2-6: Dynamic hardware cells */}
                  {selectableProviders.map((p) => {
                    const isSelectedProvider = p.id === state.ihvProvider;
                    const comp = getCellCompatibility(v, p.id, state.passes);
                    const isCurrentlyActiveInCore = isSelectedProvider && isActiveOnSelected;

                    const handleCellClick = () => {
                      if (comp.status === "unsupported" || comp.status === "blocked") return;

                      if (isSelectedProvider) {
                        const updated = v.toggle(state.passes, isActiveOnSelected);
                        setState({ passes: { ...state.passes, ...updated } });
                        return;
                      }

                      const patch = prepareProviderChange(state, p.id, hardwareProbe);
                      if (!patch) return;
                      const basePasses = patch.passes ?? state.passes;
                      const finalPasses = { ...basePasses, ...v.toggle(basePasses, false) };
                      setState({ ...patch, passes: finalPasses });
                    };

                    return (
                      <td
                        key={p.id}
                        onClick={handleCellClick}
                        className={`p-2 text-center transition-all ${
                          isSelectedProvider
                            ? "bg-electric-blue/5 border-l border-r border-electric-blue/10"
                            : "hover:bg-slate-900/30"
                        } ${comp.status === "unsupported" || comp.status === "blocked" ? "cursor-not-allowed" : "cursor-pointer"}`}
                      >
                        <TooltipProvider delayDuration={150}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="inline-flex items-center justify-center p-1 cursor-help">
                                {comp.status === "supported" ? (
                                  isCurrentlyActiveInCore ? (
                                    <div className="flex h-6 items-center gap-1 p-1 px-3 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10.5px] font-mono font-medium">
                                      <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />{" "}
                                      Active
                                    </div>
                                  ) : (
                                    <div className="h-6 w-6 rounded-full bg-slate-900 border border-slate-800 hover:border-emerald-500/40 hover:bg-emerald-500/10 flex items-center justify-center text-slate-500 hover:text-emerald-400 hover:scale-110 active:scale-90 transition-all">
                                      <Check className="h-3.5 w-3.5" />
                                    </div>
                                  )
                                ) : comp.status === "partial" ? (
                                  isCurrentlyActiveInCore ? (
                                    <div className="flex h-6 items-center gap-1 p-1 px-3 rounded bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10.5px] font-mono font-medium">
                                      <AlertCircle className="h-3.5 w-3.5 text-amber-400" />{" "}
                                      Fallback
                                    </div>
                                  ) : (
                                    <div className="h-6 w-6 rounded-full bg-slate-900 border border-slate-800 hover:border-amber-500/40 hover:bg-amber-500/10 flex items-center justify-center text-slate-500 hover:text-amber-400 hover:scale-110 active:scale-90 transition-all">
                                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                                    </div>
                                  )
                                ) : comp.status === "blocked" ? (
                                  <div className="h-6 w-6 rounded-full bg-amber-950/40 border border-amber-500/25 flex items-center justify-center text-amber-400/80">
                                    <AlertTriangle className="h-3 w-3" />
                                  </div>
                                ) : (
                                  <div className="h-6 w-6 rounded-full bg-slate-950 border border-slate-900/60 flex items-center justify-center text-slate-700/60">
                                    <Lock className="h-3 w-3" />
                                  </div>
                                )}
                              </div>
                            </TooltipTrigger>

                            <TooltipContent
                              side="top"
                              className="max-w-[325px] bg-slate-950 border border-slate-800 text-slate-300 p-4 shadow-2xl leading-relaxed z-50"
                            >
                              <div className="space-y-3">
                                <div className="flex items-center justify-between border-b border-slate-900 pb-2">
                                  <span className="text-[9.5px] font-mono uppercase bg-slate-900 text-slate-400 px-2 py-0.5 rounded border border-slate-800">
                                    {p.name.replace(" (Snapdragon)", "")}
                                  </span>
                                  <span
                                    className={`text-[9.5px] font-mono font-extrabold uppercase tracking-wider px-2 py-0.5 rounded leading-none ${
                                      comp.status === "supported"
                                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                        : comp.status === "partial"
                                          ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                          : "bg-rose-500/10 text-rose-450 border border-rose-500/20"
                                    }`}
                                  >
                                    {comp.label}
                                  </span>
                                </div>

                                <div className="space-y-1">
                                  <p className="text-[11.5px] font-mono font-bold text-electric-blue uppercase tracking-wide">
                                    {v.name}
                                  </p>
                                  <p className="text-slate-400 text-xs leading-relaxed">
                                    {comp.reason}
                                  </p>
                                </div>

                                {/* Estimated heuristics — not measured on this machine */}
                                <div className="grid grid-cols-3 gap-1.5 border-t border-slate-900 pt-3">
                                  <div className="text-[10px] bg-slate-900/65 p-2 rounded-lg border border-slate-900 text-center font-mono">
                                    <span className="text-[8.5px] text-slate-500 block uppercase font-bold tracking-tight mb-1">
                                      Est. speed
                                    </span>
                                    <span
                                      className={`text-xs font-black block ${comp.status === "supported" ? "text-emerald-400" : "text-slate-350"}`}
                                    >
                                      {comp.speedup}
                                    </span>
                                  </div>
                                  <div className="text-[10px] bg-slate-900/65 p-2 rounded-lg border border-slate-900 text-center font-mono">
                                    <span className="text-[8.5px] text-slate-500 block uppercase font-bold tracking-tight mb-1">
                                      Est. VRAM
                                    </span>
                                    <span
                                      className={`text-xs font-black block ${comp.status === "supported" ? "text-emerald-400" : "text-slate-350"}`}
                                    >
                                      {comp.vram}
                                    </span>
                                  </div>
                                  <div className="text-[10px] bg-slate-900/65 p-2 rounded-lg border border-slate-900 text-center font-mono">
                                    <span className="text-[8.5px] text-slate-500 block uppercase font-bold tracking-tight mb-1">
                                      Heuristic
                                    </span>
                                    <span
                                      className={`text-xs font-black block ${comp.status === "supported" ? "text-electric-blue" : "text-slate-350"}`}
                                    >
                                      {comp.efficiency}
                                    </span>
                                  </div>
                                </div>

                                <div className="text-[10px] text-slate-500 font-sans border-t border-slate-900 pt-2.5 leading-snug">
                                  {comp.status === "unsupported"
                                    ? `${v.name} is completely incompatible with the target instruction architecture.`
                                    : isSelectedProvider
                                      ? `Click this column cell directly to toggle the ${v.name} pass ${isCurrentlyActiveInCore ? "OFF" : "ON"}.`
                                      : `Click to set acceleration to ${p.name} and configure this pipeline pass.`}
                                </div>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Matrix Footer Legend */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 border-t border-slate-900 bg-slate-900/20 text-[11px] text-slate-400">
        <div className="flex items-center gap-4 flex-wrap">
          <span className="text-xs text-slate-500">Legend</span>
          <span className="flex items-center gap-1.5 font-sans">
            <span className="h-3.5 w-3.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-400">
              <Check className="h-2 w-2" />
            </span>
            Optimized Acceleration Available
          </span>
          <span className="flex items-center gap-1.5 font-sans">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            CPU Fallback Emulation Modality
          </span>
          <span className="flex items-center gap-1.5 font-sans">
            <Lock className="h-3 w-3 text-slate-500" />
            Incompatible / Blocked on Chipset
          </span>
        </div>
        <div className="flex items-center gap-1 text-[10.5px] font-mono bg-slate-800/40 text-slate-400 border border-slate-700/60 p-1 px-2.5 rounded">
          {hardwareProbe
            ? `Hardware probed ${new Date(hardwareProbe.probedAt).toLocaleTimeString()} · pass rules + local EP detection`
            : "Client-side compatibility rules"}
        </div>
      </div>
    </div>
  );
}
