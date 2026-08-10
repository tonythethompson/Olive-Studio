import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, act, fireEvent } from "@testing-library/react";
import { createMockUIState, useFetchRoutesMock, renderWithProviders as render } from "../__tests__/testUtils";

// Stable store mock: creating a fresh UIState each render churns effect deps
// (e.g. state.localFiles) and can leave act()/findBy hanging.
const { mockSetState, mockPipelineState } = vi.hoisted(() => {
  const mockSetState = vi.fn();
  // Inline defaults mirror createMockUIState(); resolved after imports via Object.assign below.
  const mockPipelineState = {} as ReturnType<typeof createMockUIState>;
  return { mockSetState, mockPipelineState };
});

vi.mock("@/lib/stores/pipelineStore", () => ({
  usePipelineState: () => ({
    state: mockPipelineState,
    setState: mockSetState,
  }),
}));

// Mock hardware probe
vi.mock("@/lib/hardwareProbe", () => ({
  fetchHardwareProbe: () =>
    Promise.resolve({
      probedAt: "now",
      platform: { cpuModel: "Test CPU", cpuCores: 8, os: "win", arch: "x64" },
      detectedProviders: ["CPUExecutionProvider"],
      recommendedProvider: "CPUExecutionProvider",
      notes: [],
    }),
}));

// Mock olive recipe hub (network-heavy)
vi.mock("@/lib/oliveRecipeHub", () => ({
  compareCatalogMetadataToRecipe: vi.fn(),
  deriveUiStateFromOliveRecipe: vi.fn(),
  fetchGitHubRecipeJson: () => Promise.resolve(null),
  fetchOliveRecipesCatalogItem: () => Promise.resolve(null),
  getCatalogDeviceFromRecipe: () => "cpu",
  getRecipesBranch: () => "main",
  setRecipesBranch: vi.fn(),
  OLIVE_RECIPES_BRANCH: "main",
  OLIVE_RECIPES_BRANCH_DEFAULT: "main",
  OLIVE_RECIPES_REPO: "microsoft/olive-recipes",
}));

// Mock recipe model match
vi.mock("@/lib/recipeModelMatch", () => ({
  buildLocalModelHints: () => [],
  scoreRecipeMatchForLocal: () => ({ tier: "none", score: 0 }),
  summarizeLocalRecipeMatches: () => [],
}));

// Mock recipe hardware compatibility
vi.mock("@/lib/recipeHardwareCompatibility", () => ({
  assessCatalogItemHardwareCompatibility: () => ({
    tier: "compatible",
    targetDevice: "CPU",
    reason: "mocked",
  }),
  assessRecipeHardwareCompatibility: () => ({
    tier: "compatible",
    targetDevice: "CPU",
    reason: "mocked",
  }),
  summarizeRecipeHardwareCompatibility: () => ({ compatible: 0, unavailable: 0, unknown: 0 }),
}));

// Keep the presets catalog empty in unit tests (avoids 215KB dynamic import churn)
vi.mock("@/data/recipes", () => ({
  SUGGESTED_RECIPES: [],
  loadSuggestedRecipes: () => Promise.resolve([]),
}));

// Mock tensorrt deps
vi.mock("@/lib/tensorrtRtxDeps", () => ({
  isNvTensorRtRtxCatalogPath: () => false,
}));

// Mock preset vram estimate
vi.mock("@/lib/presetVramEstimate", () => ({
  estimateVramForCatalogPreset: () => ({ summaryLine: "~4 GB VRAM", fitHint: "", overBudget: false }),
}));

import { InputEnvironmentPanel } from "./InputEnvironmentPanel";

Object.assign(mockPipelineState, createMockUIState());

describe("InputEnvironmentPanel", () => {
  useFetchRoutesMock({
    "hardware-probe": {
      probedAt: "now",
      platform: { cpuModel: "Test CPU", cpuCores: 8, os: "win", arch: "x64" },
      detectedProviders: ["CPUExecutionProvider"],
      recommendedProvider: "CPUExecutionProvider",
      notes: [],
    },
    "olive-recipes": [],
  });

  it("renders the model source tabs", async () => {
    await act(async () => {
      render(<InputEnvironmentPanel />);
    });
    // Should show HuggingFace tab by default
    expect(screen.getAllByText(/hugging\s*face/i).length).toBeGreaterThan(0);
  });

  it("renders with controlled state props", async () => {
    const state = createMockUIState({ modelSource: "local" });
    await act(async () => {
      render(<InputEnvironmentPanel state={state} setState={mockSetState} />);
    });
    expect(screen.getAllByText(/local/i).length).toBeGreaterThan(0);
  });

  it("displays the model ID input for HuggingFace source", async () => {
    // Avoid await act(click) / findBy: expanding this panel leaves async updates
    // unsettled, so act-based waits hang past the default timeout in CI.
    const { container } = render(<InputEnvironmentPanel />);
    await act(async () => {
      await Promise.resolve();
    });
    const configureLabel = screen.getByText(/configure model source/i);
    act(() => {
      fireEvent.click(configureLabel.closest("button") ?? configureLabel);
    });
    const input = container.querySelector("#modelId") as HTMLInputElement | null;
    expect(input).toBeTruthy();
    expect(input?.value).toMatch(/meta-llama/i);
  });

  describe("HuggingFace token error handling", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("shows an error state when the token status request fails", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation((url: unknown) => {
        const urlStr = String(url);
        if (urlStr.includes("hf-token-status")) {
          return Promise.resolve(new Response("Internal Error", { status: 500 }));
        }
        return Promise.resolve(new Response("{}", { status: 200 }));
      });

      render(<InputEnvironmentPanel />);
      await act(async () => {
        await Promise.resolve();
      });
      const configureLabel = screen.getByText(/configure model source/i);
      act(() => {
        fireEvent.click(configureLabel.closest("button") ?? configureLabel);
      });

      expect(await screen.findByText(/couldn't check token status/i)).toBeTruthy();
    });

    it("does not clear the cached token status on a failed DELETE and recovers on successful save", async () => {
      let deleteCalled = false;
      let resolveDelete!: (res: Response) => void;
      const deletePromise = new Promise<Response>((resolve) => {
        resolveDelete = resolve;
      });

      vi.spyOn(globalThis, "fetch").mockImplementation((url: unknown, init?: RequestInit) => {
        const urlStr = String(url);
        if (urlStr.includes("hf-token-status")) {
          return Promise.resolve(new Response(JSON.stringify({ source: "runtime" }), { status: 200 }));
        }
        if (urlStr.includes("/api/env/hf-token") && init?.method === "DELETE") {
          deleteCalled = true;
          return deletePromise;
        }
        return Promise.resolve(new Response("{}", { status: 200 }));
      });

      render(<InputEnvironmentPanel />);
      await act(async () => {
        await Promise.resolve();
      });
      const configureLabel = screen.getByText(/configure model source/i);
      act(() => {
        fireEvent.click(configureLabel.closest("button") ?? configureLabel);
      });

      expect(await screen.findByText(/set for this session/i)).toBeTruthy();
      const clearButton = screen.getByRole("button", { name: /clear/i });

      act(() => {
        fireEvent.click(clearButton);
      });

      // Assert button becomes disabled and shows spinner/loading accessible name while pending
      const pendingButton = await screen.findByRole("button", { name: /clearing token/i });
      expect(pendingButton.hasAttribute("disabled")).toBe(true);
      expect(deleteCalled).toBe(true);

      // Resolve DELETE with failure
      await act(async () => {
        resolveDelete(new Response("Internal Error", { status: 500 }));
        await Promise.resolve();
      });

      // Status stays "runtime" — a failed DELETE must not optimistically clear the cache.
      expect(screen.getByText(/set for this session/i)).toBeTruthy();

      // Assert error alert is displayed
      const alert = await screen.findByRole("alert");
      expect(alert).toBeTruthy();
      expect(alert.textContent).toMatch(/couldn't clear the token/i);

      // Perform a successful Save after the failure and verify recovery
      const input = screen.getByPlaceholderText("hf_...") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "hf_new_token_123" } });
      const saveButton = screen.getByRole("button", { name: /save/i });

      await act(async () => {
        fireEvent.click(saveButton);
        await Promise.resolve();
      });

      // Verify the alert recovers (is removed) and token input is cleared
      expect(screen.queryByRole("alert")).toBeNull();
      expect(input.value).toBe("");
    });
  });

  it("lets the user toggle Trust Remote Code in the HuggingFace source form", async () => {
    mockSetState.mockClear();
    render(<InputEnvironmentPanel />);
    await act(async () => {
      await Promise.resolve();
    });

    const configureLabel = screen.getByText(/configure model source/i);
    act(() => {
      fireEvent.click(configureLabel.closest("button") ?? configureLabel);
    });

    const switchEl = screen.getByRole("switch", {
      name: /trust remote code from the hugging face model repository/i,
    });

    act(() => {
      fireEvent.click(switchEl);
    });

    expect(mockSetState).toHaveBeenCalledWith(
      expect.objectContaining({
        passes: expect.objectContaining({ trustRemoteCode: true }),
      }),
    );
  });
});
