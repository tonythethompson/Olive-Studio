/**
 * Component tests for ArenaPanel user-facing Run / prompt validation.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArenaPanel } from "./ArenaPanel";
import { usePipelineStore } from "@/lib/stores/pipelineStore";

function resetArenaSlots(): void {
  usePipelineStore.setState({
    slotA: {
      type: "local",
      file: null,
      tokenizerId: "",
      endpointUrl: "",
      apiKey: "",
      modelId: "",
    },
    slotB: {
      type: "local",
      file: null,
      tokenizerId: "",
      endpointUrl: "",
      apiKey: "",
      modelId: "",
    },
  });
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
});
