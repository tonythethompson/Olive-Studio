/**
 * Multi-model batch comparison view.
 * Renders a side-by-side table of 2–10 selected job history records
 * with sortable columns, delta indicators, scoring preference selector,
 * winner highlight, and excluded jobs display.
 *
 * Accepts `CompareResultsOutput` from the MCP `compare_results` tool
 * and validates job count via `validateJobCount`.
 */
import { useState, useMemo, useId } from "react";
import type { JobHistoryRecord } from "@/lib/jobHistoryStore";
import type {
  CompareResultsOutput,
  ScoringPreference,
} from "@/lib/types/agentTypes";
import { validateJobCount } from "@/lib/batchComparison";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowUpDown,
  X,
  Trophy,
  Info,
} from "lucide-react";

interface BatchComparisonViewProps {
  records: JobHistoryRecord[];
  onClose?: () => void;
  /** MCP compare_results output. When provided, renders metric columns and winner highlight. */
  compareResults?: CompareResultsOutput | null;
  /** Callback to invoke comparison with the selected scoring preference. */
  onCompare?: (preference: ScoringPreference) => void;
  /** Whether a compare request is currently in flight. */
  comparing?: boolean;
  /** Error message from a failed comparison request. */
  compareError?: string | null;
}

type SortKey = "modelId" | "ihvProvider" | "durationMs" | "passCount" | "vramEstimateGb" | "status";
type SortDir = "asc" | "desc";

const SCORING_OPTIONS: { value: ScoringPreference; label: string }[] = [
  { value: "balanced", label: "Balanced" },
  { value: "latency", label: "Latency" },
  { value: "size", label: "Size" },
  { value: "accuracy", label: "Accuracy" },
];

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
      className={cn(
        "inline-flex items-center gap-1 text-sm px-2 py-0.5 rounded-full border font-medium",
        config.cls,
      )}
    >
      <Icon className="h-3 w-3" />
      {status}
    </span>
  );
}

/**
 * Displays selected job runs in a sortable comparison table with duration deltas,
 * scoring preference selector, MCP compare_results integration, winner highlight,
 * and excluded jobs display.
 *
 * @param records - The job history records to compare.
 * @param onClose - Optional callback invoked when the comparison panel is closed.
 * @param compareResults - Optional MCP compare_results output for metric display.
 * @param onCompare - Optional callback to trigger comparison with scoring preference.
 * @param completedJobCount - Ignored; eligibility uses completed rows in `records`.
 * @returns The comparison panel element.
 */
export function BatchComparisonView({
  records,
  onClose,
  compareResults,
  onCompare,
  comparing = false,
  compareError = null,
}: BatchComparisonViewProps) {
  const [sortKey, setSortKey] = useState<SortKey>("durationMs");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [scoringPreference, setScoringPreference] = useState<ScoringPreference>("balanced");
  const scoringSelectId = useId();

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

  // Eligibility is the selected `records`, not a global completed count.
  const effectiveCompletedCount = records.filter((r) => r.status === "completed").length;
  const canCompare = validateJobCount(effectiveCompletedCount);

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
            aria-label="Close comparison"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Scoring preference selector and Compare button */}
      {onCompare && (
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label htmlFor={scoringSelectId} className="text-xs text-slate-400 font-medium">
            Scoring:
          </label>
          <select
            id={scoringSelectId}
            value={scoringPreference}
            onChange={(e) => setScoringPreference(e.target.value as ScoringPreference)}
            className="bg-slate-900 border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-electric-blue/50"
          >
            {SCORING_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

          <div className="relative group">
            <button
              type="button"
              disabled={comparing}
              onClick={() => {
                if (canCompare && !comparing) onCompare(scoringPreference);
              }}
              aria-disabled={!canCompare || comparing}
              aria-describedby={!canCompare ? `${scoringSelectId}-compare-hint` : undefined}
              title={
                !canCompare
                  ? effectiveCompletedCount < 2
                    ? "At least 2 completed jobs required"
                    : "Maximum 10 completed jobs supported"
                  : undefined
              }
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                canCompare && !comparing
                  ? "bg-electric-blue/20 text-electric-blue border border-electric-blue/30 hover:bg-electric-blue/30"
                  : "bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed",
              )}
            >
              {comparing ? "Comparing..." : "Compare Results"}
            </button>
            {!canCompare && (
              <div
                id={`${scoringSelectId}-compare-hint`}
                role="tooltip"
                className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-[11px] text-slate-300 whitespace-nowrap opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity pointer-events-none z-10"
              >
                {effectiveCompletedCount < 2
                  ? "At least 2 completed jobs required"
                  : "Maximum 10 completed jobs supported"}
              </div>
            )}
          </div>

          {compareError && (
            <span className="text-xs text-rose-400 font-medium">{compareError}</span>
          )}
      </div>
      )}

      {/* MCP Compare Results: metric table */}
      {compareResults && (compareResults.results.length > 0 || compareResults.winner === null) && (
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="px-3 py-2 text-slate-400 font-medium">Model</th>
                  <th className="px-3 py-2 text-slate-400 font-medium">Latency (ms)</th>
                  <th className="px-3 py-2 text-slate-400 font-medium">Model Size (MB)</th>
                  <th className="px-3 py-2 text-slate-400 font-medium">Accuracy</th>
                  <th className="px-3 py-2 text-slate-400 font-medium">Weighted Score</th>
                  <th className="px-3 py-2 text-slate-400 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {compareResults.results.map((entry) => {
                  const isWinner = compareResults.winner != null && entry.job_id === compareResults.winner;
                  // Look up the matching record to get the actual status.
                  const matchingRecord = records.find(
                    (r) => r.id === entry.job_id || r.jobId === entry.job_id,
                  );
                  const entryStatus = matchingRecord?.status;
                  return (
                    <tr
                      key={entry.job_id}
                      data-testid={isWinner ? "winner-row" : undefined}
                      className={cn(
                        "border-b border-slate-800/50 transition-colors",
                        isWinner
                          ? "bg-emerald-500/10 border-l-2 border-l-emerald-400"
                          : "hover:bg-slate-800/30",
                      )}
                    >
                      <td className="px-3 py-2 font-medium text-slate-200 max-w-[160px] truncate" title={matchingRecord?.modelId ?? entry.job_id}>
                        <span className="inline-flex items-center gap-1.5">
                          {isWinner && <Trophy className="h-3.5 w-3.5 text-emerald-400 shrink-0" />}
                          {matchingRecord?.modelId ?? entry.job_id}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-300 font-mono">
                        {entry.latency_ms != null ? entry.latency_ms.toFixed(1) : "-"}
                      </td>
                      <td className="px-3 py-2 text-slate-300 font-mono">
                        {entry.model_size_mb != null ? entry.model_size_mb.toFixed(1) : "-"}
                      </td>
                      <td className="px-3 py-2 text-slate-300 font-mono">
                        {entry.accuracy != null ? entry.accuracy.toFixed(4) : "-"}
                      </td>
                      <td className="px-3 py-2 text-slate-300 font-mono font-semibold">
                        {entry.score.toFixed(2)}
                      </td>
                      <td className="px-3 py-2">
                        {entryStatus ? <StatusBadge status={entryStatus} /> : <span className="text-slate-500">-</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Winner reasoning */}
          {compareResults.winner != null && compareResults.reasoning && (
            <div className="flex items-start gap-2 px-3 py-2 bg-emerald-500/5 border border-emerald-500/20 rounded-lg">
              <Trophy className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
              <p className="text-xs text-slate-300">
                <span className="font-medium text-emerald-400">Winner: {compareResults.winner}</span>
                {" — "}
                {compareResults.reasoning}
              </p>
            </div>
          )}

          {compareResults.winner === null && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/5 border border-amber-500/20 rounded-lg">
                <Info className="h-4 w-4 text-amber-400 shrink-0" />
                <p className="text-xs text-amber-300 font-medium">
                  No clear winner could be determined
                </p>
              </div>
              {compareResults.reasoning && (
                <p className="text-xs text-slate-400 px-3">{compareResults.reasoning}</p>
              )}
            </div>
          )}
          {compareResults.excluded_jobs.length > 0 && (
                <div className="px-3 space-y-1">
                  <p className="text-[11px] text-slate-500 font-medium uppercase tracking-wide">
                    Excluded Jobs
                  </p>
                  <ul className="space-y-1">
                    {compareResults.excluded_jobs.map((ej) => (
                      <li
                        key={ej.job_id}
                        className="flex items-start gap-2 text-xs text-slate-400"
                      >
                        <XCircle className="h-3.5 w-3.5 text-rose-400 mt-0.5 shrink-0" />
                        <span>
                          <span className="font-mono text-slate-300">{ej.job_id}</span>
                          {" — "}
                          {ej.reason}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
          )}
        </div>
      )}

      {/* Original sortable records table */}
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

              // Check if this record's job is the winner from compare results
              const isWinnerRecord =
                compareResults?.winner != null &&
                (rec.id === compareResults.winner || rec.jobId === compareResults.winner);

              return (
                <tr
                  key={rec.id}
                  className={cn(
                    "border-b border-slate-800/50 transition-colors",
                    isWinnerRecord
                      ? "bg-emerald-500/10 border-l-2 border-l-emerald-400"
                      : "hover:bg-slate-800/30",
                  )}
                >
                  <td
                    className="px-3 py-2 font-medium text-slate-200 max-w-[160px] truncate"
                    title={rec.modelId}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {isWinnerRecord && <Trophy className="h-3.5 w-3.5 text-emerald-400 shrink-0" />}
                      {rec.modelId}
                    </span>
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
                  <td className={cn("px-3 py-2 font-mono", deltaCls)}>{deltaStr}</td>
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
