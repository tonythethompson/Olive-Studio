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

import { useRef } from "react";
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
  const buttonRefs = useRef<Record<"manual" | "agent", HTMLButtonElement | null>>({
    manual: null,
    agent: null,
  });

  const focusSegment = (targetMode: "manual" | "agent") => {
    requestAnimationFrame(() => {
      buttonRefs.current[targetMode]?.focus();
    });
  };

  return (
    <div
      role="radiogroup"
      aria-label="Execution mode"
      data-testid="mode-toggle"
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const next = mode === "manual" ? "agent" : "manual";
        onModeChange(next);
        focusSegment(next);
      }}
      className={cn(
        "inline-flex rounded-md border border-slate-700 bg-slate-900 p-0.5",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      {SEGMENTS.map((segment) => {
        const isActive = mode === segment.value;
        return (
          <button
            key={segment.value}
            ref={(el) => {
              buttonRefs.current[segment.value] = el;
            }}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-disabled={disabled}
            disabled={disabled}
            tabIndex={disabled || !isActive ? -1 : 0}
            onClick={() => {
              if (!isActive) {
                onModeChange(segment.value);
                focusSegment(segment.value);
              }
            }}
            className={cn(
              "relative px-3 py-1 text-sm font-medium transition-colors duration-150",
              "rounded-[5px] outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
              isActive
                ? "bg-slate-800 text-slate-100 shadow-sm"
                : "text-slate-400 hover:text-slate-200",
            )}
          >
            {segment.label}
          </button>
        );
      })}
    </div>
  );
}
