import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useRecipeHub } from "./useRecipeHub";

vi.mock("@/lib/oliveRecipeHub", () => ({
  OLIVE_RECIPES_REPO: "microsoft/olive-recipes",
  getRecipesBranch: () => "main",
  fetchGitHubRecipeJson: vi.fn(() =>
    Promise.resolve({ json: {}, target: { owner: "o", repo: "r", branch: "main", path: "p.json" } }),
  ),
  fetchOliveRecipesCatalogItem: vi.fn(() => Promise.resolve({})),
  compareCatalogMetadataToRecipe: vi.fn(() => ({ catalogDevice: "CPU", recipeDevice: "CPU", matches: true })),
  deriveUiStateFromOliveRecipe: vi.fn(() => ({ hfModelId: "org/model", modelSource: "huggingface" })),
  getCatalogDeviceFromRecipe: vi.fn(() => "CPU"),
}));

vi.mock("@/lib/recipeHardwareCompatibility", () => ({
  assessCatalogItemHardwareCompatibility: vi.fn(() => ({
    tier: "compatible",
    targetDevice: "CPU",
    reason: "mocked",
  })),
  assessRecipeHardwareCompatibility: vi.fn(() => ({
    tier: "compatible",
    targetDevice: "CPU",
    reason: "mocked",
  })),
}));

vi.mock("@/lib/recipePipeline", () => ({
  parseRecipeJson: vi.fn(() => ({ recipe: {}, schema: { valid: true, errors: [] } })),
}));

const SAMPLE_ITEM = {
  name: "sshleifer-tiny-gpt2 · olive · sparsegpt",
  architecture: "GPT-2",
  device: "CPU",
  repoPath: "sshleifer-tiny-gpt2/olive/sparsegpt.json",
  description: "Sample tiny-gpt2 preset",
};

function renderHub() {
  const setState = vi.fn();
  const utils = renderHook(() => useRecipeHub({ setState, hardwareProbe: null }));
  return { setState, utils };
}

describe("useRecipeHub clear-recipe escape (issue #387 stuck on tiny-gpt2)", () => {
  it("re-opens the catalog rail after an applied recipe is cleared", async () => {
    const { setState, utils } = renderHub();

    // Simulate the reported stuck state: a curated recipe applies and collapses
    // the rail behind the "Applied recipe" banner.
    await act(async () => {
      await utils.result.current.handleApplyCuratedRecipe(SAMPLE_ITEM);
    });

    expect(utils.result.current.appliedRecipeLabel).toBe(SAMPLE_ITEM.name);
    expect(utils.result.current.recipeRailCollapsed).toBe(true);

    await act(async () => {
      utils.result.current.handleClearRecipe();
    });

    expect(utils.result.current.appliedRecipeLabel).toBeNull();
    expect(utils.result.current.recipeRailCollapsed).toBe(false);
    expect(utils.result.current.recipeSuccessMsg).toMatch(/Recipe cleared/i);
    expect(setState).toHaveBeenCalledWith({
      hfModelId: "",
      hfDataset: "",
      hfTask: "",
      localFiles: [],
      azureModelPath: "",
    });
  });

  it("clears an applied recipe even when no curated recipe was applied", () => {
    const { setState, utils } = renderHub();

    act(() => {
      utils.result.current.handleClearRecipe();
    });

    expect(utils.result.current.appliedRecipeLabel).toBeNull();
    expect(utils.result.current.recipeRailCollapsed).toBe(false);
    expect(setState).toHaveBeenCalledWith({
      hfModelId: "",
      hfDataset: "",
      hfTask: "",
      localFiles: [],
      azureModelPath: "",
    });
  });
});