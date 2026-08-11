import { useMemo, useSyncExternalStore } from "react";
import { Label, Select } from "@/components/ui";
import { getProviderAvailabilityBlock, getSelectableProviders } from "@/lib/hardwareProbe";
import { useHardwareProbe } from "@/lib/hooks/useHardwareProbe";
import { prepareProviderChange } from "@/lib/pipelineValidation";
import {
  navigatePipeline,
  isPipelineOliveRunning,
  subscribePipelineOliveRunning,
  PIPELINE_NAV_BLOCKED_MESSAGE,
} from "@/lib/pipelineNavigation";
import { PROVIDER_CATALOG } from "@/lib/providerCatalog";
import { UIState } from "@/types";
import { AlertTriangle, Cpu as TargetIcon, Loader2 } from "lucide-react";
import type { InspectorProps } from "./types";

/**
 * Selects the active hardware execution provider and displays its availability.
 *
 * @param state - The current interface state.
 * @param setState - Applies updates to the interface state.
 */
export function ProviderInspector({ state, setState }: InspectorProps) {
  const { data: hardwareProbe = null, isLoading: probeLoading } = useHardwareProbe();

  const selectableProviders = useMemo(
    () => PROVIDER_CATALOG.filter((provider) => getSelectableProviders(hardwareProbe).includes(provider.id)),
    [hardwareProbe],
  );

  const providerOptions = useMemo(() => {
    if (selectableProviders.some((p) => p.id === state.ihvProvider)) {
      return selectableProviders;
    }
    const current = PROVIDER_CATALOG.find((p) => p.id === state.ihvProvider);
    return current ? [current, ...selectableProviders] : selectableProviders;
  }, [selectableProviders, state.ihvProvider]);

  const currentHardwareBlock = getProviderAvailabilityBlock(state.ihvProvider, hardwareProbe);
  const ihvNavBlocked = useSyncExternalStore(subscribePipelineOliveRunning, isPipelineOliveRunning);

  const handleProviderChange = (nextProvider: UIState["ihvProvider"]) => {
    if (nextProvider === state.ihvProvider) {
      return;
    }
    const patch = prepareProviderChange(state, nextProvider, hardwareProbe);
    if (patch) {
      setState(patch);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <h4 className="text-sm font-semibold text-slate-300 mb-1 flex items-center gap-1">
          <TargetIcon className="h-3.5 w-3.5 text-electric-blue" />
          Target Hardware System Accelerator
        </h4>
        <p className="text-sm text-slate-400 leading-relaxed">
          Only execution providers detected on this machine are listed. Cross-compile targets are not
          selectable here.
        </p>
        <button
          type="button"
          onClick={() => navigatePipeline("ihv")}
          disabled={ihvNavBlocked}
          title={ihvNavBlocked ? PIPELINE_NAV_BLOCKED_MESSAGE : undefined}
          aria-disabled={ihvNavBlocked}
          className={`mt-2 text-[11px] underline underline-offset-2 ${
            ihvNavBlocked
              ? "text-slate-600 cursor-not-allowed no-underline"
              : "text-electric-blue hover:text-white cursor-pointer"
          }`}
        >
          Full hardware options in step 02
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 border-l border-slate-800/50 pl-4">
        <div>
          <Label htmlFor="graph-provider-driver" className="text-[11px] font-mono text-slate-400">
            Active Platform Driver
          </Label>
          <Select
            id="graph-provider-driver"
            value={state.ihvProvider}
            onChange={(e) => handleProviderChange(e.target.value as UIState["ihvProvider"])}
            className="h-8 text-sm bg-slate-950"
            disabled={probeLoading}
          >
            {probeLoading ? (
              <option value={state.ihvProvider}>Detecting hardware…</option>
            ) : (
              providerOptions.map((provider) => {
                const unavailable = !getSelectableProviders(hardwareProbe).includes(provider.id);
                return (
                  <option key={provider.id} value={provider.id} disabled={unavailable}>
                    {provider.name}
                    {unavailable ? ", not on this machine" : ""}
                  </option>
                );
              })
            )}
          </Select>
          {probeLoading && (
            <p className="mt-1.5 text-[11px] text-slate-500 flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" />
              Probing local GPUs and runtimes…
            </p>
          )}
        </div>
        {currentHardwareBlock && (
          <div className="flex items-start gap-2 rounded border border-rose-500/30 bg-rose-950/20 px-2.5 py-2">
            <AlertTriangle className="h-3.5 w-3.5 text-rose-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-rose-300 leading-relaxed">{currentHardwareBlock.reason}</p>
          </div>
        )}
        {!probeLoading && selectableProviders.length <= 1 && (
          <p className="text-[11px] font-mono text-amber-400/90">
            Only CPU was detected. Install CUDA, OpenVINO, or ROCm runtimes to unlock more targets.
          </p>
        )}
        <p className="text-[11px] font-mono text-slate-500">
          Hybrid offload, CUDA version, and provider matrix live in step 02.
        </p>
      </div>
    </div>
  );
}
