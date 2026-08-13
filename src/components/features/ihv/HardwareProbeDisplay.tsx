/**
 * Hardware probe status display showing detected CPU, GPU, RAM, drivers,
 * and ONNX Runtime execution providers. Includes a "Re-scan" button.
 */
import { RefreshCw, HardDrive } from "lucide-react";
import { formatMemoryGb } from "@/lib/vramEstimate";
import { prepareProviderChange } from "@/lib/pipelineValidation";
import { PROVIDER_CATALOG } from "@/lib/providerCatalog";
import type { HardwareProbeResult } from "@/lib/hardwareProbe";
import type { UIState } from "@/types";

const providers = PROVIDER_CATALOG;

export interface HardwareProbeDisplayProps {
  state: UIState;
  setState: (s: Partial<UIState>) => void;
  hardwareProbe: HardwareProbeResult | null;
  probeLoading: boolean;
  probeError: string | null;
  onRescan: () => void;
}

export function HardwareProbeDisplay({
  state,
  setState,
  hardwareProbe,
  probeLoading,
  probeError,
  onRescan,
}: HardwareProbeDisplayProps) {
  return (
    <div className="mb-6 rounded-xl border border-slate-800/80 bg-slate-950/40 p-4 min-w-0 overflow-hidden">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between min-w-0">
        <div className="space-y-2 min-w-0">
          <div className="flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-electric-blue shrink-0" />
            <h3 className="text-sm font-medium text-slate-200">Detected on this machine</h3>
            {probeLoading && <span className="text-[11px] font-mono text-slate-500">Scanning…</span>}
          </div>
          {probeError ? (
            <p className="text-sm text-rose-400 break-all">{probeError}</p>
          ) : hardwareProbe ? (
            <HardwareProbeDetails state={state} setState={setState} hardwareProbe={hardwareProbe} />
          ) : !probeLoading ? (
            <p className="text-sm text-slate-500">No hardware data yet.</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onRescan}
          disabled={probeLoading}
          className="flex items-center gap-1.5 self-start rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-600 hover:text-white disabled:opacity-50 cursor-pointer shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${probeLoading ? "animate-spin" : ""}`} />
          Re-scan hardware
        </button>
      </div>
    </div>
  );
}

interface HardwareProbeDetailsProps {
  state: UIState;
  setState: (s: Partial<UIState>) => void;
  hardwareProbe: HardwareProbeResult;
}

/** Detected CPU/GPU/runtime rows plus the recommended-EP nudge. Split out of
 * HardwareProbeDisplay to keep that component's branch count low. */
function HardwareProbeDetails({ state, setState, hardwareProbe }: HardwareProbeDetailsProps) {
  const showRecommendation = !hardwareProbe.detectedProviders?.includes(state.ihvProvider);

  return (
    <div className="space-y-1.5 text-sm text-slate-400">
      <p>
        <span className="text-slate-500">CPU:</span>{" "}
        <span className="text-slate-200">{hardwareProbe.platform.cpuModel}</span>
        <span className="text-slate-600">
          {" "}
          · {hardwareProbe.platform.cpuCores} cores · {hardwareProbe.platform.os} (
          {hardwareProbe.platform.arch})
        </span>
      </p>
      <p>
        <span className="text-slate-500">System RAM:</span>{" "}
        <span className="text-slate-200 font-mono">
          {hardwareProbe.platform.systemRamGb != null
            ? formatMemoryGb(hardwareProbe.platform.systemRamGb)
            : "Unknown"}
        </span>
      </p>
      {hardwareProbe.nvidia?.gpus.length ? (
        <p>
          <span className="text-slate-500">NVIDIA:</span>{" "}
          <span className="text-slate-200">
            {hardwareProbe.nvidia.gpus
              .map((g) => (g.vramMb ? `${g.name} (${formatMemoryGb(g.vramMb / 1024)})` : g.name))
              .join(", ")}
          </span>
          {hardwareProbe.nvidia.cudaVersion && (
            <span className="text-slate-600">
              {" "}
              · driver CUDA {hardwareProbe.nvidia.cudaVersion}
              {hardwareProbe.nvidia.cudaTag ? ` → ${hardwareProbe.nvidia.cudaTag}` : ""}
            </span>
          )}
        </p>
      ) : (
        <p>
          <span className="text-slate-500">NVIDIA:</span>{" "}
          <span className="text-slate-600">not detected</span>
        </p>
      )}
      {hardwareProbe.rocm?.gpus.length ? (
        <p>
          <span className="text-slate-500">AMD ROCm:</span>{" "}
          <span className="text-slate-200">
            {hardwareProbe.rocm.gpus
              .map((g) => (g.vramMb ? `${g.name} (${formatMemoryGb(g.vramMb / 1024)})` : g.name))
              .join(", ")}
          </span>
        </p>
      ) : null}
      {hardwareProbe.openvino?.loadable ? (
        <p>
          <span className="text-slate-500">OpenVINO:</span>{" "}
          <span className="text-slate-200">
            Python package v{hardwareProbe.openvino.version ?? "unknown"}
          </span>
        </p>
      ) : null}
      {hardwareProbe.onnxRuntimeProviders?.length ? (
        <p>
          <span className="text-slate-500">ONNX Runtime EPs:</span>{" "}
          <span className="font-mono text-xs text-emerald-400">
            {hardwareProbe.onnxRuntimeProviders.join(", ")}
          </span>
        </p>
      ) : null}
      {showRecommendation && (
        <p className="text-xs text-slate-500 pt-1">
          Recommended target:{" "}
          <span className="text-electric-blue font-semibold">
            {providers.find((p) => p.id === hardwareProbe.recommendedProvider)?.name ??
              hardwareProbe.recommendedProvider}
          </span>
          {state.ihvProvider !== hardwareProbe.recommendedProvider && (
            <button
              type="button"
              onClick={() => {
                const patch = prepareProviderChange(state, hardwareProbe.recommendedProvider, hardwareProbe);
                if (patch) setState(patch);
              }}
              className="ml-2 text-sm text-electric-blue hover:text-white cursor-pointer"
            >
              Apply
            </button>
          )}
        </p>
      )}
    </div>
  );
}
