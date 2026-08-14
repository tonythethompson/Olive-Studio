import { describe, expect, it } from "vitest";
import { createMockUIState } from "../__tests__/testUtils";
import {
  buildQueuedBatchJob,
  describeAppliedMcpPatches,
  resolveQueuedModelIdentifier,
} from "./executionJobUtils";
import { DEFAULT_PASSES } from "@/lib/defaultPasses";

describe("buildQueuedBatchJob", () => {
  it("builds a queued snapshot with a model identifier and active pass names", () => {
    const state = createMockUIState({
      passes: { ...DEFAULT_PASSES, conversion: true, quantization: true, pruning: false },
    });
    const job = buildQueuedBatchJob(state);
    expect(job.status).toBe("queued");
    expect(job.modelSource).toBe("huggingface");
    expect(job.provider).toBe("CPUExecutionProvider");
    expect(job.modelIdentifier).toBe("meta-llama/Meta-Llama-3-8B");
    expect(job.passes).toEqual(["Conversion (ONNX)", "Quantization (int8)"]);
    expect(job.progress).toBe(0);
    expect(job.progressKnown).toBe(true);
    expect(job.recipeJson).toContain("Meta-Llama-3-8B");
    expect(job.logs.length).toBeGreaterThan(0);
  });

  it("falls back to a baseline export label when no pass is active", () => {
    const state = createMockUIState({
      passes: { ...DEFAULT_PASSES, conversion: false, quantization: false, pruning: false },
    });
    expect(buildQueuedBatchJob(state).passes).toEqual(["Default Baseline Export"]);
  });

  it("resolves the Offline Weights Folder identifier for local sources", () => {
    const state = createMockUIState({ modelSource: "local", localFiles: [{ name: "model.bin", size: 1 }] });
    expect(resolveQueuedModelIdentifier(state)).toBe("Offline Weights Folder");
  });
});

describe("describeAppliedMcpPatches", () => {
  const state = createMockUIState();

  it("lists cacheDir, overrides, and changed passes", () => {
    const parts = describeAppliedMcpPatches(
      { cacheDir: "/tmp/cache", passes: { quantization: true, pruning: true }, passRecipeOverrides: { opt: {} } },
      state.passes,
      [],
    );
    expect(parts).toContain("cacheDir=/tmp/cache");
    expect(parts).toContain("passOverrides=opt");
    expect(parts).toContain("quantization=true");
    expect(parts).toContain("pruning=true");
  });

  it("appends applied quirks", () => {
    expect(describeAppliedMcpPatches({}, state.passes, ["external-data"])).toEqual([
      "quirks=external-data",
    ]);
  });

  it("returns an empty list when nothing was applied", () => {
    expect(describeAppliedMcpPatches({}, state.passes, [])).toEqual([]);
  });
});
