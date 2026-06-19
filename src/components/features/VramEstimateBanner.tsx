import { useEffect, useMemo, useState } from "react";
import { UIState } from "@/types";
import { fetchHardwareProbe, type HardwareProbeResult } from "@/lib/hardwareProbe";
import {
  compareVramFit,
  estimateVramRequirement,
  formatMemoryGb,
  getHybridMemoryPoolGb,
  getSelectedGpuVramGb,
  getVramModelLabel,
  getVramModelShortName,
  isGpuProvider,
} from "@/lib/vramEstimate";
import { isMemoryOffloadActive } from "@/lib/memoryOffload";
import { ModelMemoryCompare } from "@/components/features/ModelMemoryCompare";
import { cn } from "@/lib/utils";
import { HardDrive } from "lucide-react";

interface VramEstimateBannerProps {
  state: UIState;
  hardwareProbe?: HardwareProbeResult | null;
  compact?: boolean;
  sidebar?: boolean;
  className?: string;
}

export function VramEstimateBanner({
  state,
  hardwareProbe: hardwareProbeProp,
  compact = false,
  sidebar = false,
  className,
}: VramEstimateBannerProps) {
  const [hardwareProbe, setHardwareProbe] = useState<HardwareProbeResult | null>(
    hardwareProbeProp ?? null,
  );

  useEffect(() => {
    if (hardwareProbeProp !== undefined) {
      const missingRam =
        hardwareProbeProp != null &&
        (hardwareProbeProp.platform.systemRamGb == null ||
          hardwareProbeProp.platform.systemRamGb <= 0);
      if (missingRam) {
        void fetchHardwareProbe(true)
          .then(setHardwareProbe)
          .catch(() => setHardwareProbe(hardwareProbeProp));
        return;
      }
      setHardwareProbe(hardwareProbeProp);
      return;
    }
    void fetchHardwareProbe()
      .then(setHardwareProbe)
      .catch(() => setHardwareProbe(null));
  }, [hardwareProbeProp]);

  const estimate = useMemo(() => estimateVramRequirement(state), [state]);
  const modelLabel = useMemo(() => getVramModelLabel(state), [state]);
  const modelShortName = useMemo(() => getVramModelShortName(state), [state]);
  const beforeGb = estimate.sourceWeightGb;
  const afterGb = estimate.inferenceGb;

  const availableGb = getSelectedGpuVramGb(hardwareProbe, state.ihvProvider);
  const systemRamGb = hardwareProbe?.platform.systemRamGb ?? null;
  const offloadActive = isMemoryOffloadActive(state);
  const hybridPoolGb =
    availableGb != null && systemRamGb != null
      ? getHybridMemoryPoolGb(availableGb, systemRamGb)
      : null;

  const inferenceFit =
    estimate.usesGpu && availableGb != null
      ? compareVramFit(estimate.inferenceGb, availableGb)
      : "unknown";
  const runFit =
    estimate.usesGpu && (offloadActive ? hybridPoolGb != null : availableGb != null)
      ? compareVramFit(
          estimate.peakRunGb,
          offloadActive ? hybridPoolGb! : availableGb!,
        )
      : "unknown";

  const fitLabel =
    inferenceFit === "fits" ? "Optimized model fits GPU"
    : inferenceFit === "tight" ? "Tight fit (optimized)"
    : inferenceFit === "insufficient" ? "Optimized model may exceed GPU"
    : null;

  const fitClass =
    inferenceFit === "fits" ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/5"
    : inferenceFit === "tight" ? "text-amber-400 border-amber-500/30 bg-amber-500/5"
    : inferenceFit === "insufficient" ? "text-rose-400 border-rose-500/30 bg-rose-500/5"
    : "";

  const runMayExceedGpu =
    runFit === "insufficient" || runFit === "tight";
  const showOffloadGuidance =
    estimate.usesGpu &&
    availableGb != null &&
    (inferenceFit === "insufficient" || runFit === "insufficient");

  const offloadGuidance =
    offloadActive
      ? "GPU + CPU RAM offload is enabled via Hugging Face device_map for this run."
      : "GPU runs do not automatically offload to system RAM. Enable hybrid offload in Hardware (Hugging Face models) or use quantization / CPU target.";

  const showRunWarning =
    estimate.usesGpu &&
    availableGb != null &&
    runMayExceedGpu &&
    (inferenceFit === "fits" || inferenceFit === "tight");

  if (sidebar) {
    return (
      <div className={cn("px-4 py-3 space-y-2", className)}>
        <p className="text-[10px] font-mono uppercase tracking-wider text-slate-600">
          {estimate.usesGpu ? "Model VRAM" : "Model memory"}
        </p>
        <p className="text-[10px] font-mono text-slate-400 truncate" title={modelLabel}>
          {modelShortName}
        </p>
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] text-slate-500">Before optimization</span>
            <span className="text-xs font-mono text-slate-400 tabular-nums">
              ~{formatMemoryGb(beforeGb)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] text-slate-500">After optimization</span>
            <span className="text-xs font-mono text-slate-200 tabular-nums">
              ~{formatMemoryGb(afterGb)}
            </span>
          </div>
          {estimate.usesGpu ? (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] text-slate-500">GPU VRAM available</span>
                <span className="text-xs font-mono text-slate-300 tabular-nums">
                  {availableGb != null ? formatMemoryGb(availableGb) : "Unknown"}
                </span>
              </div>
              {systemRamGb != null && (
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] text-slate-500">System RAM available</span>
                  <span className="text-xs font-mono text-slate-300 tabular-nums">
                    {formatMemoryGb(systemRamGb)}
                  </span>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] text-slate-500">Peak RAM (run)</span>
                <span className="text-xs font-mono text-slate-300 tabular-nums">
                  ~{formatMemoryGb(estimate.peakRunGb)}
                </span>
              </div>
              {systemRamGb != null && (
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] text-slate-500">System RAM available</span>
                  <span className="text-xs font-mono text-slate-300 tabular-nums">
                    {formatMemoryGb(systemRamGb)}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
        {fitLabel && (
          <span className={cn("inline-block text-[10px] px-1.5 py-0.5 rounded border", fitClass)}>
            {fitLabel}
          </span>
        )}
        {showRunWarning && (
          <p className="text-[10px] text-amber-500/90 leading-snug">
            Olive run may need ~{formatMemoryGb(estimate.peakRunGb)} peak VRAM for this model.
          </p>
        )}
        {showOffloadGuidance && !offloadActive && (
          <p className="text-[10px] text-slate-500 leading-snug">{offloadGuidance}</p>
        )}
        {offloadActive && hybridPoolGb != null && (
          <p className="text-[10px] text-emerald-500/90 leading-snug">
            Hybrid pool ~{formatMemoryGb(hybridPoolGb)} (GPU + RAM) for optimization run.
          </p>
        )}
      </div>
    );
  }

  if (compact) {
    return (
      <div className={cn("text-xs text-slate-500 space-y-1", className)}>
        <ModelMemoryCompare
          beforeGb={beforeGb}
          afterGb={afterGb}
          modelShortName={modelShortName}
          modelLabel={modelLabel}
          usesGpu={estimate.usesGpu}
          size="sm"
        />
        {availableGb != null && estimate.usesGpu && (
          <p className="text-[11px] pl-0.5">
            <span className="text-slate-500">GPU available:</span>{" "}
            <span className="font-mono text-slate-300">{formatMemoryGb(availableGb)}</span>
            {systemRamGb != null && (
              <>
                <span className="text-slate-600"> · </span>
                <span className="text-slate-500">RAM:</span>{" "}
                <span className="font-mono text-slate-300">{formatMemoryGb(systemRamGb)}</span>
              </>
            )}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded border border-slate-800 bg-slate-950/40 p-4",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-electric-blue shrink-0" />
          <div>
            <h4 className="text-sm font-medium text-slate-200">
              {estimate.usesGpu ? "Model VRAM estimate" : "Model memory estimate"}
            </h4>
            <p className="text-[10px] text-slate-500 font-mono truncate max-w-md" title={modelLabel}>
              {modelLabel}
            </p>
          </div>
          <span className="text-[10px] text-slate-600 font-mono self-start mt-0.5">
            {estimate.confidence} confidence
          </span>
        </div>
        {fitLabel && (
          <span className={cn("text-xs px-2 py-0.5 rounded border", fitClass)}>
            {fitLabel}
          </span>
        )}
      </div>

      <ModelMemoryCompare
        beforeGb={beforeGb}
        afterGb={afterGb}
        modelShortName={modelShortName}
        modelLabel={modelLabel}
        usesGpu={estimate.usesGpu}
        size="md"
        className="mt-3"
      />

      {showRunWarning && (
        <p className="text-[11px] text-amber-500/90 mt-2 leading-relaxed">
          The optimized model should fit, but the Olive run for <span className="font-mono text-amber-400/90">{modelShortName}</span> may
          temporarily need ~{formatMemoryGb(estimate.peakRunGb)} peak VRAM.
        </p>
      )}

      {showOffloadGuidance && !offloadActive && (
        <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">{offloadGuidance}</p>
      )}

      {offloadActive && hybridPoolGb != null && (
        <p className="text-[11px] text-emerald-500/90 mt-2 leading-relaxed">
          Hybrid offload active — optimization run can spread across ~{formatMemoryGb(hybridPoolGb)} GPU + host RAM.
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded border border-slate-800 bg-slate-900/50 px-3 py-2">
          <p className="text-[11px] text-slate-500">
            {estimate.usesGpu ? "Peak VRAM (Olive run)" : "Peak RAM (Olive run)"}
          </p>
          <p className="text-sm font-mono text-electric-blue mt-0.5">
            ~{formatMemoryGb(estimate.peakRunGb)}
          </p>
          <p className="text-[9px] text-slate-600 mt-0.5">Temporary during optimization</p>
        </div>
        {estimate.usesGpu && (
          <div className="rounded border border-slate-800 bg-slate-900/50 px-3 py-2">
            <p className="text-[11px] text-slate-500">GPU VRAM available</p>
            <p className="text-sm font-mono text-slate-200 mt-0.5">
              {availableGb != null ? formatMemoryGb(availableGb) : "Unknown"}
            </p>
            <p className="text-[9px] text-slate-600 mt-0.5">Your hardware</p>
          </div>
        )}
        <div className="rounded border border-slate-800 bg-slate-900/50 px-3 py-2">
          <p className="text-[11px] text-slate-500">System RAM available</p>
          <p className="text-sm font-mono text-slate-200 mt-0.5">
            {systemRamGb != null ? formatMemoryGb(systemRamGb) : "Unknown"}
          </p>
          <p className="text-[9px] text-slate-600 mt-0.5">Your hardware</p>
        </div>
      </div>

      <p className="text-[11px] text-slate-600 mt-2 leading-relaxed">
        Heuristic from model size and active passes — not profiled.{" "}
        {!isGpuProvider(state.ihvProvider) && "CPU/OpenVINO/QNN targets use host memory, not discrete VRAM."}
      </p>
    </div>
  );
}
