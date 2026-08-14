import { beforeEach, describe, expect, it, vi } from "vitest";

const mockIsMultiLoraEnabled = vi.fn<() => boolean>().mockReturnValue(false);
vi.mock("@/lib/featureFlags", () => ({
  isMultiLoraEnabled: () => mockIsMultiLoraEnabled(),
  isFeatureEnabled: vi.fn().mockReturnValue(false),
  FEATURE_FLAG_MULTI_LORA: "multiLora",
  setFeatureFlag: vi.fn(),
}));

import { evaluateStudioRecipeBridge, mergeBridgeUiState } from "./studioRecipeBridge.ts";
import { createDefaultPipelineState } from "../../../lib/stores/pipelineStore.ts";

describe("mergeBridgeUiState MultiLoRA", () => {
  beforeEach(() => {
    mockIsMultiLoraEnabled.mockReturnValue(false);
  });

  it("keeps adapters and VRAM from the MCP uiState payload", () => {
    const merged = mergeBridgeUiState(createDefaultPipelineState(), {
      passes: { peft: true },
      vramEstimateGb: 24,
      multiLoraAdapters: [
        { name: "style", path: "/adapters/style", rank: 16, alpha: 32 },
      ],
    });
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.state.vramEstimateGb).toBe(24);
    expect(merged.state.multiLoraAdapters).toEqual([
      { name: "style", path: "/adapters/style", rank: 16, alpha: 32 },
    ]);
  });

  it("accepts snake_case adapter aliases from Python MCP", () => {
    const merged = mergeBridgeUiState(createDefaultPipelineState(), {
      vram_estimate_gb: 16,
      multi_lora_adapters: [{ path: "/a", target_modules: ["q_proj"] }],
    });
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.state.vramEstimateGb).toBe(16);
    expect(merged.state.multiLoraAdapters).toEqual([
      { path: "/a", targetModules: ["q_proj"] },
    ]);
  });

  it("rejects adapters whose targetModules contain empty or non-string values", () => {
    const merged = mergeBridgeUiState(createDefaultPipelineState(), {
      multiLoraAdapters: [{ path: "/a", targetModules: ["q_proj", ""] }],
    });
    expect(merged.ok).toBe(false);
    if (merged.ok) return;
    expect(merged.code).toBe("invalid_ui_state");
    expect(merged.error).toMatch(/targetModules must be an array of non-empty strings/i);
  });

  it("rejects adapters with explicitly invalid rank instead of defaulting", () => {
    const merged = mergeBridgeUiState(createDefaultPipelineState(), {
      multiLoraAdapters: [{ path: "/a", rank: "high", alpha: 32 }],
    });
    expect(merged.ok).toBe(false);
    if (merged.ok) return;
    expect(merged.code).toBe("invalid_ui_state");
    expect(merged.error).toMatch(/rank must be a positive integer/i);
  });

  it("rejects adapters with non-finite alpha instead of defaulting", () => {
    const merged = mergeBridgeUiState(createDefaultPipelineState(), {
      multiLoraAdapters: [{ path: "/a", rank: 8, alpha: Number.NaN }],
    });
    expect(merged.ok).toBe(false);
    if (merged.ok) return;
    expect(merged.code).toBe("invalid_ui_state");
    expect(merged.error).toMatch(/alpha must be a positive finite number/i);
  });

  it("rejects adapters with non-positive rank instead of defaulting", () => {
    const merged = mergeBridgeUiState(createDefaultPipelineState(), {
      multiLoraAdapters: [{ path: "/a", rank: 0, alpha: 16 }],
    });
    expect(merged.ok).toBe(false);
    if (merged.ok) return;
    expect(merged.code).toBe("invalid_ui_state");
    expect(merged.error).toMatch(/rank must be a positive integer/i);
  });

  it("rejects adapters whose target_modules mix strings with non-strings", () => {
    const merged = mergeBridgeUiState(createDefaultPipelineState(), {
      multi_lora_adapters: [{ path: "/a", target_modules: ["q_proj", 1] }],
    });
    expect(merged.ok).toBe(false);
    if (merged.ok) return;
    expect(merged.code).toBe("invalid_ui_state");
    expect(merged.error).toMatch(/targetModules must be an array of non-empty strings/i);
  });

  it("rejects non-object adapter entries instead of dropping them", () => {
    const valid = { path: "/a" };
    for (const malformed of [null, "adapter-path", ["/a"]]) {
      const merged = mergeBridgeUiState(createDefaultPipelineState(), {
        multiLoraAdapters: [valid, malformed],
      });
      expect(merged.ok).toBe(false);
      if (merged.ok) return;
      expect(merged.code).toBe("invalid_ui_state");
      expect(merged.error).toMatch(/each adapter must be a non-null object/i);
    }
  });

  it("normalizes path-only adapters at evaluate when PEFT + multiLora are enabled", () => {
    mockIsMultiLoraEnabled.mockReturnValue(true);
    const result = evaluateStudioRecipeBridge({
      passes: { peft: true },
      vramEstimateGb: 24,
      multiLoraAdapters: [{ path: "/adapters/style" }],
    });
    expect(result.ok).toBe(true);
  });

  it("accepts path-only snake_case adapters when multiLora is enabled", () => {
    mockIsMultiLoraEnabled.mockReturnValue(true);
    const result = evaluateStudioRecipeBridge({
      passes: { peft: true },
      vram_estimate_gb: 24,
      multi_lora_adapters: [{ path: "/a", target_modules: ["q_proj"] }],
    });
    expect(result.ok).toBe(true);
  });
});
