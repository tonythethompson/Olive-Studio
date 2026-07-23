import { Card, CardContent, CardHeader } from "@/components/ui";
import { Activity } from "lucide-react";
import { parseOliveMetricsFromLogs } from "@/lib/oliveLogMetrics";

/**
 * PerformanceMetrics — intentionally empty until a real Olive run completes.
 * Parses latency/throughput/memory/compression from Olive stdout when present.
 */
export function PerformanceMetrics({ logs }: { logs?: string[] }) {
  const parsed = logs && logs.length > 0 ? parseOliveMetricsFromLogs(logs) : undefined;
  const parsedMetrics = parsed
    ? ([
        parsed.latency !== "—"
          ? { label: "Latency", value: parsed.latency, color: "text-electric-blue" }
          : null,
        parsed.throughput !== "—"
          ? { label: "Throughput", value: parsed.throughput, color: "text-emerald-400" }
          : null,
        parsed.memory !== "—" ? { label: "Memory", value: parsed.memory, color: "text-purple-400" } : null,
        parsed.compression !== "—"
          ? { label: "Compression", value: parsed.compression, color: "text-amber-400" }
          : null,
      ].filter(Boolean) as { label: string; value: string; color: string }[])
    : [];

  return (
    <Card>
      <CardHeader
        title="Performance Metrics"
        description={
          parsedMetrics.length > 0
            ? "Metrics extracted from the most recent Olive run output."
            : "Metrics will appear here after a completed Olive optimization run."
        }
        badge={
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-slate-400">
            <Activity className="h-4 w-4" />
          </div>
        }
      />
      <CardContent>
        {parsedMetrics.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {parsedMetrics.map((m, i) => (
              <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-center">
                <span className="text-slate-500 text-[10px] block uppercase font-bold font-mono mb-1">
                  {m.label}
                </span>
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
                Click <strong>Execute Live</strong> to run Olive optimization. Metrics reported in the output
                will be surfaced here automatically.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
