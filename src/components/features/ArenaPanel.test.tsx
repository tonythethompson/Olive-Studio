/**
 * Component tests for ArenaPanel user-facing Run / prompt validation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArenaPanel, localOptsForArenaSlot } from "./ArenaPanel";
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
});
