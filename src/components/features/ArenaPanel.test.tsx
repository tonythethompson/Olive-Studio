/**
 * Component tests for ArenaPanel (Tasks 11.2, 11.3, 11.5).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ArenaPanel,
  SlotResultPanel,
  localOptsForArenaSlot,
  type ArenaRunResult,
} from "./ArenaPanel";
import { usePlaygroundStore } from "@/lib/stores/playgroundStore";

function resetArenaSlots(): void {
  usePlaygroundStore.getState().resetPlayground();
}

describe("ArenaPanel", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetArenaSlots();
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    resetArenaSlots();
  });

  it("renders a local file drop-zone by default", () => {
    render(<ArenaPanel />);
    expect(screen.getAllByLabelText(/select onnx model file/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/drop a model here/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("button", { name: /local file/i }).length).toBe(2);
  });

  it("selecting Cloud / API renders endpoint, API key, and model ID inputs", async () => {
    const user = userEvent.setup();
    render(<ArenaPanel />);

    const cloudToggles = screen.getAllByRole("button", { name: /cloud \/ api/i });
    await user.click(cloudToggles[0]!);

    expect(screen.getByLabelText(/endpoint url/i)).toBeTruthy();
    expect(screen.getByLabelText(/^api key/i)).toBeTruthy();
    expect(screen.getByLabelText(/^model id/i)).toBeTruthy();
  });

  it("disables Run Arena when a cloud slot needs a prompt", async () => {
    const user = userEvent.setup();
    render(<ArenaPanel />);

    const cloudToggles = screen.getAllByRole("button", { name: /cloud \/ api/i });
    await user.click(cloudToggles[0]!);

    const runButton = screen.getByRole("button", { name: /run arena/i }) as HTMLButtonElement;
    expect(runButton.disabled).toBe(true);

    await user.type(screen.getByLabelText(/^prompt$/i), "   ");
    expect(runButton.disabled).toBe(true);

    await user.clear(screen.getByLabelText(/^prompt$/i));
    await user.type(screen.getByLabelText(/^prompt$/i), "hello arena");
    expect(runButton.disabled).toBe(false);
  });

  it("keeps Run Arena disabled while a cloud run is in flight", async () => {
    const user = userEvent.setup();
    fetchSpy.mockImplementation(
      () =>
        new Promise(() => {
          /* hang so isRunning stays true */
        }),
    );

    render(<ArenaPanel />);

    const cloudToggles = screen.getAllByRole("button", { name: /cloud \/ api/i });
    await user.click(cloudToggles[0]!);

    await user.type(screen.getByLabelText(/endpoint url/i), "https://api.example.com/v1");
    await user.type(screen.getByLabelText(/^prompt$/i), "ping");

    const runButton = screen.getByRole("button", { name: /run arena/i }) as HTMLButtonElement;
    expect(runButton.disabled).toBe(false);

    await act(async () => {
      await user.click(runButton);
    });

    await waitFor(() => {
      const running = screen.getByRole("button", { name: /running/i }) as HTMLButtonElement;
      expect(running.disabled).toBe(true);
    });
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("builds per-slot local opts with distinct tokenizer ids and a shared seed", () => {
    const seedKey = "shared-seed";
    const optsA = localOptsForArenaSlot(
      {
        type: "local",
        file: null,
        tokenizerId: "org/tokenizer-a",
        endpointUrl: "",
        apiKey: "",
        modelId: "",
      },
      "hello",
      seedKey,
    );
    const optsB = localOptsForArenaSlot(
      {
        type: "local",
        file: null,
        tokenizerId: "org/tokenizer-b",
        endpointUrl: "",
        apiKey: "",
        modelId: "",
      },
      "hello",
      seedKey,
    );

    expect(optsA).toEqual({
      prompt: "hello",
      seedKey,
      tokenizerId: "org/tokenizer-a",
    });
    expect(optsB).toEqual({
      prompt: "hello",
      seedKey,
      tokenizerId: "org/tokenizer-b",
    });
    expect(optsA.tokenizerId).not.toBe(optsB.tokenizerId);
  });

  it("uses items-start on the two-column slot grid for unequal-height columns", () => {
    const { container } = render(<ArenaPanel />);
    const grid = container.querySelector(".items-start");
    expect(grid).toBeTruthy();
    expect(grid?.className).toMatch(/grid-cols-1/);
    expect(grid?.className).toMatch(/lg:grid-cols-2/);
  });

  it("does not call scrollIntoView on initial render", () => {
    // jsdom does not implement scrollIntoView — define a stub before spying.
    Element.prototype.scrollIntoView = vi.fn();
    const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView");
    render(<ArenaPanel />);
    expect(scrollSpy).not.toHaveBeenCalled();
    scrollSpy.mockRestore();
  });
});

describe("SlotResultPanel highlighting and error layout (Tasks 11.3, 11.5)", () => {
  it("applies emerald classes to the faster slot's latency", () => {
    const resultA: ArenaRunResult = {
      output: "fast",
      elapsedMs: 100,
      status: "done",
    };
    const resultB: ArenaRunResult = {
      output: "slow",
      elapsedMs: 200,
      status: "done",
    };

    render(
      <div>
        <SlotResultPanel label="Slot A" result={resultA} isWinner />
        <SlotResultPanel label="Slot B" result={resultB} isWinner={false} />
      </div>,
    );

    const fasterLatency = screen.getByText(/100\.0 ms/);
    const slowerLatency = screen.getByText(/200\.0 ms/);

    expect(fasterLatency.className).toMatch(/text-emerald-400/);
    expect(fasterLatency.className).toMatch(/font-semibold/);
    expect(slowerLatency.className).not.toMatch(/text-emerald-400/);
    expect(screen.getByText(/· faster/i)).toBeTruthy();
  });

  it("bounds long error strings with max height + overflow scroll", () => {
    const longError = "x".repeat(5000);
    render(
      <SlotResultPanel
        label="Slot A"
        result={{ output: "", elapsedMs: 0, status: "error", error: longError }}
      />,
    );

    const errorEl = screen.getByTestId("slot-a-error");
    expect(errorEl.textContent).toBe(longError);
    expect(errorEl.className).toMatch(/max-h-24/);
    expect(errorEl.className).toMatch(/overflow-y-auto/);
  });
});

describe("playgroundStore lifecycle contract (Task 11.5)", () => {
  it("does not wrap create in persist middleware", async () => {
    const store = usePlaygroundStore as typeof usePlaygroundStore & {
      persist?: unknown;
    };
    expect(store.persist).toBeUndefined();

    // Regression: session reset still clears slots after store mutations
    usePlaygroundStore.getState().setSlotA({ type: "cloud", apiKey: "sk" });
    usePlaygroundStore.getState().resetPlayground();
    expect(usePlaygroundStore.getState().slotA.type).toBe("local");
    expect(usePlaygroundStore.getState().slotA.apiKey).toBe("");
  });
});
