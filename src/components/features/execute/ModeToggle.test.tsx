/**
 * Component tests for ModeToggle.
 * Validates Requirements 6.1 (mutually exclusive modes, Manual default)
 * and 6.2 (hide/show controls based on mode) at the toggle level.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ModeToggle } from "./ModeToggle";

describe("ModeToggle", () => {
  it("renders Manual and Agent options", () => {
    render(<ModeToggle mode="manual" onModeChange={() => {}} />);
    expect(screen.getByText("Manual")).toBeTruthy();
    expect(screen.getByText("Agent")).toBeTruthy();
  });

  it("marks Manual as active when mode is manual", () => {
    render(<ModeToggle mode="manual" onModeChange={() => {}} />);
    const manualBtn = screen.getByText("Manual");
    const agentBtn = screen.getByText("Agent");
    expect(manualBtn.getAttribute("aria-checked")).toBe("true");
    expect(agentBtn.getAttribute("aria-checked")).toBe("false");
  });

  it("marks Agent as active when mode is agent", () => {
    render(<ModeToggle mode="agent" onModeChange={() => {}} />);
    const manualBtn = screen.getByText("Manual");
    const agentBtn = screen.getByText("Agent");
    expect(manualBtn.getAttribute("aria-checked")).toBe("false");
    expect(agentBtn.getAttribute("aria-checked")).toBe("true");
  });

  it("calls onModeChange when the non-active segment is clicked", () => {
    const onModeChange = vi.fn();
    render(<ModeToggle mode="manual" onModeChange={onModeChange} />);
    fireEvent.click(screen.getByText("Agent"));
    expect(onModeChange).toHaveBeenCalledTimes(1);
    expect(onModeChange).toHaveBeenCalledWith("agent");
  });

  it("does not call onModeChange when the already-active segment is clicked", () => {
    const onModeChange = vi.fn();
    render(<ModeToggle mode="manual" onModeChange={onModeChange} />);
    fireEvent.click(screen.getByText("Manual"));
    expect(onModeChange).not.toHaveBeenCalled();
  });

  it("disables interaction when disabled prop is true", () => {
    const onModeChange = vi.fn();
    render(<ModeToggle mode="manual" onModeChange={onModeChange} disabled />);
    const agentBtn = screen.getByText("Agent");
    expect(agentBtn).toHaveProperty("disabled", true);
    fireEvent.click(agentBtn);
    expect(onModeChange).not.toHaveBeenCalled();
  });

  it("uses radiogroup role for accessibility", () => {
    render(<ModeToggle mode="manual" onModeChange={() => {}} />);
    const radiogroup = screen.getByRole("radiogroup");
    expect(radiogroup).toBeTruthy();
    expect(radiogroup.getAttribute("aria-label")).toBe("Execution mode");
  });

  it("uses radio role on each segment button", () => {
    render(<ModeToggle mode="manual" onModeChange={() => {}} />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
  });
});
