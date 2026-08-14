/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WIDE_SHELL_MIN_WIDTH_PX } from "@/components/DesktopMinimumViewport";

const setSize = vi.fn(async () => {});
const getCurrentWindow = vi.fn(() => ({ setSize }));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow,
}));

vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalSize: class LogicalSize {
    constructor(
      public width: number,
      public height: number,
    ) {}
  },
}));

import { ensureDesktopTourViewport } from "./tourViewport";

describe("ensureDesktopTourViewport", () => {
  const originalInnerWidth = window.innerWidth;
  const originalInnerHeight = window.innerHeight;
  const originalAvailWidth = window.screen.availWidth;
  const originalAvailHeight = window.screen.availHeight;
  const originalResizeTo = window.resizeTo;

  beforeEach(() => {
    vi.clearAllMocks();
    window.resizeTo = vi.fn();
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 700 });
    Object.defineProperty(window.screen, "availHeight", { configurable: true, value: 1080 });
  });

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
    Object.defineProperty(window.screen, "availWidth", { configurable: true, value: originalAvailWidth });
    Object.defineProperty(window.screen, "availHeight", { configurable: true, value: originalAvailHeight });
    window.resizeTo = originalResizeTo;
  });

  it("returns true without resizing when already wide enough", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: WIDE_SHELL_MIN_WIDTH_PX });
    Object.defineProperty(window.screen, "availWidth", { configurable: true, value: 1440 });
    await expect(ensureDesktopTourViewport()).resolves.toBe(true);
    expect(getCurrentWindow).not.toHaveBeenCalled();
    expect(window.resizeTo).not.toHaveBeenCalled();
  });

  it("returns false without resizing when the display is too small", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    Object.defineProperty(window.screen, "availWidth", { configurable: true, value: 800 });
    await expect(ensureDesktopTourViewport()).resolves.toBe(false);
    expect(getCurrentWindow).not.toHaveBeenCalled();
    expect(window.resizeTo).not.toHaveBeenCalled();
  });

  it("grows a phone-narrow window when the display has room", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });
    Object.defineProperty(window.screen, "availWidth", { configurable: true, value: 1440 });
    setSize.mockImplementation(async () => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: WIDE_SHELL_MIN_WIDTH_PX });
    });
    await expect(ensureDesktopTourViewport()).resolves.toBe(true);
    expect(setSize).toHaveBeenCalledTimes(1);
  });
});
