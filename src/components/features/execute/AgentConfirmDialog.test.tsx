/**
 * Component tests for AgentConfirmDialog.
 * Validates Requirement 6.5:
 * - Confirmation dialog shown when switching from Agent to Manual while agent running
 * - "Confirm" cancels agent + switches mode
 * - "Cancel" dismisses and stays in Agent mode
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { AgentConfirmDialog } from "./AgentConfirmDialog";

describe("AgentConfirmDialog", () => {
  it("renders nothing when open is false", () => {
    const { container } = render(
      <AgentConfirmDialog open={false} onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders the dialog when open is true", () => {
    render(
      <AgentConfirmDialog open={true} onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Stop Agent?")).toBeTruthy();
  });

  it("uses aria-modal and aria-labelledby for accessibility", () => {
    render(
      <AgentConfirmDialog open={true} onConfirm={() => {}} onCancel={() => {}} />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBe("agent-confirm-title");
  });

  it("displays a warning message about stopping the agent", () => {
    render(
      <AgentConfirmDialog open={true} onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(
      screen.getByText(/switching to Manual mode will cancel the active agent loop/i),
    ).toBeTruthy();
  });

  it("renders Confirm and Cancel buttons", () => {
    render(
      <AgentConfirmDialog open={true} onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(screen.getByText("Confirm")).toBeTruthy();
    expect(screen.getByText("Cancel")).toBeTruthy();
  });

  it("calls onConfirm when Confirm button is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <AgentConfirmDialog open={true} onConfirm={onConfirm} onCancel={() => {}} />,
    );
    fireEvent.click(screen.getByText("Confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when Cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(
      <AgentConfirmDialog open={true} onConfirm={() => {}} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when backdrop is clicked", () => {
    const onCancel = vi.fn();
    render(
      <AgentConfirmDialog open={true} onConfirm={() => {}} onCancel={onCancel} />,
    );
    // The backdrop is the outermost div with data-testid="agent-confirm-dialog"
    const backdrop = screen.getByTestId("agent-confirm-dialog");
    fireEvent.click(backdrop);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not call onCancel when inner content is clicked (no propagation issue)", () => {
    const onCancel = vi.fn();
    render(
      <AgentConfirmDialog open={true} onConfirm={() => {}} onCancel={onCancel} />,
    );
    // Click on the title — should not trigger backdrop dismiss
    fireEvent.click(screen.getByText("Stop Agent?"));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("calls onCancel when Escape key is pressed", () => {
    const onCancel = vi.fn();
    render(
      <AgentConfirmDialog open={true} onConfirm={() => {}} onCancel={onCancel} />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("deactivates Escape listener after open becomes false and after unmount", () => {
    const onCancel = vi.fn();
    const { rerender, unmount } = render(
      <AgentConfirmDialog open={true} onConfirm={() => {}} onCancel={onCancel} />,
    );

    rerender(<AgentConfirmDialog open={false} onConfirm={() => {}} onCancel={onCancel} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();

    rerender(<AgentConfirmDialog open={true} onConfirm={() => {}} onCancel={onCancel} />);
    unmount();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("places initial focus inside the dialog element when opened", async () => {
    const onCancel = vi.fn();
    render(
      <AgentConfirmDialog open={true} onConfirm={() => {}} onCancel={onCancel} />,
    );
    const dialog = screen.getByRole("dialog");
    await vi.waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
  });
});
