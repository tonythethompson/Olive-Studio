import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsMenu } from "./SettingsMenu";

describe("SettingsMenu", () => {
  it("does not offer the tour when no handler is provided", async () => {
    render(<SettingsMenu />);
    await userEvent.click(screen.getByLabelText("Settings"));
    expect(screen.queryByText("Take the tour")).toBeNull();
  });

  it("invokes onTakeTour and closes the menu when 'Take the tour' is clicked", async () => {
    const onTakeTour = vi.fn();
    render(<SettingsMenu onTakeTour={onTakeTour} />);
    await userEvent.click(screen.getByLabelText("Settings"));
    await userEvent.click(screen.getByText("Take the tour"));
    expect(onTakeTour).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("invokes onOpenLicense and closes the menu when MIT License is clicked", async () => {
    const onOpenLicense = vi.fn();
    render(<SettingsMenu onOpenLicense={onOpenLicense} />);
    await userEvent.click(screen.getByLabelText("Settings"));
    await userEvent.click(screen.getByText("MIT License"));
    expect(onOpenLicense).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
