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

  it("rejects path-only adapters at evaluate when PEFT + multiLora require name/rank/alpha", () => {
    mockIsMultiLoraEnabled.mockReturnValue(true);
    const result = evaluateStudioRecipeBridge({
      passes: { peft: true },
      vramEstimateGb: 24,
      multiLoraAdapters: [{ path: "/adapters/style" }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_ui_state");
    expect(result.error).toMatch(/name must be a non-empty string/);
    expect(result.error).toMatch(/rank must be a positive integer/);
    expect(result.error).toMatch(/alpha must be a positive finite number/);
  });
});
