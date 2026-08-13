/**
 * ModeToggle — Segmented button for Manual / Agent execution mode.
 *
 * A simple, focused component rendering two mutually exclusive options
 * as a segmented button control. The active mode is visually highlighted.
 * No confirmation dialog logic here — that responsibility belongs to
 * AgentConfirmDialog (composed at the parent level).
 *
 * Requirements: 6.1, 6.2
 */

import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface ModeToggleProps {
  /** Current execution mode. */
  mode: "manual" | "agent";
  /** Called when the user selects a different mode. */
  onModeChange: (mode: "manual" | "agent") => void;
  /** When true, the toggle is non-interactive (greyed out). */
  disabled?: boolean;
}

// ─── Segment Configuration ──────────────────────────────────────────────────────

interface Segment {
  value: "manual" | "agent";
  label: string;
}

const SEGMENTS: Segment[] = [
  { value: "manual", label: "Manual" },
  { value: "agent", label: "Agent" },
];

// ─── Component ──────────────────────────────────────────────────────────────────

export function ModeToggle({ mode, onModeChange, disabled = false }: ModeToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Execution mode"
      data-testid="mode-toggle"
      className={cn(
        "inline-flex rounded-md border border-zinc-200 bg-zinc-100 p-0.5",
        "dark:border-zinc-700 dark:bg-zinc-800",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      {SEGMENTS.map((segment) => {
        const isActive = mode === segment.value;
        return (
          <button
            key={segment.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-disabled={disabled}
            disabled={disabled}
            tabIndex={disabled ? -1 : 0}
            onClick={() => {
              if (!isActive) {
                onModeChange(segment.value);
              }
            }}
            className={cn(
              "relative px-3 py-1 text-sm font-medium transition-colors duration-150",
              "rounded-[5px] outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
              isActive
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200",
            )}
          >
            {segment.label}
          </button>
        );
      })}
    </div>
  );
}
