import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsMenu } from "./SettingsMenu";

describe("SettingsMenu", () => {
  it("does not offer the tour when no handler is provided", async () => {
    const user = userEvent.setup();
    render(<SettingsMenu />);
    await user.click(screen.getByLabelText("Settings"));
    expect(screen.queryByText("Take the tour")).toBeNull();
  });

  it("invokes onTakeTour and closes the menu when 'Take the tour' is clicked", async () => {
    const user = userEvent.setup();
    const onTakeTour = vi.fn();
    render(<SettingsMenu onTakeTour={onTakeTour} />);
    await user.click(screen.getByLabelText("Settings"));
    await user.click(screen.getByText("Take the tour"));
    expect(onTakeTour).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("invokes onOpenLicense and closes the menu when MIT License is clicked", async () => {
    const user = userEvent.setup();
    const onOpenLicense = vi.fn();
    render(<SettingsMenu onOpenLicense={onOpenLicense} />);
    await user.click(screen.getByLabelText("Settings"));
    await user.click(screen.getByText("MIT License"));
    expect(onOpenLicense).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
