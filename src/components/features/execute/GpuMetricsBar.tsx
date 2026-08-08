import { memo } from "react";
import { Cpu, Thermometer, Zap, MemoryStick, Gauge } from "lucide-react";
import {
  type GpuMetrics,
  formatPct,
  formatMb,
  formatTemp,
  formatPower,
  formatMemPct,
} from "@/lib/gpuMetrics";

interface GpuMetricsBarProps {
  metrics: GpuMetrics | null;
}

export const GpuMetricsBar = memo(function GpuMetricsBar({ metrics }: GpuMetricsBarProps) {
  if (!metrics || metrics.gpus.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2 rounded-md border border-slate-800 bg-slate-950/60 text-xs font-mono">
      {metrics.gpus.map((gpu) => (
        <div key={gpu.index} className="flex items-center gap-x-3 gap-y-1 flex-wrap">
          <span className="text-slate-300 flex items-center gap-1">
            <Cpu className="h-3 w-3 text-electric-blue" />
            <span className="truncate max-w-[120px]">{gpu.name}</span>
          </span>
          <span className="text-slate-400 flex items-center gap-1" title="GPU utilization">
            <Gauge className="h-3 w-3 text-slate-500" />
            {formatPct(gpu.utilizationPct)}
          </span>
          <span className="text-slate-400 flex items-center gap-1" title="VRAM usage">
            <MemoryStick className="h-3 w-3 text-slate-500" />
            {formatMb(gpu.memUsedMb)} / {formatMb(gpu.memTotalMb)}
            <span className="text-slate-600">({formatMemPct(gpu.memUsedMb, gpu.memTotalMb)})</span>
          </span>
          <span className="text-slate-400 flex items-center gap-1" title="Temperature">
            <Thermometer className="h-3 w-3 text-slate-500" />
            {formatTemp(gpu.tempC)}
          </span>
          <span className="text-slate-400 flex items-center gap-1" title="Power draw">
            <Zap className="h-3 w-3 text-slate-500" />
            {formatPower(gpu.powerW)}
          </span>
        </div>
      ))}
    </div>
  );
});
