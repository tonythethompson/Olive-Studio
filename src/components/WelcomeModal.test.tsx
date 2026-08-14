import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
