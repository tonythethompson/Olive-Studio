/**
 * ActivityLogEntry — Renders a single activity log entry with kind-specific styling.
 *
 * Displays a timestamp, kind-specific icon with color, entry text, and an
 * expand/collapse toggle when the entry was truncated (expandedText present).
 *
 * Requirements: 7.2
 */

import { useState } from "react";
import {
  Brain,
  Terminal,
  CheckCircle,
  Zap,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActivityLogEntry as ActivityLogEntryType } from "@/lib/types/agentTypes";

// ─── Kind Configuration ─────────────────────────────────────────────────────────

const KIND_CONFIG = {
  reasoning: { icon: Brain, color: "text-blue-400", label: "Reasoning" },
  tool_call: { icon: Terminal, color: "text-purple-400", label: "Tool Call" },
  tool_result: { icon: CheckCircle, color: "text-emerald-400", label: "Tool Result" },
  decision: { icon: Zap, color: "text-amber-400", label: "Decision" },
  error: { icon: AlertTriangle, color: "text-rose-400", label: "Error" },
} as const;

// ─── Props ──────────────────────────────────────────────────────────────────────

export interface ActivityLogEntryProps {
  entry: ActivityLogEntryType;
}

// ─── Component ──────────────────────────────────────────────────────────────────

export function ActivityLogEntry({ entry }: ActivityLogEntryProps) {
  const [expanded, setExpanded] = useState(false);
  const config = KIND_CONFIG[entry.kind as keyof typeof KIND_CONFIG] ?? {
    icon: AlertTriangle,
    color: "text-slate-400",
    label: entry.kind || "Activity",
  };
  const Icon = config.icon;
  const hasTruncated = Boolean(entry.expandedText);

  return (
    <div className="flex items-start gap-2 px-2 py-1.5 text-sm group">
      {/* Timestamp */}
      <span className="shrink-0 font-mono text-xs text-slate-500 dark:text-slate-400 pt-0.5">
        {entry.timestamp}
      </span>

      {/* Kind icon + text label for screen readers */}
      <Icon className={cn("h-4 w-4 shrink-0 mt-0.5", config.color)} aria-hidden="true" />
      <span className="sr-only">[{config.label}]</span>

      {/* Text content */}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "whitespace-pre-wrap break-words text-zinc-700 dark:text-zinc-300",
            entry.kind === "error" && "text-rose-600 dark:text-rose-400",
          )}
        >
          {expanded && entry.expandedText ? entry.expandedText : entry.text}
        </p>

        {/* Expand toggle */}
        {hasTruncated && (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="mt-0.5 text-xs text-blue-500 hover:text-blue-400 focus:outline-none focus-visible:underline"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}

        {/* Step reference for error entries */}
        {entry.stepRef && (
          <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-500">
            (step: {entry.stepRef})
          </span>
        )}
      </div>
    </div>
  );
}
