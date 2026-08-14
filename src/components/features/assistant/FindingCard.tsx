/**
 * Renders a single Finding from the Pipeline Review.
 *
 * Displays severity badge, title, truncated description with expand/collapse,
 * evidence text, and a row of ActionButtons. When `isStale` is true, applies
 * a visual overlay indicating the finding is outdated.
 *
 * @see Requirements 2.1, 2.4
 * @module FindingCard
 */

import { useState, useCallback } from "react";
import { AlertCircle, AlertTriangle, Info, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Finding, FindingSeverity } from "@/lib/types/findingTypes";
import type { UIState } from "@/types";
import { ActionButton } from "./ActionButton";

// ─── Props ───────────────────────────────────────────────────────────────────

export interface FindingCardProps {
  /** The finding to render. */
  finding: Finding;
  /** Whether this finding is stale (fingerprint mismatch). */
  isStale: boolean;
  /**
   * Callback invoked after a successful applyPatch commit.
   * Passed through to each ActionButton.
   */
  onPatchApplied?: () => void;
  /** Callback to inject an explanation body into the chat panel. */
  onExplain?: (body: string) => void;
  state?: UIState;
  setState?: (partial: Partial<UIState>) => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Maximum characters shown before truncation in the description. */
const DESCRIPTION_TRUNCATE_LIMIT = 200;

// ─── Severity Config ─────────────────────────────────────────────────────────

const SEVERITY_CONFIG: Record<
  FindingSeverity,
  { label: string; icon: typeof AlertCircle; badgeClass: string; borderClass: string }
> = {
  critical: {
    label: "Critical",
    icon: AlertCircle,
    badgeClass: "bg-rose-500/20 text-rose-300 border-rose-500/40",
    borderClass: "border-l-rose-500",
  },
  warning: {
    label: "Warning",
    icon: AlertTriangle,
    badgeClass: "bg-amber-500/20 text-amber-300 border-amber-500/40",
    borderClass: "border-l-amber-500",
  },
  info: {
    label: "Info",
    icon: Info,
    badgeClass: "bg-blue-500/20 text-blue-300 border-blue-500/40",
    borderClass: "border-l-blue-500",
  },
};

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Renders a finding card with severity badge, title, description (truncated
 * with expand toggle), evidence, and action buttons.
 *
 * Requirements:
 * - 2.1: Displays all Finding fields per the structural contract.
 * - 2.4: Renders at least one Action per Finding via ActionButton components.
 */
export function FindingCard({
  finding,
  isStale,
  onPatchApplied,
  onExplain,
  state,
  setState,
}: FindingCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const config = SEVERITY_CONFIG[finding.severity] ?? SEVERITY_CONFIG.info;
  const SeverityIcon = config.icon;

  const isTruncated = finding.description.length > DESCRIPTION_TRUNCATE_LIMIT;
  const displayDescription = isExpanded || !isTruncated
    ? finding.description
    : `${finding.description.slice(0, DESCRIPTION_TRUNCATE_LIMIT)}…`;

  const toggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  return (
    <div
      className={cn(
        "relative rounded-lg border border-slate-700/60 bg-slate-900/60 p-3 transition-all",
        "border-l-[3px]",
        config.borderClass,
        isStale && "opacity-50 pointer-events-none select-none",
      )}
      data-finding-id={finding.id}
      role="article"
      aria-label={`Finding: ${finding.title}`}
      inert={isStale || undefined}
    >
      {/* Staleness overlay indicator */}
      {isStale && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-slate-950/40"
          aria-hidden="true"
        >
          <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
            Outdated
          </span>
        </div>
      )}

      {/* Header: Severity badge + Title */}
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            config.badgeClass,
          )}
        >
          <SeverityIcon className="h-3 w-3" aria-hidden="true" />
          {config.label}
        </span>
        <h4 className="text-sm font-medium text-slate-100 leading-tight">
          {finding.title}
        </h4>
      </div>

      {/* Description */}
      <div className="mt-2">
        <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
          {displayDescription}
        </p>
        {isTruncated && (
          <button
            type="button"
            onClick={toggleExpand}
            className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-medium text-electric-blue hover:text-electric-blue/80 transition-colors cursor-pointer"
            aria-expanded={isExpanded}
          >
            {isExpanded ? (
              <>
                <ChevronUp className="h-3 w-3" aria-hidden="true" />
                Show less
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" aria-hidden="true" />
                Show more
              </>
            )}
          </button>
        )}
      </div>

      {/* Evidence */}
      {finding.evidence && (
        <p className="mt-2 text-[11px] text-slate-400 italic leading-relaxed">
          {finding.evidence}
        </p>
      )}

      {/* Action Buttons */}
      {finding.actions.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {finding.actions.map((action, idx) => (
            <ActionButton
              key={`${finding.id}-action-${idx}`}
              action={action}
              onPatchApplied={onPatchApplied}
              onExplain={onExplain}
              state={state}
              setState={setState}
            />
          ))}
        </div>
      )}
    </div>
  );
}
