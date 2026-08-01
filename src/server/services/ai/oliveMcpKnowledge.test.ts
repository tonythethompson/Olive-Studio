import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../mcp/client.ts", () => ({
  callOliveMcpTools: vi.fn(),
}));

import { callOliveMcpTools } from "../mcp/client.ts";
import {
  selectOliveMcpToolsForChat,
  gatherOliveMcpKnowledge,
  buildOliveAssistantSystemPrompt,
  optionalWebSearchFallback,
} from "./oliveMcpKnowledge.ts";

const mockedBatch = vi.mocked(callOliveMcpTools);

describe("selectOliveMcpToolsForChat", () => {
  it("always includes documentation search", () => {
    const tools = selectOliveMcpToolsForChat("How do I use Olive?");
    expect(tools[0]?.toolName).toBe("search_olive_documentation");
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
});

describe("gatherOliveMcpKnowledge", () => {
  beforeEach(() => {
    mockedBatch.mockReset();
    delete process.env.OLIVE_STUDIO_WEB_SEARCH_URL;
  });

  it("builds a prompt block from MCP tool results", async () => {
    mockedBatch.mockResolvedValue([
      {
        result: {
          query: "quantization",
          count: 2,
          results: [{ source: "passes.OnnxQuantization", snippet: "INT8", relevance: 2 }],
        },
      },
    ]);

    const out = await gatherOliveMcpKnowledge("Tell me about quantization");
    expect(out.toolsUsed).toContain("search_olive_documentation");
    expect(out.sufficient).toBe(true);
    expect(out.usedWebFallback).toBe(false);
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
        },
      },
    ]);

    const out = await gatherOliveMcpKnowledge("Tell me about quantization");
    expect(out.sufficient).toBe(true);
    expect(out.usedWebFallback).toBe(false);
  });

  it("marks coverage insufficient when MCP returns nothing", async () => {
    mockedBatch.mockResolvedValue([{ error: "boom" }]);
    const out = await gatherOliveMcpKnowledge("random question");
    expect(out.sufficient).toBe(false);
    expect(out.toolsUsed).toEqual([]);
    expect(out.promptBlock).toMatch(/unavailable|no usable data/i);
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
