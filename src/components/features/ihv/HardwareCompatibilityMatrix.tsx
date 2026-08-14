import { useMemo, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/Tooltip";
import { IHVProvider, UIState } from "@/types";
import { prepareProviderChange } from "@/lib/pipelineValidation";
import { isProviderDetectedLocally, type HardwareProbeResult } from "@/lib/hardwareProbe";
import { PROVIDER_CATALOG } from "@/lib/providerCatalog";
import { cn } from "@/lib/utils";
import {
  getCellCompatibility,
  type OptimizationPassValidation,
} from "./hardwarePassCompatibility";
import {
  Check,
  Lock,
} from "lucide-react";

type CellCompatStatus = "supported" | "partial" | "unsupported" | "blocked";

function getPassStatusButtonLabel(status: CellCompatStatus, isActive: boolean): string {
  if (status === "unsupported") return "Unsupported";
  if (status === "blocked") return "Blocked";
  if (!isActive) return "Enable";
  if (status === "partial") return "Fallback";
  return "Active";
}

function PassStatusBadge({
  status,
  color,
  isActive,
  disabled,
}: {
  status: CellCompatStatus;
  color: string;
  isActive: boolean;
  disabled: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-7 min-w-[4.5rem] items-center justify-center rounded border px-2 text-[10.5px] font-mono font-medium transition-all",
        color,
        disabled && "opacity-60 cursor-not-allowed",
        !disabled && !isActive && "hover:brightness-110 active:scale-95 cursor-pointer",
      )}
    >
      {getPassStatusButtonLabel(status, isActive)}
    </span>
  );
}

interface HardwareCompatibilityMatrixProps {
  selectableProviders: typeof PROVIDER_CATALOG;
  state: UIState;
  hardwareProbe: HardwareProbeResult | null;
  probeLoading: boolean;
  filteredValidations: OptimizationPassValidation[];
  detectedProviders: IHVProvider[];
  setState: (s: Partial<UIState>) => void;
}

/**
 * Displays a selectable compatibility matrix for optimization passes across hardware providers.
 *
 * @param selectableProviders - Providers available for selection in the matrix.
 * @param state - Current provider and optimization-pass configuration.
 * @param hardwareProbe - Hardware detection results used to indicate local provider availability.
 * @param probeLoading - Whether hardware detection is still in progress.
 * @param filteredValidations - Optimization passes to display.
 * @param detectedProviders - Provider identifiers detected on the local machine.
 * @param setState - Updates the provider and pass configuration.
 */
export function HardwareCompatibilityMatrix({
  selectableProviders,
  state,
  hardwareProbe,
  probeLoading,
  filteredValidations,
  detectedProviders,
  setState,
}: HardwareCompatibilityMatrixProps) {
  const [showAllProviders, setShowAllProviders] = useState(false);
  const selectedProviderId = state.ihvProvider;

  const detectedOrSelectedProviders = useMemo(
    () =>
      selectableProviders.filter(
        (p) => p.id === selectedProviderId || isProviderDetectedLocally(p.id, hardwareProbe),
      ),
    [selectableProviders, selectedProviderId, hardwareProbe],
  );
  // Filtering is available when the detected/selected subset is non-empty and
  // smaller than the full catalog. Gate the toolbar on that, not on the current
  // visible length, so "Show all" does not unmount the "Show detected only" control.
  const canFilterProviders =
    detectedOrSelectedProviders.length > 0 &&
    detectedOrSelectedProviders.length < selectableProviders.length;
  const visibleProviders =
    showAllProviders || detectedOrSelectedProviders.length === 0
      ? selectableProviders
      : detectedOrSelectedProviders;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="overflow-hidden rounded-xl border border-slate-800/80 bg-slate-950/25 mt-2 shadow-xl animate-in fade-in duration-300">
        {canFilterProviders && (
          <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-slate-800/80 bg-slate-900/40">
            <span className="text-xs text-slate-500 truncate">
              {showAllProviders ? "Showing all providers" : "Showing detected & selected providers"}
            </span>
            <button
              type="button"
              onClick={() => setShowAllProviders((v) => !v)}
              className="text-xs font-medium text-electric-blue hover:text-electric-blue/80 transition-colors cursor-pointer shrink-0"
            >
              {showAllProviders ? "Show detected only" : "Show all providers"}
            </button>
          </div>
        )}
        <div
          className="max-h-[560px] overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
          tabIndex={0}
          role="region"
          aria-label="Pass and execution provider compatibility matrix"
        >
          <table className="w-full text-left border-collapse min-w-[720px]">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-slate-800/80 bg-slate-900">
                {/* Header Cell 1 */}
                <th className="p-2 px-3 text-[11px] font-mono font-semibold tracking-wider text-slate-400 w-[200px]">
                  PASS
                </th>

                {/* Hardware target columns */}
                {visibleProviders.map((p) => {
                  const isSelectedProvider = p.id === state.ihvProvider;
                  const HIcon = p.icon;
                  const detectedLocally = isProviderDetectedLocally(p.id, hardwareProbe);

                  return (
                    <th
                      key={p.id}
                      scope="col"
                      className={`p-0 text-center transition-all relative select-none ${
                        isSelectedProvider
                          ? "bg-electric-blue/10 border-l border-r border-t-2 border-t-electric-blue border-l-electric-blue/20 border-r-electric-blue/20"
                          : "text-slate-400"
                      }`}
                    >
                      <button
                        type="button"
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
                        className={`w-full h-full p-2 px-1 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${
                          isSelectedProvider ? "" : "hover:text-slate-200 hover:bg-slate-900/30"
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
                            className={`text-[11px] font-mono font-semibold leading-none text-center ${
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
                      </button>
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
                        <p className="text-sm text-slate-400 leading-relaxed pr-2">{v.description}</p>
                      </div>
                    </td>

                    {/* Column 2-6: Dynamic hardware cells */}
                    {visibleProviders.map((p) => {
                      const isSelectedProvider = p.id === state.ihvProvider;
                      const comp = getCellCompatibility(v, p.id, state.passes);
                      const isCurrentlyActiveInCore = isSelectedProvider && isActiveOnSelected;
                      const cellDisabled =
                        comp.status === "unsupported" || comp.status === "blocked";

                      const handleCellClick = () => {
                        if (cellDisabled) return;

                        if (isSelectedProvider) {
                          const updated = v.toggle(state.passes, isActiveOnSelected);
                          setState({ passes: { ...state.passes, ...updated } });
                          return;
                        }

                        const detected = detectedProviders.includes(p.id);
                        const patch = prepareProviderChange(state, p.id, hardwareProbe, {
                          skipHardwareBlock: !detected,
                        });
                        if (!patch) return;
                        const basePasses = patch.passes ?? state.passes;
                        const finalPasses = { ...basePasses, ...v.toggle(basePasses, false) };
                        setState({ ...patch, passes: finalPasses });
                      };

                      return (
                        <td
                          key={p.id}
                          className={`p-2 text-center transition-all ${
                            isSelectedProvider
                              ? "bg-electric-blue/5 border-l border-r border-electric-blue/10"
                              : "hover:bg-slate-900/30"
                          }`}
                        >
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div
                                tabIndex={0}
                                className={`inline-flex w-full items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${
                                  cellDisabled ? "cursor-not-allowed" : "cursor-pointer"
                                }`}
                                onKeyDown={(e) => {
                                  if (cellDisabled) return;
                                  if (e.key !== "Enter" && e.key !== " ") return;
                                  e.preventDefault();
                                  handleCellClick();
                                }}
                              >
                              <button
                                type="button"
                                tabIndex={-1}
                                disabled={cellDisabled}
                                onClick={handleCellClick}
                                aria-label={
                                  isSelectedProvider
                                    ? `Toggle ${v.name} on ${p.shortName}`
                                    : `Select ${p.shortName} and enable ${v.name}`
                                }
                                className="inline-flex w-full items-center justify-center p-1 disabled:opacity-100"
                              >
                                <PassStatusBadge
                                  status={comp.status}
                                  color={comp.color}
                                  isActive={isCurrentlyActiveInCore}
                                  disabled={cellDisabled}
                                />
                              </button>
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
                                          : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                                    }`}
                                  >
                                    {comp.label}
                                  </span>
                                </div>

                                <div className="space-y-1">
                                  <p className="text-[11.5px] font-mono font-bold text-electric-blue uppercase tracking-wide">
                                    {v.name}
                                  </p>
                                  <p className="text-slate-400 text-sm leading-relaxed">
                                    {comp.reason}
                                  </p>
                                </div>

                                {/* Estimated heuristics — not measured on this machine */}
                                <div className="grid grid-cols-3 gap-1.5 border-t border-slate-900 pt-3">
                                  <div className="text-[11px] bg-slate-900/65 p-2 rounded-lg border border-slate-900 text-center font-mono">
                                    <span className="text-[8.5px] text-slate-500 block uppercase font-bold tracking-tight mb-1">
                                      Est. speed
                                    </span>
                                    <span
                                      className={`text-sm font-black block ${comp.status === "supported" ? "text-emerald-400" : "text-slate-400"}`}
                                    >
                                      {comp.speedup}
                                    </span>
                                  </div>
                                  <div className="text-[11px] bg-slate-900/65 p-2 rounded-lg border border-slate-900 text-center font-mono">
                                    <span className="text-[8.5px] text-slate-500 block uppercase font-bold tracking-tight mb-1">
                                      Est. VRAM
                                    </span>
                                    <span
                                      className={`text-sm font-black block ${comp.status === "supported" ? "text-emerald-400" : "text-slate-400"}`}
                                    >
                                      {comp.vram}
                                    </span>
                                  </div>
                                  <div className="text-[11px] bg-slate-900/65 p-2 rounded-lg border border-slate-900 text-center font-mono">
                                    <span className="text-[8.5px] text-slate-500 block uppercase font-bold tracking-tight mb-1">
                                      Heuristic
                                    </span>
                                    <span
                                      className={`text-sm font-black block ${comp.status === "supported" ? "text-electric-blue" : "text-slate-400"}`}
                                    >
                                      {comp.efficiency}
                                    </span>
                                  </div>
                                </div>

                                <div className="text-[11px] text-slate-500 font-sans border-t border-slate-900 pt-2.5 leading-snug">
                                  {comp.status === "unsupported"
                                    ? `${v.name} is completely incompatible with the target instruction architecture.`
                                    : isSelectedProvider
                                      ? `Click this column cell directly to toggle the ${v.name} pass ${isCurrentlyActiveInCore ? "OFF" : "ON"}.`
                                      : `Click to set acceleration to ${p.name} and configure this pipeline pass.`}
                                </div>
                              </div>
                            </TooltipContent>
                          </Tooltip>
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
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 border-t border-slate-900 bg-slate-900/20 text-xs text-slate-400">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-sm text-slate-500">Legend</span>
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
    </TooltipProvider>
  );
}
