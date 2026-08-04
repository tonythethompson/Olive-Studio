import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createMockUIState } from "./__tests__/testUtils";

const mockSetState = vi.fn();
vi.mock("@/lib/stores/pipelineStore", () => ({
  usePipelineState: () => ({ state: createMockUIState(), setState: mockSetState }),
}));
vi.mock("@/lib/aiWorkspaceContext", () => ({
  buildAiWorkspaceContext: () => "ctx",
  buildChatPresetQueries: () => ["Why is my model slow?"],
  buildWorkspaceContextSummary: () => "summary",
}));
vi.mock("./LocalModelManager", () => ({
  LocalModelManager: () => <div data-testid="lmm" />,
}));

import { GeminiSidebar } from "./GeminiSidebar";

describe("GeminiSidebar flows", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("audits on open, chats, and renders provider settings", async () => {
    const routes: Record<string, unknown> = {
      "ai/provider": {
        source: "runtime",
        provider: "gemini",
        model: "gemini-2.5-flash",
        baseUrl: null,
        envCredentials: {
          gemini: { present: true, envVar: "GEMINI_API_KEY", usable: true },
        },
      },
      "analyze-state": { score: 82, level: "Good", summary: "Looks fine", suggestions: [] },
      "ai/chat": { text: "**Because** quantization is off." },
      "ai/models": { models: [{ id: "gemini-2.5-pro", label: "gemini-2.5-pro" }], source: "live" },
      "local-health": { healthy: true, lmsInstalled: true },
      "ollama-health": { healthy: true },
    };
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation((url: unknown) => {
      const urlStr = String(url);
      const match = Object.entries(routes).find(([pattern]) => urlStr.includes(pattern));
      return Promise.resolve(
        new Response(JSON.stringify(match ? match[1] : {}), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });

    render(<GeminiSidebar isOpen onClose={vi.fn()} />);

    // Header reflects the active provider and the audit auto-runs
    await waitFor(() => expect(screen.getByText(/Google Gemini \/ gemini-2.5-flash/)).toBeTruthy());
    await waitFor(() => expect(screen.getByText("Looks fine")).toBeTruthy());

    // Chat tab: preset query round-trips through /api/ai/chat
    fireEvent.click(screen.getByRole("tab", { name: /^Chat$/ }));
    fireEvent.click(screen.getByRole("button", { name: /Why is my model slow\?/ }));
    await waitFor(() => expect(screen.getByText(/quantization is off/)).toBeTruthy());

    // Settings tab: Cloud provider form by default (gemini is cloud)
    fireEvent.click(screen.getByRole("tab", { name: /^Settings$/ }));
    expect(screen.getByRole("button", { name: "Cloud settings" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Local settings" })).toBeTruthy();
    const provider = screen.getByLabelText("AI provider") as HTMLSelectElement;
    expect(provider.value).toBe("gemini");
    await waitFor(() => expect(screen.getByText("Live catalog")).toBeTruthy());
    // Router providers (compat mode): searchable combobox with catalog membership
    fireEvent.change(provider, { target: { value: "openrouter" } });
    await waitFor(() =>
      expect((screen.getByLabelText("AI model") as HTMLInputElement).value).toBe("gemini-2.5-pro"),
    );
    expect(screen.getByRole("combobox", { name: "AI model" })).toBeTruthy();
    expect(screen.queryByText("Model ID not recognized. Requests may fail.")).toBeNull();
    expect(screen.getByPlaceholderText(/localhost:11434/)).toBeTruthy();
    // Local tab: LM Studio / Ollama inventory (not mixed into Cloud)
    fireEvent.click(screen.getByRole("button", { name: "Local settings" }));
    expect(screen.getByText("LM Studio")).toBeTruthy();
    expect(screen.getByText("Ollama")).toBeTruthy();
    expect(screen.getByText(/Starter downloads/i)).toBeTruthy();
    expect(spy).toHaveBeenCalledWith("/api/ai/models", expect.objectContaining({ method: "POST" }));
  });
});
