import { describe, it, expect } from "vitest";
import {
  buildAiWorkspaceContext,
  formatAiWorkspaceContextForPrompt,
  buildWorkspaceContextSummary,
} from "@/lib/aiWorkspaceContext";
import { DEFAULT_PASSES } from "@/lib/defaultPasses";
import type { HardwareProbeResult } from "@/lib/hardwareProbe";
import type { UIState, IHVProvider } from "@/types";

function baseState(overrides?: Partial<UIState>): UIState {
  return {
    modelSource: "huggingface",
    localFiles: [],
    azureModelPath: "",
    hfModelId: "Qwen/Qwen2.5-1.5B-Instruct",
    hfDataset: "wikitext",
    ihvProvider: "CUDAExecutionProvider" as IHVProvider,
    memoryOffload: "auto",
    cudaVersion: "cu124",
    cacheDir: "~/.cache/olive",
    azureStr: "",
    distributedCaching: false,
    activeJobId: null,
    ...overrides,
    passes: {
      ...DEFAULT_PASSES,
      conversion: true,
      quantization: true,
      quantMethod: "awq",
      quantPrecision: "int4",
      ...overrides?.passes,
    },
  };
}

const probe: HardwareProbeResult = {
  probedAt: "2026-07-31T00:00:00.000Z",
  platform: {
    os: "win32",
    arch: "x64",
    cpuModel: "Test CPU",
    cpuCores: 16,
    systemRamGb: 64,
  },
  nvidia: {
    gpus: [{ name: "NVIDIA GeForce RTX 4090", vramMb: 24576, driver: "560.00" }],
    cudaVersion: "12.4",
    cudaTag: "cu124",
  },
  detectedProviders: ["CPUExecutionProvider", "CUDAExecutionProvider", "NvTensorRTRTXExecutionProvider"],
  recommendedProvider: "CUDAExecutionProvider",
  notes: ["NVIDIA GPU detected"],
  onnxRuntimeProviders: ["CPUExecutionProvider", "CUDAExecutionProvider"],
};

describe("buildAiWorkspaceContext", () => {
  it("includes recipe snapshot and probe summary", () => {
    const ctx = buildAiWorkspaceContext(baseState(), { probe });
    expect(ctx.hardware.memoryOffload).toBe("auto");
    expect(ctx.detectedHardware?.gpus[0]?.name).toContain("4090");
    expect(ctx.detectedHardware?.recommendedProvider).toBe("CUDAExecutionProvider");
    expect(ctx.recipeSnapshot?.inputModelType).toBe("HfModel");
    expect(ctx.recipeSnapshot?.jsonPreview).toContain("passes");
    expect(ctx.activePassLabels.some((l) => l.includes("awq"))).toBe(true);
  });

  it("formats probe + recipe into the prompt block", () => {
    const ctx = buildAiWorkspaceContext(baseState(), { probe });
    const block = formatAiWorkspaceContextForPrompt(ctx);
    expect(block).toContain("Detected hardware");
    expect(block).toContain("RTX 4090");
    expect(block).toContain("Recipe JSON snapshot");
    expect(block).toContain("Apply action");
    expect(block).toContain("memory offload: auto");
  });

  it("redacts Azure Blob connection strings from recipe snapshots and cache dir", () => {
    const secret =
      "DefaultEndpointsProtocol=https;AccountName=olive;AccountKey=abc123==;EndpointSuffix=core.windows.net";
    const ctx = buildAiWorkspaceContext(
      baseState({ distributedCaching: true, azureStr: secret, cacheDir: "" }),
    );
    expect(ctx.infrastructure.cacheDir).toBe("[REDACTED]");
    expect(ctx.recipeSnapshot?.jsonPreview).toContain("[REDACTED]");
    expect(ctx.recipeSnapshot?.jsonPreview).not.toContain("AccountKey");
    expect(ctx.recipeSnapshot?.jsonPreview).not.toContain(secret);
    expect(ctx.recipeSnapshot?.jsonPreview).not.toContain("abc123==");
  });

  it("summarizes GPU in the compact badge line", () => {
    const ctx = buildAiWorkspaceContext(baseState(), { probe });
    const summary = buildWorkspaceContextSummary(ctx);
    expect(summary).toContain("CUDA");
    expect(summary).toMatch(/4090|GeForce/);
  });
});
