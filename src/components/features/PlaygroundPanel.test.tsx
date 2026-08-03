/**
 * Component tests for PlaygroundPanel sub-view tabs (Task 11.1).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlaygroundPanel } from "./PlaygroundPanel";
import { usePlaygroundStore } from "@/lib/stores/playgroundStore";

vi.mock("./InBrowserValidation", () => ({
  InBrowserValidation: () => <div data-testid="browser-test-panel">Browser Test Panel</div>,
}));

vi.mock("./WebGpuBenchmarkPanel", () => ({
  WebGpuBenchmarkPanel: () => <div data-testid="benchmark-panel">Benchmark Panel</div>,
}));

vi.mock("./ArenaPanel", () => ({
  ArenaPanel: () => <div data-testid="arena-panel">Arena Panel</div>,
}));

describe("PlaygroundPanel", () => {
  beforeEach(() => {
    usePlaygroundStore.getState().resetPlayground();
  });

  it("renders the three sub-view tab buttons", async () => {
    render(<PlaygroundPanel />);

    expect(screen.getByRole("tab", { name: /browser test/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /benchmark/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /arena/i })).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByTestId("browser-test-panel")).toBeTruthy();
    });
  });

  it("shows Browser Test by default and keeps it selected", async () => {
    render(<PlaygroundPanel />);

    const browserTab = screen.getByRole("tab", { name: /browser test/i });
    expect(browserTab.getAttribute("aria-selected")).toBe("true");
    expect(usePlaygroundStore.getState().activeSubView).toBe("browser-test");

    await waitFor(() => {
      expect(screen.getByTestId("browser-test-panel")).toBeTruthy();
    });
    expect(screen.getByTestId("browser-test-panel").closest("[role='tabpanel']")?.hasAttribute("hidden")).toBe(
      false,
    );
  });

  it("updates activeSubView in the store when Arena is selected", async () => {
    const user = userEvent.setup();
    render(<PlaygroundPanel />);

    await user.click(screen.getByRole("tab", { name: /arena/i }));

    await waitFor(() => {
      expect(usePlaygroundStore.getState().activeSubView).toBe("arena");
    });
    expect(screen.getByRole("tab", { name: /arena/i }).getAttribute("aria-selected")).toBe("true");

    await waitFor(() => {
      expect(screen.getByTestId("arena-panel")).toBeTruthy();
    });
  });

  it("keep-alive mounts Benchmark after first visit without unmounting Browser Test", async () => {
    const user = userEvent.setup();
    render(<PlaygroundPanel />);

    await waitFor(() => {
      expect(screen.getByTestId("browser-test-panel")).toBeTruthy();
    });

    await user.click(screen.getByRole("tab", { name: /benchmark/i }));
    await waitFor(() => {
      expect(screen.getByTestId("benchmark-panel")).toBeTruthy();
    });

    // Browser Test panel remains in the tree (hidden), not unmounted
    expect(screen.getByTestId("browser-test-panel")).toBeTruthy();
    expect(screen.getByTestId("browser-test-panel").closest("[role='tabpanel']")?.hasAttribute("hidden")).toBe(
      true,
    );
  });
});
