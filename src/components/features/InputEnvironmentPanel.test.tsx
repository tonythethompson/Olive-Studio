import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { createMockUIState, useFetchRoutesMock } from "./__tests__/testUtils";

// Mock the pipeline store
const mockSetState = vi.fn();
vi.mock("@/lib/stores/pipelineStore", () => ({
  usePipelineState: () => ({
    state: createMockUIState(),
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
  OLIVE_RECIPES_BRANCH: "main",
  OLIVE_RECIPES_REPO: "microsoft/olive-recipes",
}));

// Mock recipe model match
vi.mock("@/lib/recipeModelMatch", () => ({
  buildLocalModelHints: () => [],
  scoreRecipeMatchForLocal: () => 0,
  summarizeLocalRecipeMatches: () => [],
}));

// Mock recipe hardware compatibility
vi.mock("@/lib/recipeHardwareCompatibility", () => ({
  assessCatalogItemHardwareCompatibility: () => ({ compatible: true }),
  assessRecipeHardwareCompatibility: () => ({ compatible: true }),
  summarizeRecipeHardwareCompatibility: () => "",
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
    await act(async () => {
      render(<InputEnvironmentPanel />);
    });
    // The HF model ID input should be pre-populated with the default model
    const input = screen.getByDisplayValue(/meta-llama/i);
    expect(input).toBeDefined();
  });
});
