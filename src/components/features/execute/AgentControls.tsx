/**
 * AgentControls — Start/Stop buttons and status indicator for Agent execution mode.
 *
 * Renders:
 *  1. A colored status indicator (dot/badge) showing the current agent state.
 *  2. A "Start Agent" button (enabled when agent is not running).
 *  3. A "Stop Agent" button (enabled when agent is running).
 *
 * Integrates with useAgentMode hook via props. Does NOT render the activity log
 * (that responsibility belongs to ActivityLog component).
 *
 * Requirements: 6.3, 6.4, 6.6
 */

import { Play, Square, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import type { AgentOutcome } from "@/lib/types/agentTypes";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface AgentControlsProps {
  /** Whether the agent loop is currently running. */
  agentRunning: boolean;
  /** Called when the user presses "Start Agent". */
  onStart: () => void;
  /** Called when the user presses "Stop Agent". */
  onStop: () => void;
  /** Terminal outcome from the last completed agent session. */
  outcome?: AgentOutcome;
}

// ─── Status Configuration ───────────────────────────────────────────────────────

type AgentStatus = "idle" | "running" | "completed" | "failed" | "cancelled";

interface StatusConfig {
  label: string;
  dotClass: string;
}

const STATUS_MAP: Record<AgentStatus, StatusConfig> = {
  idle: {
    label: "Idle",
    dotClass: "bg-zinc-400 dark:bg-zinc-500",
  },
  running: {
    label: "Running",
    dotClass: "bg-emerald-500 animate-pulse",
  },
  completed: {
    label: "Completed",
    dotClass: "bg-emerald-500",
  },
  failed: {
    label: "Failed",
    dotClass: "bg-rose-500",
  },
  cancelled: {
    label: "Cancelled",
    dotClass: "bg-amber-500",
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────────

function mapOutcomeToStatus(outcome: AgentOutcome["status"]): AgentStatus {
  switch (outcome) {
    case "success":
      return "completed";
    case "failure":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
}

// ─── Component ──────────────────────────────────────────────────────────────────

export function AgentControls({
  agentRunning,
  onStart,
  onStop,
  outcome,
}: AgentControlsProps) {
  const status: AgentStatus = agentRunning
    ? "running"
    : outcome
      ? mapOutcomeToStatus(outcome.status)
      : "idle";

  const { label, dotClass } = STATUS_MAP[status];

  return (
    <div className="flex items-center gap-3">
      {/* Status indicator */}
      <div
        className="flex items-center gap-1.5"
        aria-label={`Agent status: ${label}`}
        role="status"
      >
        <Circle
          className={cn("h-2.5 w-2.5 fill-current stroke-none", dotClass)}
          aria-hidden="true"
        />
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          {label}
        </span>
      </div>

      {/* Start Agent */}
      <Button
        onClick={onStart}
        disabled={agentRunning}
        aria-label="Start Agent"
        className="gap-1.5"
      >
        <Play className="h-4 w-4" aria-hidden="true" />
        Start Agent
      </Button>

      {/* Stop Agent */}
      <Button
        variant="danger"
        onClick={onStop}
        disabled={!agentRunning}
        aria-label="Stop Agent"
        className="gap-1.5"
      >
        <Square className="h-4 w-4" aria-hidden="true" />
        Stop Agent
      </Button>
    </div>
  );
}
