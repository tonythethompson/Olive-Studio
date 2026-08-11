import { memo } from "react";
import { formatMemoryGb } from "@/lib/vramEstimate";
import { cn } from "@/lib/utils";
import { ArrowRight } from "lucide-react";

interface ModelMemoryCompareProps {
  beforeGb: number;
  afterGb: number;
  modelShortName: string;
  modelLabel: string;
  usesGpu: boolean;
  size?: "sm" | "md";
  className?: string;
}

/** Before → after model memory with model name context. */
export const ModelMemoryCompare = memo(function ModelMemoryCompare({
  beforeGb,
  afterGb,
  modelShortName,
  modelLabel,
  usesGpu,
  size = "md",
  className,
}: ModelMemoryCompareProps) {
  const memoryKind = usesGpu ? "VRAM" : "RAM";
  const savedGb = Math.max(0, beforeGb - afterGb);
  const savedPct = beforeGb > 0 ? Math.round((savedGb / beforeGb) * 100) : 0;
  const grewGb = Math.max(0, afterGb - beforeGb);
  const grewPct = beforeGb > 0 ? Math.round((grewGb / beforeGb) * 100) : 0;
  const showSavings = savedGb > 0.05 && savedPct >= 5;
  const showGrowth = grewGb > 0.05 && grewPct >= 5;

  if (size === "sm") {
    return (
      <div className={cn("space-y-1", className)}>
        <p className="text-[11px] text-slate-500 truncate" title={modelLabel}>
          <span className="text-slate-400">Model:</span>{" "}
          <span className="text-slate-300 font-mono">{modelShortName}</span>
        </p>
        <p className="text-xs text-slate-400 leading-snug">
          <span className="text-slate-500">Before opt.</span>{" "}
          <span className="font-mono text-slate-300 tabular-nums">~{formatMemoryGb(beforeGb)}</span>
          <ArrowRight className="inline h-3 w-3 mx-1 text-slate-600 align-middle" />
          <span className="text-slate-500">After</span>{" "}
          <span className="font-mono text-slate-200 tabular-nums">~{formatMemoryGb(afterGb)}</span>
          {showSavings && <span className="text-emerald-500/90 ml-1">(−{savedPct}%)</span>}
          {showGrowth && (
            <span className="text-amber-500/90 ml-1">(+{grewPct}%, check quant/precision)</span>
          )}
        </p>
      </div>
    );
  }

  return (
    <div className={cn("rounded border border-slate-800 bg-slate-900/40 p-3", className)}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <p className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
            AI model · {memoryKind} footprint
          </p>
          <p className="text-sm font-mono text-slate-200 truncate mt-0.5" title={modelLabel}>
            {modelShortName}
          </p>
        </div>
        {showSavings && (
          <span className="shrink-0 text-[11px] font-mono px-1.5 py-0.5 rounded border border-emerald-500/25 bg-emerald-500/10 text-emerald-400">
            −{savedPct}% est.
          </span>
        )}
        {showGrowth && !showSavings && (
          <span className="shrink-0 text-[11px] font-mono px-1.5 py-0.5 rounded border border-amber-500/25 bg-amber-500/10 text-amber-400">
            +{grewPct}% est.
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-[100px] rounded border border-slate-800 bg-slate-950/80 px-2.5 py-2">
          <p className="text-[11px] text-slate-500">Before optimization</p>
          <p className="text-sm font-mono text-slate-300 tabular-nums mt-0.5">~{formatMemoryGb(beforeGb)}</p>
          <p className="text-[9px] text-slate-600 mt-0.5">Base weights loaded</p>
        </div>
        <ArrowRight className="h-4 w-4 text-slate-600 shrink-0" aria-hidden />
        <div className="flex-1 min-w-[100px] rounded border border-electric-blue/20 bg-electric-blue/5 px-2.5 py-2">
          <p className="text-[11px] text-electric-blue/80">After optimization</p>
          <p className="text-sm font-mono text-slate-100 tabular-nums mt-0.5">~{formatMemoryGb(afterGb)}</p>
          <p className="text-[9px] text-slate-600 mt-0.5">
            {showGrowth ? "Larger than base. Enable quantization to shrink." : "Deployed inference size"}
          </p>
        </div>
      </div>

      {beforeGb > 0 && (
        <div className="mt-2.5">
          <div
            className="h-1.5 rounded-full bg-slate-700/50 overflow-hidden relative"
            title={`Before ${formatMemoryGb(beforeGb)} → after ${formatMemoryGb(afterGb)}`}
          >
            <div
              className="absolute inset-y-0 left-0 bg-electric-blue/75 rounded-full"
              style={{ width: `${Math.min(100, (afterGb / beforeGb) * 100)}%` }}
            />
          </div>
          <p className="text-[9px] text-slate-600 mt-1">Bar width = base model; fill = optimized size</p>
        </div>
      )}
    </div>
  );
});
