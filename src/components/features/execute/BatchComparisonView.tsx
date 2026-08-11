/**
 * Multi-model batch comparison view.
 * Renders a side-by-side table of 2–6 selected job history records
 * with sortable columns and delta indicators.
 */
import { useState, useMemo } from "react";
import type { JobHistoryRecord } from "@/lib/jobHistoryStore";
import { CheckCircle2, XCircle, AlertTriangle, ArrowUpDown, X } from "lucide-react";

interface BatchComparisonViewProps {
  records: JobHistoryRecord[];
  onClose?: () => void;
}

type SortKey = "modelId" | "ihvProvider" | "durationMs" | "passCount" | "vramEstimateGb" | "status";
type SortDir = "asc" | "desc";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${secs % 60}s`;
}

function StatusBadge({ status }: { status: string }) {
  const config = {
    completed: { icon: CheckCircle2, cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
    failed: { icon: XCircle, cls: "text-rose-400 bg-rose-500/10 border-rose-500/20" },
    cancelled: { icon: AlertTriangle, cls: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
  }[status] ?? { icon: AlertTriangle, cls: "text-slate-400 bg-slate-500/10 border-slate-500/20" };

  const Icon = config.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 text-sm px-2 py-0.5 rounded-full border font-medium ${config.cls}`}
    >
      <Icon className="h-3 w-3" />
      {status}
    </span>
  );
}

/**
 * Displays selected job runs in a sortable comparison table with duration deltas.
 *
 * @param records - The job history records to compare.
 * @param onClose - Optional callback invoked when the comparison panel is closed.
 * @returns The comparison panel element.
 */
export function BatchComparisonView({ records, onClose }: BatchComparisonViewProps) {
  const [sortKey, setSortKey] = useState<SortKey>("durationMs");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sorted = useMemo(() => {
    const copy = [...records];
    copy.sort((a, b) => {
      const aVal = a[sortKey] ?? Infinity;
      const bVal = b[sortKey] ?? Infinity;
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortDir === "asc" ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
    return copy;
  }, [records, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  // Compute deltas relative to the first record (baseline)
  const baseline = sorted[0];

  const columns: { key: SortKey; label: string }[] = [
    { key: "modelId", label: "Model" },
    { key: "ihvProvider", label: "Provider" },
    { key: "status", label: "Status" },
    { key: "durationMs", label: "Duration" },
    { key: "passCount", label: "Passes" },
    { key: "vramEstimateGb", label: "VRAM (GB)" },
  ];

  return (
    <div className="bg-slate-950/60 border border-electric-blue/30 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
        <div className="text-sm font-semibold text-electric-blue">Comparing {records.length} Runs</div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead>
            <tr className="border-b border-slate-800">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="px-3 py-2 text-slate-400 font-medium cursor-pointer select-none hover:text-slate-200 transition-colors"
                  onClick={() => handleSort(col.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    <ArrowUpDown className="h-3 w-3 opacity-50" />
                  </span>
                </th>
              ))}
              <th className="px-3 py-2 text-slate-400 font-medium">Δ Duration</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((rec) => {
              const delta = baseline ? rec.durationMs - baseline.durationMs : 0;
              const deltaStr =
                delta === 0
                  ? "-"
                  : delta > 0
                    ? `+${formatDuration(delta)}`
                    : `-${formatDuration(Math.abs(delta))}`;
              const deltaCls =
                delta === 0 ? "text-slate-500" : delta > 0 ? "text-rose-400" : "text-emerald-400";

              return (
                <tr
                  key={rec.id}
                  className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors"
                >
                  <td
                    className="px-3 py-2 font-medium text-slate-200 max-w-[160px] truncate"
                    title={rec.modelId}
                  >
                    {rec.modelId}
                  </td>
                  <td className="px-3 py-2 text-slate-300 font-mono">{rec.ihvProvider}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={rec.status} />
                  </td>
                  <td className="px-3 py-2 text-slate-300 font-mono">{formatDuration(rec.durationMs)}</td>
                  <td className="px-3 py-2 text-slate-300">{rec.passCount}</td>
                  <td className="px-3 py-2 text-slate-300 font-mono">
                    {rec.vramEstimateGb != null ? rec.vramEstimateGb.toFixed(1) : "-"}
                  </td>
                  <td className={`px-3 py-2 font-mono ${deltaCls}`}>{deltaStr}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-slate-500">
        Δ Duration relative to first row (baseline). Click column headers to sort.
      </p>
    </div>
  );
}
