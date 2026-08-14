import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WelcomeModal } from "./WelcomeModal";
import { usePreferencesStore } from "@/lib/stores/preferencesStore";

vi.mock("@/lib/openExternal", () => ({ openExternal: vi.fn() }));

describe("WelcomeModal", () => {
  beforeEach(() => {
    usePreferencesStore.setState({ welcomeDismissed: false });
  });

  it("renders nothing when closed", () => {
    render(<WelcomeModal open={false} onClose={() => {}} />);
    expect(screen.queryByText("Welcome to Olive Studio")).toBeNull();
  });

  it("renders the Olive overview, app features, assistant, and GitHub link when open", () => {
    render(<WelcomeModal open={true} onClose={() => {}} />);
    expect(screen.getByText("Welcome to Olive Studio")).toBeTruthy();
    expect(screen.getByText("What is Microsoft Olive?")).toBeTruthy();
    expect(screen.getByText("What you can do here")).toBeTruthy();
    expect(screen.getByText("The Assistant")).toBeTruthy();
    expect(screen.getByText("GitHub")).toBeTruthy();
  });

  it("closes without persisting dismissal when the checkbox is unchecked", async () => {
    const onClose = vi.fn();
    render(<WelcomeModal open={true} onClose={onClose} />);
    await userEvent.click(screen.getByText("Get started"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(usePreferencesStore.getState().welcomeDismissed).toBe(false);
  });

  it("persists dismissal when 'Don't show again' is checked", async () => {
    const onClose = vi.fn();
    render(<WelcomeModal open={true} onClose={onClose} />);
    await userEvent.click(screen.getByLabelText(/don't show again/i));
    await userEvent.click(screen.getByText("Get started"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(usePreferencesStore.getState().welcomeDismissed).toBe(true);
  });

  it("resets the checkbox when reopened", async () => {
    const { rerender } = render(<WelcomeModal open={true} onClose={() => {}} />);
    await userEvent.click(screen.getByLabelText(/don't show again/i));
    rerender(<WelcomeModal open={false} onClose={() => {}} />);
    rerender(<WelcomeModal open={true} onClose={() => {}} />);
    expect(screen.getByLabelText(/don't show again/i)).not.toBeChecked?.() ??
      expect((screen.getByLabelText(/don't show again/i) as HTMLInputElement).checked).toBe(false);
  });

  it("does not persist 'Don't show again' on backdrop click", async () => {
    const onClose = vi.fn();
    render(<WelcomeModal open={true} onClose={onClose} />);
    await userEvent.click(screen.getByLabelText(/don't show again/i));
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(usePreferencesStore.getState().welcomeDismissed).toBe(false);
  });

  it("does not persist 'Don't show again' on Escape", async () => {
    const onClose = vi.fn();
    render(<WelcomeModal open={true} onClose={onClose} />);
    await userEvent.click(screen.getByLabelText(/don't show again/i));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(usePreferencesStore.getState().welcomeDismissed).toBe(false);
  });

  it("moves focus to the close button on open", async () => {
    render(<WelcomeModal open={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText("Close"));
    });
  });

  it("contains Tab navigation within the dialog", async () => {
    render(<WelcomeModal open={true} onClose={() => {}} />);
    const closeButton = screen.getByLabelText("Close");
    const getStarted = screen.getByText("Get started");

    // Tab from the last focusable element wraps to the first
    getStarted.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(closeButton);

    // Shift+Tab from the first focusable element wraps to the last
    closeButton.focus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(getStarted);
  });

  it("dismisses on Escape", async () => {
    const onClose = vi.fn();
    render(<WelcomeModal open={true} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores focus to the previously focused element on close", async () => {
    const trigger = document.createElement("button");
    trigger.textContent = "trigger";
    document.body.appendChild(trigger);
    trigger.focus();

    const { rerender } = render(<WelcomeModal open={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText("Close"));
    });

    rerender(<WelcomeModal open={false} onClose={() => {}} />);
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
