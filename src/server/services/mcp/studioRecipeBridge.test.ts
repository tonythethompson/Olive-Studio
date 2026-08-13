import { describe, expect, it } from "vitest";
import { mergeBridgeUiState } from "./studioRecipeBridge.ts";
import { createDefaultPipelineState } from "../../../lib/stores/pipelineStore.ts";

describe("mergeBridgeUiState MultiLoRA", () => {
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
});
