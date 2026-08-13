/**
 * ActivityLog — Scrollable chronological activity log for Agent execution mode.
 *
 * Renders a list of ActivityLogEntry items with:
 * - Auto-scroll to latest entry unless user has scrolled away from bottom
 * - Empty state message when no entries exist
 * - Max-height scrollable container for up to 2000 entries
 *
 * Requirements: 7.1, 7.3, 7.5, 7.6
 */

import { useCallback, useEffect, useRef } from "react";

import { cn } from "@/lib/utils";
import type { ActivityLogEntry as ActivityLogEntryType } from "@/lib/types/agentTypes";
import { ActivityLogEntry } from "./ActivityLogEntry";

// ─── Constants ──────────────────────────────────────────────────────────────────

/** Threshold (px) from the bottom within which auto-scroll stays active. */
const AUTO_SCROLL_THRESHOLD = 50;

// ─── Props ──────────────────────────────────────────────────────────────────────

export interface ActivityLogProps {
  /** Chronological activity log entries. */
  entries: ActivityLogEntryType[];
  /** Optional additional CSS class names. */
  className?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────────

export function ActivityLog({ entries, className }: ActivityLogProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  /**
   * Check whether the scroll container is near the bottom.
   * "Near bottom" means within AUTO_SCROLL_THRESHOLD pixels of the max scroll.
   */
  const checkIfNearBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    const { scrollTop, scrollHeight, clientHeight } = el;
    return scrollHeight - scrollTop - clientHeight <= AUTO_SCROLL_THRESHOLD;
  }, []);

  /**
   * Handle scroll events to track whether user is near bottom.
   */
  const handleScroll = useCallback(() => {
    isNearBottomRef.current = checkIfNearBottom();
  }, [checkIfNearBottom]);

  /**
   * Auto-scroll to bottom when new entries arrive AND user was at bottom.
   */
  useEffect(() => {
    if (isNearBottomRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [entries]);

  // ─── Empty State ────────────────────────────────────────────────────────────

  if (entries.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-md border border-dashed",
          "border-zinc-300 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-900",
          "min-h-[200px] text-sm text-zinc-500 dark:text-zinc-400",
          className,
        )}
      >
        No activity yet
      </div>
    );
  }

  // ─── Activity List ──────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={cn(
        "overflow-y-auto max-h-[600px] rounded-md border",
        "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900",
        className,
      )}
      role="log"
      aria-label="Agent activity log"
      aria-live="polite"
    >
      {entries.map((entry) => (
        <ActivityLogEntry key={entry.id} entry={entry} />
      ))}
    </div>
  );
}
