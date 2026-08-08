import { useState } from "react";
import type { McpDiagnostic } from "@/types";
import { ChevronLeft, ChevronRight, Clock, AlertTriangle, Wrench, Trash2 } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────

export interface DiagnosisEntry {
  id: string;
  timestamp: number;
  diagnostic: McpDiagnostic;
  /** The log snippet that was sent for diagnosis. */
  logSnippet: string;
  /** Whether the fix was applied after this diagnosis. */
  fixApplied: boolean;
}

interface DiagnosisHistoryProps {
  entries: DiagnosisEntry[];
  /** Index of the currently displayed diagnosis (-1 if none). */
  activeIndex: number;
  /** Callback when user clicks a past diagnosis to view it. */
  onSelect: (index: number) => void;
  /** Callback to clear all history. */
  onClear: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen) + "…" : str;
}

/**
 * Count how many times each `matched_entry` has appeared across all diagnoses.
 * Returns entries sorted by frequency (most common first).
 */
function detectRecurringPatterns(entries: DiagnosisEntry[]): Array<{ pattern: string; count: number }> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = entry.diagnostic.matched_entry ?? entry.diagnostic.title;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([pattern, count]) => ({ pattern, count }))
    .sort((a, b) => b.count - a.count);
}

// ── Component ────────────────────────────────────────────────────

export function DiagnosisHistory({ entries, activeIndex, onSelect, onClear }: DiagnosisHistoryProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (entries.length === 0) return null;

  const recurring = detectRecurringPatterns(entries);

  return (
    <div
      className={`flex flex-col border-l border-slate-800 bg-slate-950/80 transition-all duration-200 ${
        collapsed ? "w-8" : "w-64"
      }`}
    >
      {/* Collapse toggle */}
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center justify-center h-8 border-b border-slate-800 hover:bg-slate-800/50 transition-colors cursor-pointer shrink-0"
        title={collapsed ? "Expand diagnosis history" : "Collapse diagnosis history"}
      >
        {collapsed ? (
          <ChevronLeft className="h-3.5 w-3.5 text-slate-500" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
        )}
      </button>

      {!collapsed && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between px-2 py-1.5 border-b border-slate-800/50">
            <span className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
              History ({entries.length})
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onClear}
                className="p-0.5 text-slate-600 hover:text-rose-400 transition-colors cursor-pointer"
                title="Clear history"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>

          {/* Recurring patterns */}
          {recurring.length > 0 && recurring[0].count > 1 && (
            <div className="px-2 py-1.5 border-b border-slate-800/50">
              <p className="text-[9px] font-mono uppercase tracking-wider text-amber-500/80 mb-1">
                Recurring
              </p>
              {recurring
                .filter((r) => r.count > 1)
                .slice(0, 3)
                .map((r) => (
                  <div key={r.pattern} className="flex items-center gap-1 text-[11px] text-amber-400/80">
                    <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                    <span className="truncate">{truncate(r.pattern, 40)}</span>
                    <span className="ml-auto text-[9px] text-amber-500/60 font-mono">×{r.count}</span>
                  </div>
                ))}
            </div>
          )}

          {/* Entry list */}
          <div className="flex-1 overflow-y-auto">
            {entries.map((entry, idx) => {
              const isActive = idx === activeIndex;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => onSelect(idx)}
                  className={`w-full text-left px-2 py-2 border-b border-slate-800/30 transition-colors cursor-pointer ${
                    isActive
                      ? "bg-electric-blue/10 border-l-2 border-l-electric-blue"
                      : "hover:bg-slate-800/30 border-l-2 border-l-transparent"
                  }`}
                >
                  <div className="flex items-center gap-1 mb-0.5">
                    <Clock className="h-2.5 w-2.5 text-slate-600 shrink-0" />
                    <span className="text-[9px] text-slate-500 font-mono">
                      {formatTimestamp(entry.timestamp)}
                    </span>
                    {entry.fixApplied && (
                      <span className="text-[8px] text-emerald-500/80 font-mono ml-auto">fixed</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Wrench className="h-2.5 w-2.5 text-slate-600 shrink-0" />
                    <span className="text-[11px] text-slate-300 truncate">
                      {truncate(entry.diagnostic.title, 35)}
                    </span>
                  </div>
                  <p className="text-[9px] text-slate-500 mt-0.5 line-clamp-2">
                    {truncate(entry.diagnostic.root_cause, 60)}
                  </p>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
