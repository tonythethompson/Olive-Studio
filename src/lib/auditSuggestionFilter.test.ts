import { describe, it, expect } from "vitest";
import {
  filterAuditAnalysis,
  isAuditSuggestionRelevant,
  modelLooksLikeAsr,
  modelLooksLikeLlm,
} from "./auditSuggestionFilter.ts";
import type { AuditAnalysis, AuditSuggestion } from "./auditAnalysis.ts";
import type { AuditFilterContext } from "./auditSuggestionFilter.ts";

const llamaNvCtx: AuditFilterContext = {
  model: {
    huggingFaceId: "meta-llama/Meta-Llama-3-8B",
    huggingFaceDataset: "",
    localFileNames: [],
    azurePath: "",
    displayName: "meta-llama/Meta-Llama-3-8B",
    hfTask: "text-generation",
    hfTaskInferred: true,
  },
  hardware: {
    executionProvider: "NvTensorRTRTXExecutionProvider",
    executionProviderShort: "NvTensorRTRTX",
    cudaVersion: "auto",
  },
};

function sug(partial: Partial<AuditSuggestion>): AuditSuggestion {
  return {
    title: "Suggestion",
    description: "A fine suggestion.",
    impact: "Medium",
    type: "suggestion",
    autofix: { pass: "quantMethod", value: "awq" },
    ...partial,
  };
}

describe("model heuristics", () => {
  it("detects LLM vs ASR names", () => {
    expect(modelLooksLikeLlm("Meta-Llama-3-8B")).toBe(true);
    expect(modelLooksLikeAsr("openai/whisper-tiny")).toBe(true);
    expect(modelLooksLikeAsr("Meta-Llama-3-8B")).toBe(false);
  });
});

describe("isAuditSuggestionRelevant", () => {
  it("drops speech-recognition fluff on Llama + NvTensorRTRTX", () => {
    const junk = sug({
      title: "Add TensorRT Execution Provider",
      description:
        "Include TensorRTExecutionProvider after CUDAExecutionProvider for faster speech recognition inference.",
      autofix: {
        pass: "systems.local_system.config.accelerators[0].execution_providers",
        value: "TensorRTExecutionProvider",
      },
    });
    expect(isAuditSuggestionRelevant(junk, llamaNvCtx)).toBe(false);
  });

  it("drops TensorRTPass / engine-build advice on NvTensorRTRTX", () => {
    const junk = sug({
      title: "Add TensorRT engine optimization pass",
      description:
        "Including a TensorRTPass lets you set max_workspace_size, enable FP16 and engine caching, which improves latency and reuse.",
      autofix: { pass: "passes.tensor_rt", value: "enable_fp16=true" },
    });
    expect(isAuditSuggestionRelevant(junk, llamaNvCtx)).toBe(false);
  });

  it("keeps AWQ advice for Llama on NvTensorRTRTX", () => {
    const ok = sug({
      title: "Enable AWQ quantization",
      description: "Use AWQ int4 so Meta-Llama-3-8B fits NvTensorRT-RTX VRAM more efficiently.",
      autofix: { pass: "quantMethod", value: "awq" },
    });
    expect(isAuditSuggestionRelevant(ok, llamaNvCtx)).toBe(true);
  });

  it("allows speech advice only for Whisper models", () => {
    const whisperCtx: AuditFilterContext = {
      ...llamaNvCtx,
      model: {
        ...llamaNvCtx.model,
        huggingFaceId: "openai/whisper-tiny",
        displayName: "openai/whisper-tiny",
      },
      hardware: {
        ...llamaNvCtx.hardware,
        executionProvider: "CUDAExecutionProvider",
        executionProviderShort: "CUDA",
      },
    };
    const speech = sug({
      title: "Set ASR task",
      description: "Use automatic-speech-recognition for Whisper.",
      autofix: { pass: "quantMethod", value: "ptq" },
    });
    expect(isAuditSuggestionRelevant(speech, whisperCtx)).toBe(true);
  });
});

describe("filterAuditAnalysis", () => {
  it("keeps embedding task advice and rewrites pass to hfTask", () => {
    const analysis: AuditAnalysis = {
      score: 55,
      level: "Suboptimal",
      summary: "Task mismatch for embedding model.",
      suggestions: [
        sug({
          title: "Verify task compatibility",
          description:
            "The model gte-large-en-v1.5 is an embedding model; change task to feature-extraction.",
          impact: "High",
          type: "warning",
          autofix: { pass: "-> input_model", value: "feature-extraction" },
        }),
      ],
    };
    const filtered = filterAuditAnalysis(analysis, {
      ...llamaNvCtx,
      model: {
        ...llamaNvCtx.model,
        huggingFaceId: "Alibaba-NLP/gte-large-en-v1.5",
        displayName: "Alibaba-NLP/gte-large-en-v1.5",
      },
    });
    expect(filtered.suggestions).toHaveLength(1);
    expect(filtered.suggestions[0]!.autofix).toEqual({
      pass: "hfTask",
      value: "feature-extraction",
    });
  });

  it("removes junk and notes how many were dropped", () => {
    const analysis: AuditAnalysis = {
      score: 70,
      level: "Suboptimal",
      summary: "Pipeline could be tighter for this GPU.",
      suggestions: [
        sug({
          title: "Add TensorRT Execution Provider",
          description: "TensorRTExecutionProvider after CUDA for speech recognition.",
          autofix: {
            pass: "systems.local_system.config.accelerators[0].execution_providers",
            value: "TensorRTExecutionProvider",
          },
        }),
        sug({
          title: "Enable AWQ",
          description: "AWQ int4 helps Llama fit 12 GB VRAM on NvTensorRT-RTX.",
        }),
      ],
    };
    const filtered = filterAuditAnalysis(analysis, llamaNvCtx);
    expect(filtered.suggestions).toHaveLength(1);
    expect(filtered.suggestions[0]!.title).toMatch(/AWQ/i);
    expect(filtered.summary).toMatch(/Removed 1 off-topic/);
  });
});
