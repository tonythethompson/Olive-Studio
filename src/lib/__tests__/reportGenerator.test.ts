import { describe, it, expect } from "vitest";
import { generateMarkdownReport } from "@/lib/reportGenerator";
import type { JobHistoryRecord } from "@/lib/jobHistoryStore";

function makeRecord(overrides: Partial<JobHistoryRecord> = {}): JobHistoryRecord {
  return {
    id: "test-1",
    jobId: "test-1",
    modelId: "meta-llama/Llama-3-8B",
    ihvProvider: "CUDAExecutionProvider",
    memoryOffload: "none",
    status: "completed",
    exitCode: 0,
    durationMs: 45000,
    timestamp: "2025-01-15T10:30:00Z",
    passCount: 3,
    passNames: ["Conversion", "Quantization", "Optimization"],
    vramEstimateGb: 8.5,
    logSummary: { totalLogs: 120, errorCount: 0, lastLog: "Optimization complete" },
    recipeJson: "",
    ...overrides,
  };
}

describe("generateMarkdownReport", () => {
  it("produces a valid Markdown report for a single record", () => {
    const md = generateMarkdownReport([makeRecord()]);
    expect(md).toContain("# Olive Studio Optimization Report");
    expect(md).toContain("meta-llama/Llama-3-8B");
    expect(md).toContain("CUDAExecutionProvider");
    expect(md).toContain("45s");
    expect(md).toContain("8.5");
    expect(md).toContain("Conversion → Quantization → Optimization");
  });

  it("includes comparison section for multiple records", () => {
    const records = [
      makeRecord({ id: "a", modelId: "model-a", durationMs: 30000 }),
      makeRecord({ id: "b", modelId: "model-b", durationMs: 60000, vramEstimateGb: 12.0 }),
    ];
    const md = generateMarkdownReport(records);
    expect(md).toContain("## Comparison");
    expect(md).toContain("Fastest");
    expect(md).toContain("model-a");
    expect(md).toContain("Average duration");
  });

  it("omits comparison section for single record", () => {
    const md = generateMarkdownReport([makeRecord()]);
    expect(md).not.toContain("## Comparison");
  });

  it("respects custom title option", () => {
    const md = generateMarkdownReport([makeRecord()], { title: "Custom Report" });
    expect(md).toContain("# Custom Report");
  });

  it("includes recipe JSON when option is set", () => {
    const rec = makeRecord({ recipeJson: '{"passes":{}}' });
    const md = generateMarkdownReport([rec], { includeRecipeJson: true });
    expect(md).toContain("```json");
    expect(md).toContain('"passes"');
  });

  it("handles records without VRAM estimate", () => {
    const rec = makeRecord({ vramEstimateGb: undefined });
    const md = generateMarkdownReport([rec]);
    expect(md).toContain("—");
  });

  it("handles failed status emoji", () => {
    const rec = makeRecord({ status: "failed", exitCode: 1 });
    const md = generateMarkdownReport([rec]);
    expect(md).toContain("❌");
  });
});
