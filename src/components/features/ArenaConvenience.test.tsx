/**
 * Component tests for Arena convenience sources (Req 18.4 / Property 22 UI).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FromOliveOutputs, UseAssistantProviderButton } from "./ArenaConvenience";
import { usePlaygroundStore } from "@/lib/stores/playgroundStore";

describe("FromOliveOutputs", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("shows empty state and keeps drop-zone path usable (no throw)", async () => {
    const user = userEvent.setup();
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ roots: [{ label: "cache" }], recent: [], entries: [] }), {
        status: 200,
      }),
    );
    const onFile = vi.fn();
    render(<FromOliveOutputs slotLabel="Slot A" onFile={onFile} />);

    await user.click(screen.getByRole("button", { name: /from olive outputs/i }));
    await waitFor(() => {
      expect(screen.getByText(/drop-zone above/i)).toBeTruthy();
    });
    expect(onFile).not.toHaveBeenCalled();
  });

  it("downloads by opaque id and fills a File", async () => {
    const user = userEvent.setup();
    const entry = {
      id: "abc123",
      displayPath: "models/optimized/demo.onnx",
      sizeBytes: 12,
      mtimeMs: Date.now(),
      rootLabel: "output" as const,
    };
    const bytes = new Uint8Array([1, 2, 3, 4]);
    fetchSpy
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ roots: [{ label: "output" }], recent: [entry], entries: [] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        // jsdom Response/Blob stream support is incomplete; stub the subset selectEntry uses.
        {
          ok: true,
          status: 200,
          headers: new Headers(),
          blob: async () => new Blob([bytes]),
          arrayBuffer: async () => bytes.buffer,
        } as unknown as Response,
      );

    const onFile = vi.fn();
    render(<FromOliveOutputs slotLabel="Slot A" onFile={onFile} />);

    await user.click(screen.getByRole("button", { name: /from olive outputs/i }));
    await waitFor(() => {
      expect(screen.getByText("models/optimized/demo.onnx")).toBeTruthy();
    });
    await user.click(screen.getByText("models/optimized/demo.onnx"));
    await waitFor(() => {
      expect(onFile).toHaveBeenCalledTimes(1);
    });
    const file = onFile.mock.calls[0]![0] as File;
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("demo.onnx");
    expect(file.size).toBe(4);
  });

  it("does not auto-retry the list scan after an error", async () => {
    const user = userEvent.setup();
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }),
    );
    render(<FromOliveOutputs slotLabel="Slot A" onFile={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /from olive outputs/i }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
    // Visible half of the loopback-only security boundary
    expect(screen.getByText(/only available from this machine/i)).toBeTruthy();
    const callsAfterError = fetchSpy.mock.calls.length;
    expect(callsAfterError).toBeGreaterThanOrEqual(1);

    // Stay open; effect must not re-fire into the rate limiter.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(fetchSpy.mock.calls.length).toBe(callsAfterError);
  });
});

describe("UseAssistantProviderButton", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    usePlaygroundStore.getState().resetPlayground();
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    usePlaygroundStore.getState().resetPlayground();
  });

  it("requests snapshot with cache: no-store and applies cloud patch", async () => {
    const user = userEvent.setup();
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          eligible: true,
          endpointUrl: "https://api.example.com/v1",
          apiKey: "sk-x",
          modelId: "gpt-x",
          providerLabel: "Custom",
        }),
        { status: 200 },
      ),
    );
    const onApply = vi.fn();
    render(<UseAssistantProviderButton slotLabel="Slot A" onApply={onApply} />);

    await user.click(screen.getByRole("button", { name: /use active assistant provider/i }));
    await waitFor(() => {
      expect(onApply).toHaveBeenCalledWith({
        type: "cloud",
        endpointUrl: "https://api.example.com/v1",
        apiKey: "sk-x",
        modelId: "gpt-x",
      });
    });

    expect(fetchSpy).toHaveBeenCalled();
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.cache).toBe("no-store");
  });

  it("soft-fails on ineligible without applying a patch", async () => {
    const user = userEvent.setup();
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ eligible: false, reason: "Active provider is not OpenAI-compatible" }),
        { status: 200 },
      ),
    );
    const onApply = vi.fn();
    render(<UseAssistantProviderButton slotLabel="Slot B" onApply={onApply} />);

    await user.click(screen.getByRole("button", { name: /use active assistant provider/i }));
    await waitFor(() => {
      expect(screen.getByText(/not openai-compatible/i)).toBeTruthy();
    });
    expect(onApply).not.toHaveBeenCalled();
  });

  it("Slot A fill does not change Slot B (Property 22 isolation)", async () => {
    const user = userEvent.setup();
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          eligible: true,
          endpointUrl: "https://a.example/v1",
          apiKey: "sk-a",
          modelId: "model-a",
          providerLabel: "A",
        }),
        { status: 200 },
      ),
    );

    usePlaygroundStore.getState().setSlotB({
      type: "cloud",
      endpointUrl: "https://b.example/v1",
      apiKey: "sk-b",
      modelId: "model-b",
    });

    render(
      <UseAssistantProviderButton
        slotLabel="Slot A"
        onApply={(patch) => usePlaygroundStore.getState().setSlotA(patch)}
      />,
    );

    await act(async () => {
      await user.click(screen.getByRole("button", { name: /use active assistant provider/i }));
    });

    await waitFor(() => {
      expect(usePlaygroundStore.getState().slotA.endpointUrl).toBe("https://a.example/v1");
    });
    expect(usePlaygroundStore.getState().slotB.endpointUrl).toBe("https://b.example/v1");
    expect(usePlaygroundStore.getState().slotB.apiKey).toBe("sk-b");
  });
});
