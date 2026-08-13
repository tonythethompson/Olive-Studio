/**
 * Collapsible Pipeline Review section rendered at the top of the Assistant tab.
 *
 * Displays an efficiency score badge, level label, finding count, last-checked
 * timestamp, staleness indicator, and a list of FindingCards. Supports
 * expand/collapse via click or keyboard (Enter/Space).
 *
 * States:
 * - **Zero state**: No review data yet — shows a message with Refresh button.
 * - **Collapsed**: Compact score badge + unresolved finding count.
 * - **Expanded**: Full score, level, timestamp, StalenessIndicator, and FindingCard list.
 *
 * Expanded by default on first session open.
 *
 * @see Requirements 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8
 * @module PipelineReview
 */

import { useState, useCallback, useMemo, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePipelineReview } from "./usePipelineReview";
import { FindingCard } from "./FindingCard";
import { StalenessIndicator } from "./StalenessIndicator";

// ─── Props ───────────────────────────────────────────────────────────────────

export interface PipelineReviewProps {
  /** Callback to inject an explanation body into the chat panel. */
  onExplain?: (body: string) => void;
  /** Optional additional className for the root container. */
  className?: string;
  /**
   * Optional ref that will be populated with a function to trigger a
   * post-patch refresh. The parent can call this after applying a chat
   * action patch to schedule a debounced review refresh.
   */
  postPatchRefreshRef?: React.RefObject<(() => void) | null>;
  /** Optional controlled pipeline state (same object the chat applies patches to). */
  state?: import("@/types").UIState;
  setState?: (partial: Partial<import("@/types").UIState>) => void;
  /** Optional ref populated with `refresh` so the parent can trigger a review. */
  reviewRefreshRef?: React.RefObject<(() => void) | null>;
  reviewResetRef?: React.RefObject<(() => void) | null>;
}

// ─── Score Level Colors ──────────────────────────────────────────────────────

function getScoreBadgeClasses(level: string): string {
  switch (level) {
    case "Optimized":
      return "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
    case "Suboptimal":
      return "bg-amber-500/20 text-amber-300 border-amber-500/40";
    case "Inefficient":
    case "Critical":
      return "bg-rose-500/20 text-rose-300 border-rose-500/40";
    default:
      return "bg-slate-700/40 text-slate-300 border-slate-600/40";
  }
}

function getScoreTextColor(level: string): string {
  switch (level) {
    case "Optimized":
      return "text-emerald-400";
    case "Suboptimal":
      return "text-amber-400";
    case "Inefficient":
    case "Critical":
      return "text-rose-400";
    default:
      return "text-slate-400";
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Collapsible Pipeline Review section.
 *
 * Requirements:
 * - 1.2: Renders collapsible section at the top of the Assistant tab.
 * - 1.3: Expanded shows score, level, timestamp, findings.
 * - 1.4: Collapsed shows compact score badge + unresolved count.
 * - 1.5: Chat conversation renders below (handled by parent).
 * - 1.6: Expanded by default on first session open.
 * - 1.7: Zero-state with "No review yet" message and Refresh button.
 * - 1.8: Toggle via click or Enter/Space on focused header.
 */
export function PipelineReview({ onExplain, className, postPatchRefreshRef, state, setState, reviewRefreshRef, reviewResetRef }: PipelineReviewProps) {
  // Expanded by default on first session open (Req 1.6).
  const [isExpanded, setIsExpanded] = useState(true);

  const {
    findings,
    score,
    level,
    summary,
    isStale,
    isLoading,
    error,
    refresh,
    reset,
    schedulePostPatchRefresh,
    completedAt,
  } = usePipelineReview(state);

  // Determine if we have any review data (Req 1.7 zero-state detection).
  const hasReviewData = completedAt > 0;

  // Unresolved finding count (for collapsed badge).
  const unresolvedCount = useMemo(
    () => findings.filter((f) => f.severity === "critical" || f.severity === "warning").length,
    [findings],
  );

  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!hasReviewData) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [hasReviewData, completedAt]);

  // Format last-checked timestamp from the review result's completion timestamp.
  const lastCheckedLabel = useMemo(() => {
    if (!hasReviewData) return "";
    if (!completedAt) return "Just now";
    const elapsed = nowTick - completedAt;
    if (elapsed < 60_000) return "Just now";
    if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
    if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
    return `${Math.floor(elapsed / 86_400_000)}d ago`;
  }, [hasReviewData, completedAt, nowTick]);

  // Expose schedulePostPatchRefresh to parent via ref (for chat action patches).
  useEffect(() => {
    if (postPatchRefreshRef) {
      postPatchRefreshRef.current = schedulePostPatchRefresh;
    }
    if (reviewRefreshRef) {
      reviewRefreshRef.current = refresh;
    }
    if (reviewResetRef) {
      reviewResetRef.current = reset;
    }
    return () => {
      if (postPatchRefreshRef) {
        postPatchRefreshRef.current = null;
      }
      if (reviewRefreshRef) {
        reviewRefreshRef.current = null;
      }
      if (reviewResetRef) {
        reviewResetRef.current = null;
      }
    };
  }, [postPatchRefreshRef, reviewRefreshRef, reviewResetRef, schedulePostPatchRefresh, refresh, reset]);

  // ── Toggle handlers ─────────────────────────────────────────────────────

  const toggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const handleHeaderKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleExpand();
      }
    },
    [toggleExpand],
  );

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <section
      className={cn(
        "rounded-lg border border-slate-700/60 bg-slate-900/80 overflow-hidden",
        className,
      )}
      aria-label="Pipeline Review"
    >
      {/* ─── Header (clickable, keyboard accessible — Req 1.8) ─── */}
      <div
        id="pipeline-review-header"
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-controls="pipeline-review-content"
        onClick={toggleExpand}
        onKeyDown={handleHeaderKeyDown}
        className={cn(
          "flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none transition-colors",
          "hover:bg-slate-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-inset",
        )}
      >
        {/* Expand/Collapse chevron */}
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        )}

        {/* Icon */}
        <ShieldCheck className="h-4 w-4 shrink-0 text-electric-blue" aria-hidden="true" />

        {/* Title */}
        <span className="text-xs font-semibold text-slate-200 uppercase tracking-wide">
          Pipeline Review
        </span>

        {/* Collapsed state: compact score badge + count (Req 1.4) */}
        {!isExpanded && hasReviewData && (
          <div className="ml-auto flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                getScoreBadgeClasses(level),
              )}
            >
              {score}
            </span>
            {unresolvedCount > 0 && (
              <span className="text-[10px] font-medium text-slate-400">
                {unresolvedCount} issue{unresolvedCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        )}

        {/* Loading indicator in header */}
        {isLoading && (
          <Loader2
            className="ml-auto h-3.5 w-3.5 shrink-0 animate-spin text-electric-blue"
            aria-label="Analyzing pipeline"
          />
        )}
      </div>

      {/* ─── Expanded Content (Req 1.3) ─── */}
      <div
        id="pipeline-review-content"
        role="region"
        aria-labelledby="pipeline-review-header"
        className={cn(
          "transition-all",
          isExpanded ? "block" : "hidden",
        )}
      >
        <div className="border-t border-slate-700/40 px-3 pb-3">
          {/* ── Zero State (Req 1.7) ── */}
          {!hasReviewData && !isLoading && (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <ShieldCheck className="h-8 w-8 text-slate-600" aria-hidden="true" />
              <p className="text-xs text-slate-400">
                No review yet — click Refresh to analyze your pipeline
              </p>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  refresh();
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-electric-blue/40 bg-electric-blue/10 px-3 py-1.5 text-xs font-medium text-electric-blue transition-colors hover:bg-electric-blue/20 cursor-pointer"
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
                Refresh
              </button>
            </div>
          )}

          {/* ── Loading State ── */}
          {isLoading && !hasReviewData && (
            <div className="flex items-center justify-center gap-2 py-6">
              <Loader2 className="h-4 w-4 animate-spin text-electric-blue" aria-hidden="true" />
              <span className="text-xs text-slate-400">Analyzing pipeline…</span>
            </div>
          )}

          {/* ── Error State ── */}
          {error && (
            <div className="mt-3 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2">
              <p className="text-xs text-rose-300">{error}</p>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  refresh();
                }}
                className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-rose-300 hover:text-rose-200 transition-colors cursor-pointer"
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
                Retry
              </button>
            </div>
          )}

          {/* ── Review Data (Req 1.3: score, level, timestamp, findings) ── */}
          {hasReviewData && (
            <div className="mt-3 space-y-3">
              {/* Score + Level + Timestamp row */}
              <div className="flex items-center gap-3">
                {/* Score badge */}
                <div
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1",
                    getScoreBadgeClasses(level),
                  )}
                >
                  <span className="text-sm font-bold tabular-nums">{score}</span>
                  <span className="text-[10px] font-medium opacity-70">/100</span>
                </div>

                {/* Level label */}
                <span className={cn("text-xs font-semibold", getScoreTextColor(level))}>
                  {level}
                </span>

                {/* Timestamp + Refresh */}
                <div className="ml-auto flex items-center gap-2">
                  {lastCheckedLabel && (
                    <span className="text-[10px] text-slate-500">{lastCheckedLabel}</span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      refresh();
                    }}
                    disabled={isLoading}
                    className={cn(
                      "inline-flex items-center justify-center h-6 w-6 rounded border border-slate-700 transition-colors cursor-pointer",
                      "hover:bg-slate-800 hover:border-slate-600",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue",
                      "disabled:opacity-40 disabled:cursor-not-allowed",
                    )}
                    aria-label="Refresh review"
                    title="Re-run pipeline review"
                  >
                    <RefreshCw
                      className={cn("h-3 w-3 text-slate-400", isLoading && "animate-spin")}
                      aria-hidden="true"
                    />
                  </button>
                </div>
              </div>

              {/* Summary */}
              {summary && (
                <p className="text-xs text-slate-300 leading-relaxed">{summary}</p>
              )}

              {/* Staleness indicator */}
              <StalenessIndicator isStale={isStale} onRefresh={refresh} />

              {/* Findings list */}
              {findings.length > 0 && (
                <div className="space-y-2" role="list" aria-label="Pipeline findings">
                  {findings.map((finding) => (
                    <div key={finding.id} role="listitem">
                      <FindingCard
                        finding={finding}
                        isStale={isStale}
                        onPatchApplied={schedulePostPatchRefresh}
                        onExplain={onExplain}
                        state={state}
                        setState={setState}
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* No findings (all clear) */}
              {findings.length === 0 && !isLoading && (
                <div className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                  <span className="text-xs text-emerald-300">
                    No issues found — your pipeline looks good!
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
