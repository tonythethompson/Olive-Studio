import { Card, CardContent, CardHeader } from "@/components/ui";
import { Activity } from "lucide-react";

/**
 * PerformanceMetrics — intentionally empty until a real Olive run completes.
 *
 * The previous implementation rendered static hardcoded bar charts
 * (e.g. Baseline 45.2 ms → Optimized 8.4 ms) that were completely fabricated
 * and had no connection to any actual Olive execution result.
 *
 * Real metrics (latency, throughput, memory) will be parsed from Olive's stdout
 * once a job completes and surfaced here. Until then the card shows a
 * "Run Olive to see metrics" placeholder — no fake data.
 */
export function PerformanceMetrics({ logs }: { logs?: string[] }) {
  // Attempt to parse real metrics from Olive log output
  const parsedMetrics: { label: string; value: string; color: string }[] = [];

  if (logs && logs.length > 0) {
    for (const line of logs) {
      // Match patterns like "latency: 14.2 ms" or "throughput: 70 tok/s"
      const latencyMatch = line.match(/latency[:\s]+([0-9.]+\s*ms)/i);
      if (latencyMatch) parsedMetrics.push({ label: "Latency", value: latencyMatch[1], color: "text-electric-blue" });

      const throughputMatch = line.match(/throughput[:\s]+([0-9.]+\s*(?:tok\/s|req\/s|it\/s|samples\/s))/i);
      if (throughputMatch) parsedMetrics.push({ label: "Throughput", value: throughputMatch[1], color: "text-emerald-400" });

      const memoryMatch = line.match(/(?:memory|vram|footprint)[:\s]+([0-9.]+\s*(?:MB|GB|MiB|GiB))/i);
      if (memoryMatch) parsedMetrics.push({ label: "Memory", value: memoryMatch[1], color: "text-purple-400" });

      const compressionMatch = line.match(/compression[:\s]+([0-9.]+[x%])/i);
      if (compressionMatch) parsedMetrics.push({ label: "Compression", value: compressionMatch[1], color: "text-amber-400" });
    }
  }

  return (
    <Card>
      <CardHeader
        title="Performance Metrics"
        description={parsedMetrics.length > 0 ? "Metrics extracted from the most recent Olive run output." : "Metrics will appear here after a completed Olive optimization run."}
        badge={<div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-slate-400"><Activity className="h-4 w-4" /></div>}
      />
      <CardContent>
        {parsedMetrics.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {parsedMetrics.map((m, i) => (
              <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-center">
                <span className="text-slate-500 text-[10px] block uppercase font-bold font-mono mb-1">{m.label}</span>
                <span className={`text-lg font-bold font-mono ${m.color}`}>{m.value}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center bg-slate-950/20 border border-dashed border-slate-800 rounded-xl gap-3">
            <Activity className="h-8 w-8 text-slate-600" />
            <div>
              <p className="text-sm font-semibold text-slate-400">No metrics yet</p>
              <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                Click <strong>Execute Live</strong> to run Olive optimization. Metrics reported in the output will be surfaced here automatically.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
