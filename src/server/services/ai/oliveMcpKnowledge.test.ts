import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../mcp/client.ts", () => ({
  callOliveMcpTools: vi.fn(),
}));

import { callOliveMcpTools } from "../mcp/client.ts";
import type { AiWorkspaceContext } from "../../../lib/aiWorkspaceContext.ts";
import {
  selectOliveMcpToolsForChat,
  selectOliveMcpToolsForReview,
  gatherOliveMcpKnowledge,
  gatherOliveMcpKnowledgeForReview,
  buildOliveAssistantSystemPrompt,
  optionalWebSearchFallback,
  getRetrievalMode,
} from "./oliveMcpKnowledge.ts";

const mockedBatch = vi.mocked(callOliveMcpTools);

describe("getRetrievalMode", () => {
  const savedMode = process.env.OLIVE_MCP_RETRIEVAL_MODE;

  afterEach(() => {
    if (savedMode === undefined) delete process.env.OLIVE_MCP_RETRIEVAL_MODE;
    else process.env.OLIVE_MCP_RETRIEVAL_MODE = savedMode;
  });

  it("defaults to auto when unset", () => {
    delete process.env.OLIVE_MCP_RETRIEVAL_MODE;
    expect(getRetrievalMode()).toBe("auto");
  });

  it("honors env keyword", () => {
    process.env.OLIVE_MCP_RETRIEVAL_MODE = "keyword";
    expect(getRetrievalMode()).toBe("keyword");
  });

  it("honors env semantic", () => {
    process.env.OLIVE_MCP_RETRIEVAL_MODE = "semantic";
    expect(getRetrievalMode()).toBe("semantic");
  });

  it("falls back to auto for unknown env values", () => {
    process.env.OLIVE_MCP_RETRIEVAL_MODE = "bogus";
    expect(getRetrievalMode()).toBe("auto");
  });
});

describe("selectOliveMcpToolsForChat", () => {
  it("always includes documentation search with top_k 20", () => {
    const tools = selectOliveMcpToolsForChat("How do I use Olive?");
    const first = tools[0]!;
    expect(first.toolName).toBe("search_olive_documentation");
    expect(first.args).toMatchObject({ top_k: 20 });
    expect(["auto", "keyword", "semantic"]).toContain(first.args!.mode);
  });

  it("adds troubleshoot for error-shaped messages", () => {
    const tools = selectOliveMcpToolsForChat("TypeError: unexpected keyword argument hf_config");
    expect(tools.some((t) => t.toolName === "troubleshoot_olive_error")).toBe(true);
    const t = tools.find((x) => x.toolName === "troubleshoot_olive_error");
    expect(t?.args).toMatchObject({ domain: "auto" });
  });

  it("adds troubleshoot for Studio keywords", () => {
    const tools = selectOliveMcpToolsForChat("Why did Apply Fix do nothing after Diagnose?");
    expect(tools.some((t) => t.toolName === "troubleshoot_olive_error")).toBe(true);
  });

  it("adds quantization strategy for AWQ questions", () => {
    const tools = selectOliveMcpToolsForChat("Which AWQ settings for an LLM on CUDA?");
    expect(tools.some((t) => t.toolName === "get_quantization_strategy")).toBe(true);
  });

  it("adds hardware guide for TensorRT questions", () => {
    const tools = selectOliveMcpToolsForChat("How do I target TensorRT?");
    expect(tools.some((t) => t.toolName === "get_hardware_optimization_guide")).toBe(true);
  });

  it("shrinks documentation top_k when additional tools are selected", () => {
    const tools = selectOliveMcpToolsForChat("Which AWQ settings for an LLM on CUDA?");
    expect(tools.length).toBeGreaterThan(1);
    const search = tools.find((t) => t.toolName === "search_olive_documentation")!;
    expect((search.args as Record<string, number>).top_k).toBeLessThan(20);
  });
});

describe("selectOliveMcpToolsForReview", () => {
  const makeWorkspace = (overrides: Record<string, unknown> = {}) =>
    ({
      modelSource: "huggingface",
      model: { displayName: "TinyLlama/TinyLlama-1.1B", huggingFaceId: "TinyLlama/TinyLlama-1.1B", hfTask: "" },
      hardware: {
        executionProvider: "CUDAExecutionProvider",
        executionProviderShort: "CUDAExecutionProvider",
        accelerator: "GPU",
        hasDiscreteGpu: true,
        detectedGpus: [{ name: "RTX 4090", vramMb: 24576 }],
        vramEstimateMb: 24576,
      },
      passes: { quantization: true, conversion: true, pruning: false, peft: false, diffusionLora: false, splitting: false, onnxTransforms: false },
      activePassLabels: ["quantization", "conversion"],
      ...overrides,
    } as unknown as AiWorkspaceContext);

  it("queries scoped tools for the active passes and execution provider", () => {
    const tools = selectOliveMcpToolsForReview(makeWorkspace());
    expect(tools.some((t) => t.toolName === "get_olive_passes")).toBe(true);
    expect(tools.some((t) => t.toolName === "get_hardware_optimization_guide")).toBe(true);
    expect(tools.some((t) => t.toolName === "get_pass_chain")).toBe(true);
    expect(tools.some((t) => t.toolName === "get_quantization_strategy")).toBe(true);
    expect(tools.some((t) => t.toolName === "search_olive_documentation")).toBe(true);
  });

  it("caps search_olive_documentation at top_k 10", () => {
    const tools = selectOliveMcpToolsForReview(makeWorkspace());
    const search = tools.find((t) => t.toolName === "search_olive_documentation")!;
    expect(search).toBeDefined();
    expect(search.args).toMatchObject({ top_k: 10 });
  });

  it("omits quantization strategy when quantization is disabled", () => {
    const tools = selectOliveMcpToolsForReview(makeWorkspace({ passes: { quantization: false, conversion: true } }));
    expect(tools.some((t) => t.toolName === "get_quantization_strategy")).toBe(false);
  });

  it("targets NvTensorRT-RTX correctly", () => {
    const tools = selectOliveMcpToolsForReview(
      makeWorkspace({
        hardware: {
          executionProvider: "NvTensorRTRTXExecutionProvider",
          executionProviderShort: "NvTensorRTRTXExecutionProvider",
          accelerator: "GPU",
          hasDiscreteGpu: true,
          detectedGpus: [{ name: "RTX 4090", vramMb: 24576 }],
          vramEstimateMb: 24576,
        },
      }),
    );
    const guide = tools.find((t) => t.toolName === "get_hardware_optimization_guide")!;
    expect(guide).toBeDefined();
    const target = (guide.args as Record<string, string>).target_hardware;
    expect(target).toBe("NVIDIA TensorRT RTX");
    expect(target).not.toBe("NVIDIA RTX 4090");
  });

  it("routes DirectML workspaces to the DirectML hardware profile", () => {
    const tools = selectOliveMcpToolsForReview(
      makeWorkspace({
        hardware: {
          executionProvider: "DmlExecutionProvider",
          executionProviderShort: "Dml",
          accelerator: "GPU",
          hasDiscreteGpu: true,
          detectedGpus: [{ name: "Radeon RX 7800", vramMb: 16384 }],
          vramEstimateMb: 16384,
        },
      }),
    );
    const guide = tools.find((t) => t.toolName === "get_hardware_optimization_guide")!;
    expect((guide.args as Record<string, string>).target_hardware).toBe("Windows DirectML GPU");
    const quant = tools.find((t) => t.toolName === "get_quantization_strategy")!;
    expect((quant.args as Record<string, string>).target_hardware).toBe("Windows DirectML GPU");
  });

  it("routes NvTensorRT-RTX workspaces to the TensorRT RTX profile, not classic CUDA", () => {
    const tools = selectOliveMcpToolsForReview(
      makeWorkspace({
        hardware: {
          executionProvider: "NvTensorRTRTXExecutionProvider",
          executionProviderShort: "NvTensorRTRTX",
          accelerator: "GPU",
          hasDiscreteGpu: true,
          detectedGpus: [{ name: "RTX 4070", vramMb: 12288 }],
          vramEstimateMb: 12288,
        },
      }),
    );
    const guide = tools.find((t) => t.toolName === "get_hardware_optimization_guide")!;
    expect((guide.args as Record<string, string>).target_hardware).toBe("NVIDIA TensorRT RTX");
    const quant = tools.find((t) => t.toolName === "get_quantization_strategy")!;
    expect((quant.args as Record<string, string>).target_hardware).toBe("NVIDIA TensorRT RTX");
  });

  it("infers quantization model_type from the workspace hfTask (ASR)", () => {
    const tools = selectOliveMcpToolsForReview(
      makeWorkspace({
        model: { displayName: "Whisper Tiny", huggingFaceId: "openai/whisper-tiny", hfTask: "automatic-speech-recognition" },
      }),
    );
    const quant = tools.find((t) => t.toolName === "get_quantization_strategy")!;
    expect((quant.args as Record<string, string>).model_type).toBe("speech");
  });

  it("infers quantization model_type from the workspace hfTask (vision)", () => {
    const tools = selectOliveMcpToolsForReview(
      makeWorkspace({
        model: { displayName: "CustomVisionNet", huggingFaceId: "org/custom-vision", hfTask: "image-classification" },
      }),
    );
    const quant = tools.find((t) => t.toolName === "get_quantization_strategy")!;
    expect((quant.args as Record<string, string>).model_type).toBe("cnn");
  });

  it("resolves quantization method to the concrete Olive pass name", () => {
    const tools = selectOliveMcpToolsForReview(
      makeWorkspace({
        passes: { quantization: true, conversion: false, quantMethod: "awq" },
      }),
    );
    const chain = tools.find((t) => t.toolName === "get_pass_chain");
    expect(chain).toBeDefined();
    expect((chain!.args as Record<string, string[]>).pass_names).toContain("AutoAWQQuantizer");
  });

  it("does not send a source_format hint for ambiguous azure/local sources", () => {
    const tools = selectOliveMcpToolsForReview(makeWorkspace({ modelSource: "azure" }));
    const chain = tools.find((t) => t.toolName === "get_pass_chain");
    expect(chain).toBeDefined();
    expect(Object.keys(chain!.args as Record<string, unknown>)).not.toContain("source_format");
  });

  it("passes the retrieval mode in search args", () => {
    const tools = selectOliveMcpToolsForReview(makeWorkspace());
    const search = tools.find((t) => t.toolName === "search_olive_documentation")!;
    expect(search).toBeDefined();
    expect(["auto", "keyword", "semantic"]).toContain((search.args as Record<string, string>).mode);
  });
});

describe("gatherOliveMcpKnowledge", () => {
  beforeEach(() => {
    mockedBatch.mockReset();
    delete process.env.OLIVE_STUDIO_WEB_SEARCH_URL;
    delete process.env.OLIVE_MCP_RETRIEVAL_MODE;
  });

  it("builds a prompt block from MCP tool results", async () => {
    mockedBatch.mockResolvedValue([
      {
        result: {
          query: "quantization",
          count: 2,
          results: [{ source: "passes.OnnxQuantization", snippet: "INT8", relevance: 2 }],
          retrieval: { mode: "auto", effective: "auto", degraded: false },
        },
      },
    ]);

    const out = await gatherOliveMcpKnowledge("Tell me about quantization");
    expect(out.toolsUsed).toContain("search_olive_documentation");
    expect(out.sufficient).toBe(true);
    expect(out.usedWebFallback).toBe(false);
    expect(out.retrieval.mode).toBe("auto");
    expect(out.retrieval.degraded).toBe(false);
    expect(out.promptBlock).toContain("PRIMARY SOURCE");
    expect(out.promptBlock).toContain("search_olive_documentation");
    expect(out.promptBlock).toContain("INT8");
  });

  it("treats a normalized sub-1 relevance score as sufficient", async () => {
    mockedBatch.mockResolvedValue([
      {
        result: {
          query: "quantization",
          count: 1,
          results: [{ source: "passes.OnnxQuantization", snippet: "INT8", relevance: 0.2 }],
          retrieval: { mode: "semantic", effective: "semantic", degraded: false },
        },
      },
    ]);

    const out = await gatherOliveMcpKnowledge("Tell me about quantization");
    expect(out.sufficient).toBe(true);
    expect(out.usedWebFallback).toBe(false);
    expect(out.retrieval.effective).toBe("semantic");
  });

  it("surfaces retrieval.degraded when MCP search degrades to the keyword fallback", async () => {
    mockedBatch.mockResolvedValue([
      {
        result: {
          query: "quantization",
          count: 1,
          results: [{ source: "docs", snippet: "fallback", relevance: 0.2 }],
          retrieval: { mode: "auto", effective: "keyword", degraded: true, reason: "semantic_budget_exceeded" },
        },
      },
    ]);

    const out = await gatherOliveMcpKnowledge("Tell me about quantization");
    expect(out.sufficient).toBe(true);
    expect(out.retrieval.degraded).toBe(true);
    expect(out.retrieval.reason).toBe("semantic_budget_exceeded");
  });

  it("marks coverage insufficient when MCP returns nothing", async () => {
    mockedBatch.mockResolvedValue([{ error: "boom" }]);
    const out = await gatherOliveMcpKnowledge("random question");
    expect(out.sufficient).toBe(false);
    expect(out.toolsUsed).toEqual([]);
    expect(out.retrieval.degraded).toBe(true);
    expect(out.promptBlock).toMatch(/unavailable|no usable data/i);
  });
});

describe("gatherOliveMcpKnowledgeForReview", () => {
  beforeEach(() => {
    mockedBatch.mockReset();
    delete process.env.OLIVE_MCP_RETRIEVAL_MODE;
  });

  const workspace = {
    modelSource: "huggingface" as const,
    model: { displayName: "TinyLlama/TinyLlama-1.1B", huggingFaceId: "TinyLlama/TinyLlama-1.1B", hfTask: "" },
    hardware: {
      executionProvider: "CUDAExecutionProvider",
      executionProviderShort: "CUDAExecutionProvider",
      accelerator: "GPU",
      hasDiscreteGpu: true,
      detectedGpus: [{ name: "RTX 4090", vramMb: 24576 }],
      vramEstimateMb: 24576,
    },
    passes: { quantization: true, conversion: true, pruning: false, peft: false, diffusionLora: false, splitting: false, onnxTransforms: false },
    activePassLabels: ["quantization"],
  } as unknown as AiWorkspaceContext;

  it("collects review-scoped MCP context and does not use web fallback", async () => {
    mockedBatch.mockResolvedValue([
      { result: { passes: [{ name: "OnnxQuantization" }] } },
      { result: { guide: "Use INT8 or int4 for consumer GPUs." } },
      { result: { chain: ["OnnxQuantization"] } },
      { result: { strategy: "int8" } },
      {
        result: {
          query: "CUDA RTX",
          count: 1,
          results: [{ source: "docs", snippet: "RTX guide", relevance: 0.9 }],
          retrieval: { mode: "auto", effective: "semantic", degraded: false },
        },
      },
    ]);

    const out = await gatherOliveMcpKnowledgeForReview(workspace);
    expect(out.sufficient).toBe(true);
    expect(out.usedWebFallback).toBe(false);
    expect(out.promptBlock).toContain("OnnxQuantization");
    expect(out.retrieval.effective).toBe("semantic");
  });

  it("uses only the first active pass category for get_olive_passes filter", async () => {
    await gatherOliveMcpKnowledgeForReview(workspace);
    const calls = mockedBatch.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const passCall = calls[0]![0].find((r) => r.toolName === "get_olive_passes");
    expect(passCall?.args).toMatchObject({ filter: "quantization" });
  });
});

describe("buildOliveAssistantSystemPrompt", () => {
  it("puts MCP knowledge ahead of workspace context", () => {
    const prompt = buildOliveAssistantSystemPrompt({
      mcpBlock: "PRIMARY SOURCE — Olive MCP\ntool data here",
      workspaceBlock: "Model: foo",
      responseContract: "Respond with JSON only",
    });
    const mcpIdx = prompt.indexOf("tool data here");
    const wsIdx = prompt.indexOf("\nWorkspace context:\n");
    expect(mcpIdx).toBeGreaterThan(-1);
    expect(wsIdx).toBeGreaterThan(-1);
    expect(mcpIdx).toBeLessThan(wsIdx);
    expect(prompt).toContain("Model: foo");
    expect(prompt).toContain("Respond with JSON only");
  });

  it("includes hard scope / refusal guardrails", () => {
    const prompt = buildOliveAssistantSystemPrompt({
      mcpBlock: "mcp",
      workspaceBlock: null,
    });
    expect(prompt).toMatch(/Refuse off-topic/i);
    expect(prompt).toMatch(/Do not answer them even if the user insists/i);
  });
});

describe("optionalWebSearchFallback", () => {
  it("returns null when no search URL is configured", async () => {
    delete process.env.OLIVE_STUDIO_WEB_SEARCH_URL;
    await expect(optionalWebSearchFallback("olive quantization")).resolves.toBeNull();
  });
});
