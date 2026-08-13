/**
 * Component tests for AgentControls.
 * Validates Requirements 6.3, 6.4, 6.6 at the controls level:
 *  - Start/Stop button enabled/disabled based on agentRunning
 *  - Status indicator reflects current agent state
 *  - Terminal outcome is surfaced in the status display
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { AgentControls } from "./AgentControls";
import type { AgentOutcome } from "@/lib/types/agentTypes";

describe("AgentControls", () => {
  // ─── Idle state (default) ─────────────────────────────────────────────────────

  it("renders Start Agent and Stop Agent buttons", () => {
    render(<AgentControls agentRunning={false} onStart={() => { }} onStop={() => { }} />);
    expect(screen.getByRole("button", { name: /start agent/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /stop agent/i })).toBeTruthy();
  });

  it("shows 'Idle' status when not running and no outcome", () => {
    render(<AgentControls agentRunning={false} onStart={() => { }} onStop={() => { }} />);
    expect(screen.getByText("Idle")).toBeTruthy();
  });

  it("enables Start button and disables Stop button when idle", () => {
    render(<AgentControls agentRunning={false} onStart={() => { }} onStop={() => { }} />);
    const startBtn = screen.getByRole("button", { name: /start agent/i });
    const stopBtn = screen.getByRole("button", { name: /stop agent/i });
    expect(startBtn).toHaveProperty("disabled", false);
    expect(stopBtn).toHaveProperty("disabled", true);
  });

  // ─── Running state ────────────────────────────────────────────────────────────

  it("shows 'Running' status when agent is running", () => {
    render(<AgentControls agentRunning={true} onStart={() => { }} onStop={() => { }} />);
    expect(screen.getByText("Running")).toBeTruthy();
  });

  it("disables Start button and enables Stop button when running", () => {
    render(<AgentControls agentRunning={true} onStart={() => { }} onStop={() => { }} />);
    const startBtn = screen.getByRole("button", { name: /start agent/i });
    const stopBtn = screen.getByRole("button", { name: /stop agent/i });
    expect(startBtn).toHaveProperty("disabled", true);
    expect(stopBtn).toHaveProperty("disabled", false);
  });

  // ─── Outcome states ───────────────────────────────────────────────────────────

  it("shows 'Completed' status when outcome is success", () => {
    const outcome: AgentOutcome = { status: "success", totalSteps: 5, elapsedMs: 2000 };
    render(<AgentControls agentRunning={false} onStart={() => { }} onStop={() => { }} outcome={outcome} />);
    expect(screen.getByText("Completed")).toBeTruthy();
  });

  it("shows 'Failed' status when outcome is failure", () => {
    const outcome: AgentOutcome = {
      status: "failure",
      totalSteps: 3,
      elapsedMs: 1500,
      errorDescription: "MCP tool timeout",
    };
    render(<AgentControls agentRunning={false} onStart={() => { }} onStop={() => { }} outcome={outcome} />);
    expect(screen.getByText("Failed")).toBeTruthy();
  });

  it("shows 'Cancelled' status when outcome is cancelled", () => {
    const outcome: AgentOutcome = {
      status: "cancelled",
      totalSteps: 7,
      elapsedMs: 3000,
      cancelledAtStep: 7,
    };
    render(<AgentControls agentRunning={false} onStart={() => { }} onStop={() => { }} outcome={outcome} />);
    expect(screen.getByText("Cancelled")).toBeTruthy();
  });

  // ─── Interaction ──────────────────────────────────────────────────────────────

  it("calls onStart when Start Agent is clicked", () => {
    const onStart = vi.fn();
    render(<AgentControls agentRunning={false} onStart={onStart} onStop={() => { }} />);
    fireEvent.click(screen.getByRole("button", { name: /start agent/i }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("calls onStop when Stop Agent is clicked while running", () => {
    const onStop = vi.fn();
    render(<AgentControls agentRunning={true} onStart={() => { }} onStop={onStop} />);
    fireEvent.click(screen.getByRole("button", { name: /stop agent/i }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("does not call onStart when Start is clicked while running", () => {
    const onStart = vi.fn();
    render(<AgentControls agentRunning={true} onStart={onStart} onStop={() => { }} />);
    const startBtn = screen.getByRole("button", { name: /start agent/i });
    fireEvent.click(startBtn);
    expect(onStart).not.toHaveBeenCalled();
  });

  it("does not call onStop when Stop is clicked while idle", () => {
    const onStop = vi.fn();
    render(<AgentControls agentRunning={false} onStart={() => { }} onStop={onStop} />);
    const stopBtn = screen.getByRole("button", { name: /stop agent/i });
    fireEvent.click(stopBtn);
    expect(onStop).not.toHaveBeenCalled();
  });

  // ─── Accessibility ────────────────────────────────────────────────────────────

  it("has a status role element with aria-label describing the agent state", () => {
    render(<AgentControls agentRunning={true} onStart={() => { }} onStop={() => { }} />);
    const statusEl = screen.getByRole("status");
    expect(statusEl.getAttribute("aria-label")).toBe("Agent status: Running");
  });

  it("buttons have aria-labels for screen readers", () => {
    render(<AgentControls agentRunning={false} onStart={() => { }} onStop={() => { }} />);
    expect(screen.getByRole("button", { name: /start agent/i }).getAttribute("aria-label")).toBe("Start Agent");
    expect(screen.getByRole("button", { name: /stop agent/i }).getAttribute("aria-label")).toBe("Stop Agent");
  });
});
