/**
 * Tests for MultiLoRA feature flag gating (Task 11.3).
 *
 * Validates: Requirements 11.1, 11.3
 *
 * - `isMultiLoraEnabled()` defaults to false
 * - `gateMultiLoraAdapters()` rejects multi-adapter configs when flag is disabled
 * - `gateMultiLoraAdapters()` allows multi-adapter configs when flag is enabled
 * - `buildExtractAdaptersPass()` emits correct Olive 0.13.0 ExtractAdapters format
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We need to mock the featureFlags module to control isMultiLoraEnabled
const mockIsMultiLoraEnabled = vi.fn<() => boolean>().mockReturnValue(false);

vi.mock("@/lib/featureFlags", () => ({
  isMultiLoraEnabled: () => mockIsMultiLoraEnabled(),
  isFeatureEnabled: vi.fn().mockReturnValue(false),
  FEATURE_FLAG_MULTI_LORA: "multiLora",
  setFeatureFlag: vi.fn(),
  getAllFlags: vi.fn().mockReturnValue([]),
}));

import {
  gateMultiLoraAdapters,
  buildExtractAdaptersPass,
  buildOliveRecipe,
} from "@/lib/oliveRecipeBuilder";
import { deriveUiStateFromOliveRecipe } from "@/lib/oliveRecipeHub";
import { DEFAULT_PASSES } from "@/lib/defaultPasses";
import type { UIState, IHVProvider } from "@/types";
import {
  isMultiLoraEnabled,
  FEATURE_FLAG_MULTI_LORA,
} from "@/lib/featureFlags";

function baseState(overrides?: Partial<UIState>): UIState {
  return {
    modelSource: "huggingface",
    localFiles: [],
    azureModelPath: "",
    hfModelId: "meta-llama/Meta-Llama-3-8B",
    hfDataset: "",
    ihvProvider: "CUDAExecutionProvider" as IHVProvider,
    openvinoTargetDevice: "CPU",
    memoryOffload: "gpu_only",
    cudaVersion: "auto",
    cacheDir: "",
    azureStr: "",
    distributedCaching: false,
    activeJobId: null,
    ...overrides,
    passes: {
      ...DEFAULT_PASSES,
      ...overrides?.passes,
    },
  };
}
describe("featureFlagGating — Task 11.3: Gate MultiLoRA UI behind feature flag", () => {
  beforeEach(() => {
    mockIsMultiLoraEnabled.mockReturnValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── isMultiLoraEnabled ──────────────────────────────────────────────

  describe("isMultiLoraEnabled()", () => {
    it("defaults to false (disabled)", () => {
      expect(isMultiLoraEnabled()).toBe(false);
    });

    it("returns true when mock is set to enabled", () => {
      mockIsMultiLoraEnabled.mockReturnValue(true);
      expect(isMultiLoraEnabled()).toBe(true);
    });
  });

  describe("FEATURE_FLAG_MULTI_LORA constant", () => {
    it("has the value 'multiLora'", () => {
      expect(FEATURE_FLAG_MULTI_LORA).toBe("multiLora");
    });
  });

  // ─── gateMultiLoraAdapters — flag disabled ───────────────────────────

  describe("gateMultiLoraAdapters() with flag disabled", () => {
    beforeEach(() => {
      mockIsMultiLoraEnabled.mockReturnValue(false);
    });

    it("rejects multi-adapter configs (>1 adapter)", () => {
      const adapters = [
        { name: "lora-a", path: "/weights/a", rank: 8, alpha: 16 },
        { name: "lora-b", path: "/weights/b", rank: 4, alpha: 8 },
      ];
      const result = gateMultiLoraAdapters(adapters, 24);
      expect(result.allowed).toBe(false);
      expect(result.adapters).toEqual([]);
      expect(result.reason).toContain("multiLora feature flag is disabled");
    });

    it("allows a single valid adapter entry (single-adapter mode)", () => {
      const adapters = [
        { name: "lora-a", path: "/weights/a", rank: 8, alpha: 16 },
      ];
      const result = gateMultiLoraAdapters(adapters, 24);
      expect(result.allowed).toBe(true);
      expect(result.adapters).toHaveLength(1);
      expect(result.adapters[0].name).toBe("lora-a");
      expect(result.adapters[0].path).toBe("/weights/a");
    });

    it("allows single adapter with defaults for missing optional fields", () => {
      const adapters = [{ path: "/weights/default" }];
      const result = gateMultiLoraAdapters(adapters, 24);
      expect(result.allowed).toBe(true);
      expect(result.adapters[0].name).toBe("default");
      expect(result.adapters[0].rank).toBe(8);
      expect(result.adapters[0].alpha).toBe(16);
    });

    it("rejects single adapter with missing path", () => {
      const adapters = [{ name: "no-path", rank: 8, alpha: 16 }];
      const result = gateMultiLoraAdapters(adapters, 24);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("path must be a non-empty string");
    });

    it("allows empty adapters array", () => {
      const result = gateMultiLoraAdapters([], 24);
      expect(result.allowed).toBe(true);
      expect(result.adapters).toEqual([]);
      expect(result.reason).toBeUndefined();
    });

    it("rejects 3+ adapters", () => {
      const adapters = [
        { name: "a", path: "/a", rank: 4, alpha: 8 },
        { name: "b", path: "/b", rank: 4, alpha: 8 },
        { name: "c", path: "/c", rank: 4, alpha: 8 },
      ];
      const result = gateMultiLoraAdapters(adapters, 24);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("multiLora feature flag is disabled");
    });
  });

  // ─── gateMultiLoraAdapters — flag enabled ────────────────────────────

  describe("gateMultiLoraAdapters() with flag enabled", () => {
    beforeEach(() => {
      mockIsMultiLoraEnabled.mockReturnValue(true);
    });

    it("allows valid multi-adapter configs", () => {
      const adapters = [
        { name: "lora-a", path: "/weights/a", rank: 8, alpha: 16 },
        { name: "lora-b", path: "/weights/b", rank: 4, alpha: 8 },
      ];
      const result = gateMultiLoraAdapters(adapters, 24);
      expect(result.allowed).toBe(true);
      expect(result.adapters).toHaveLength(2);
      expect(result.adapters[0].name).toBe("lora-a");
      expect(result.adapters[1].name).toBe("lora-b");
    });

    it("rejects invalid adapters even when flag is enabled", () => {
      const adapters = [
        { name: "lora-a", path: "", rank: 8, alpha: 16 },
        { name: "lora-b", path: "/weights/b", rank: 4, alpha: 8 },
      ];
      const result = gateMultiLoraAdapters(adapters, 24);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
      expect(result.reason!.length).toBeGreaterThan(0);
    });

    it("normalizes path-only adapters with the same defaults as flag-off mode", () => {
      const adapters = [{ path: "/adapters/style" }];
      const result = gateMultiLoraAdapters(adapters, 24);
      expect(result.allowed).toBe(true);
      expect(result.adapters).toEqual([
        { name: "style", path: "/adapters/style", rank: 8, alpha: 16 },
      ]);
    });

    it("normalizes target_modules snake_case from MCP payloads", () => {
      const adapters = [{ path: "/a", target_modules: ["q_proj", "v_proj"] }];
      const result = gateMultiLoraAdapters(adapters, 24);
      expect(result.allowed).toBe(true);
      expect(result.adapters[0].targetModules).toEqual(["q_proj", "v_proj"]);
    });

    it("respects VRAM-based adapter count limits (<=12GB: max 2)", () => {
      const adapters = [
        { name: "a", path: "/a", rank: 4, alpha: 8 },
        { name: "b", path: "/b", rank: 4, alpha: 8 },
        { name: "c", path: "/c", rank: 4, alpha: 8 },
      ];
      const result = gateMultiLoraAdapters(adapters, 12);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("exceeds maximum");
    });

    it("allows up to 8 adapters when VRAM is unknown (import/rebuild path)", () => {
      const adapters = Array.from({ length: 3 }, (_, i) => ({
        name: `lora-${i}`,
        path: `/weights/${i}`,
        rank: 4,
        alpha: 8,
      }));
      const result = gateMultiLoraAdapters(adapters, Number.NaN);
      expect(result.allowed).toBe(true);
      expect(result.adapters).toHaveLength(3);
    });

    it("allows up to 8 adapters for >12GB VRAM", () => {
      const adapters = Array.from({ length: 8 }, (_, i) => ({
        name: `lora-${i}`,
        path: `/weights/${i}`,
        rank: 4,
        alpha: 8,
      }));
      const result = gateMultiLoraAdapters(adapters, 24);
      expect(result.allowed).toBe(true);
      expect(result.adapters).toHaveLength(8);
    });

    it("detects duplicate adapter names", () => {
      const adapters = [
        { name: "same", path: "/a", rank: 4, alpha: 8 },
        { name: "same", path: "/b", rank: 4, alpha: 8 },
      ];
      const result = gateMultiLoraAdapters(adapters, 24);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Duplicate");
    });

    it("preserves targetModules in validated output", () => {
      const adapters = [
        { name: "lora-a", path: "/weights/a", rank: 8, alpha: 16, targetModules: ["q_proj", "v_proj"] },
      ];
      const result = gateMultiLoraAdapters(adapters, 24);
      expect(result.allowed).toBe(true);
      expect(result.adapters[0].targetModules).toEqual(["q_proj", "v_proj"]);
    });
  });

  // ─── buildExtractAdaptersPass ────────────────────────────────────────

  describe("buildExtractAdaptersPass()", () => {
    it("returns undefined for empty adapters array", () => {
      const result = buildExtractAdaptersPass([]);
      expect(result).toBeUndefined();
    });

    it("produces ExtractAdapters pass config with correct structure", () => {
      const adapters = [
        { name: "lora-a", path: "/weights/a", rank: 8, alpha: 16 },
        { name: "lora-b", path: "/weights/b", rank: 4, alpha: 8 },
      ];
      const result = buildExtractAdaptersPass(adapters);
      expect(result).toBeDefined();
      expect(result!.type).toBe("ExtractAdapters");
      expect(result!.config).toEqual({
        adapter_type: "lora",
        make_inputs: true,
      });
      expect(result!.config).not.toHaveProperty("adapters");
    });

    it("does not emit unsupported adapters[] on ExtractAdapters", () => {
      const adapters = [
        { name: "lora-a", path: "/weights/a", rank: 8, alpha: 16, targetModules: ["q_proj"] },
      ];
      const result = buildExtractAdaptersPass(adapters);
      const config = result!.config as Record<string, unknown>;
      expect(config.adapter_type).toBe("lora");
      expect(config).not.toHaveProperty("adapters");
      expect(config).not.toHaveProperty("targetModules");
    });

    it("omits adapter list from pass config when not specified", () => {
      const adapters = [
        { name: "lora-a", path: "/weights/a", rank: 8, alpha: 16 },
      ];
      const result = buildExtractAdaptersPass(adapters);
      expect(result!.config).not.toHaveProperty("adapters");
    });
  });

  // ─── MultiLoRA recipe import round-trip ──────────────────────────────

  describe("MultiLoRA recipe round-trip through deriveUiStateFromOliveRecipe", () => {
    beforeEach(() => {
      mockIsMultiLoraEnabled.mockReturnValue(true);
    });

    it("preserves adapter metadata and ExtractAdapters on import → rebuild", () => {
      const state = baseState({
        vramEstimateGb: 24,
        multiLoraAdapters: [
          { name: "style", path: "/adapters/style", rank: 16, alpha: 32, targetModules: ["q_proj"] },
          { name: "tone", path: "/adapters/tone", rank: 8, alpha: 16 },
          { name: "domain", path: "/adapters/domain", rank: 4, alpha: 8 },
        ],
        passes: {
          ...DEFAULT_PASSES,
          peft: true,
          peftMethod: "lora",
          conversion: true,
          conversionFormat: "onnx",
        },
      });

      const recipe = buildOliveRecipe(state);
      expect((recipe as Record<string, unknown>).adapters).toEqual([
        {
          name: "style",
          path: "/adapters/style",
          rank: 16,
          alpha: 32,
          target_modules: ["q_proj"],
        },
        { name: "tone", path: "/adapters/tone", rank: 8, alpha: 16 },
        { name: "domain", path: "/adapters/domain", rank: 4, alpha: 8 },
      ]);
      expect(
        ((recipe.passes as Record<string, unknown>).extract_adapters as { type: string }).type,
      ).toBe("ExtractAdapters");

      const imported = deriveUiStateFromOliveRecipe(recipe, { replacePasses: true });
      expect(imported.multiLoraAdapters).toEqual([
        { name: "style", path: "/adapters/style", rank: 16, alpha: 32, targetModules: ["q_proj"] },
        { name: "tone", path: "/adapters/tone", rank: 8, alpha: 16 },
        { name: "domain", path: "/adapters/domain", rank: 4, alpha: 8 },
      ]);
      expect(imported.passes?.peft).toBe(true);
      // Recipes do not persist vramEstimateGb; rebuild must still succeed.
      expect(imported.vramEstimateGb).toBeUndefined();

      const rebuilt = buildOliveRecipe(
        baseState({
          ...imported,
          multiLoraAdapters: imported.multiLoraAdapters,
          passes: { ...DEFAULT_PASSES, ...imported.passes },
        }),
      );
      expect((rebuilt as Record<string, unknown>).adapters).toEqual(
        (recipe as Record<string, unknown>).adapters,
      );
      expect(
        ((rebuilt.passes as Record<string, unknown>).extract_adapters as { type: string }).type,
      ).toBe("ExtractAdapters");
    });

    it("restores legacy adapter_path as multiLoraAdapters on import", () => {
      const recipe = {
        input_model: {
          type: "HfModel",
          config: {
            model_path: "meta-llama/Meta-Llama-3-8B",
            adapter_path: "/legacy/adapter",
          },
        },
        systems: {},
        passes: {
          peft: { type: "LoRA", config: {} },
        },
        engine: {},
      };
      const imported = deriveUiStateFromOliveRecipe(recipe, { replacePasses: true });
      expect(imported.multiLoraAdapters).toEqual([{ path: "/legacy/adapter" }]);
      expect(imported.passes?.peft).toBe(true);
    });
  });
});
