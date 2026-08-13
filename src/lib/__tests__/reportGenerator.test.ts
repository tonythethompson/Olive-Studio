import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { generateMarkdownReport, getReportFilename } from "@/lib/reportGenerator";
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

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const VALID_STATUSES: JobHistoryRecord["status"][] = ["completed", "failed", "cancelled"];

const PASS_NAME_POOL = [
  "OnnxConversion",
  "OrtTransformersOptimization",
  "OnnxQuantization",
  "OnnxDynamicQuantization",
  "IncQuantization",
  "OnnxFloatToFloat16",
  "GptqQuantizer",
  "AwqQuantizer",
  "VitisAIQuantization",
  "QLoRA",
  "LoRA",
  "OrtPerfTuning",
  "AppendPrePostProcessingOps",
];

/** Generate a realistic non-empty model ID. */
function arbModelId(): fc.Arbitrary<string> {
  return fc.oneof(
    fc.constantFrom(
      "meta-llama/Llama-3-8B",
      "microsoft/Phi-3-mini-4k-instruct",
      "mistralai/Mistral-7B-v0.1",
      "google/gemma-2b",
      "stabilityai/stable-diffusion-xl-base-1.0",
    ),
    fc.stringMatching(/^[a-z][a-z0-9-]*\/[A-Za-z0-9._-]+$/),
  );
}

/** Generate a realistic IHV provider string. */
function arbProvider(): fc.Arbitrary<string> {
  return fc.constantFrom(
    "CUDAExecutionProvider",
    "CPUExecutionProvider",
    "DmlExecutionProvider",
    "TensorrtExecutionProvider",
    "QNNExecutionProvider",
    "OpenVINOExecutionProvider",
  );
}

/** Generate a valid pass names array (1–8 passes). */
function arbPassNames(): fc.Arbitrary<string[]> {
  return fc.array(fc.constantFrom(...PASS_NAME_POOL), { minLength: 1, maxLength: 8 });
}

/** Generate a valid JobHistoryRecord. */
function arbJobRecord(): fc.Arbitrary<JobHistoryRecord> {
  return fc
    .record({
      id: fc.uuid(),
      modelId: arbModelId(),
      ihvProvider: arbProvider(),
      memoryOffload: fc.constantFrom("none", "partial", "full"),
      status: fc.constantFrom(...VALID_STATUSES),
      exitCode: fc.oneof(fc.constant(0), fc.constant(1), fc.constant(null)),
      durationMs: fc.integer({ min: 100, max: 3_600_000 }),
      passNames: arbPassNames(),
      vramEstimateGb: fc.oneof(
        fc.constant(undefined),
        fc.double({ min: 1, max: 80, noNaN: true }),
      ),
      recipeJson: fc.oneof(
        fc.constant(""),
        fc.constant('{"input_model":{"type":"PyTorchModel"},"passes":{"quantize":{}}}'),
      ),
      logSummary: fc.oneof(
        fc.constant(undefined),
        fc.record({
          totalLogs: fc.integer({ min: 0, max: 5000 }),
          errorCount: fc.integer({ min: 0, max: 500 }),
          lastLog: fc.oneof(
            fc.constant(undefined),
            fc.string({ minLength: 1, maxLength: 300 }),
          ),
        }),
      ),
    })
    .map((rec) => ({
      ...rec,
      jobId: rec.id,
      timestamp: new Date(
        2024 + Math.floor(Math.random() * 2),
        Math.floor(Math.random() * 12),
        1 + Math.floor(Math.random() * 28),
      ).toISOString(),
      passCount: rec.passNames.length,
    }));
}

/** Generate an array of 1–10 job records. */
function arbJobRecordArray(
  minLength = 1,
  maxLength = 10,
): fc.Arbitrary<JobHistoryRecord[]> {
  return fc.array(arbJobRecord(), { minLength, maxLength });
}

// ─── Property 13: Report Content Completeness ────────────────────────────────

describe("Property 13: Report Content Completeness", () => {
  /**
   * Feature: v05-release, Property 13: Report Content Completeness
   *
   * For any set of JobHistoryRecord[] passed to the report generator with
   * Markdown format: the output must contain the model identifier, hardware
   * provider, pass names in order, duration, and terminal status for each job.
   * When includeRecipeJson is true, the output must contain a recipe JSON section.
   * When includeLogSummary is true, the output must contain total log count,
   * error count, and last log line (truncated to 200 chars). When 2 or more
   * completed jobs are present, the output must contain a comparison section
   * with fastest job, lowest VRAM (if present), and average duration.
   *
   * Validates: Requirements 9.2, 9.3, 9.7, 9.9
   */

  it("output contains model ID, provider, at least one pass name, duration, and status for each job", () => {
    fc.assert(
      fc.property(arbJobRecordArray(1, 10), (records) => {
        const md = generateMarkdownReport(records);

        for (const rec of records) {
          // Model ID present
          expect(md).toContain(rec.modelId);

          // Provider present
          expect(md).toContain(rec.ihvProvider);

          // At least one pass name present
          const hasPassName = rec.passNames.some((p) => md.includes(p));
          expect(hasPassName).toBe(true);

          // Status present
          expect(md).toContain(rec.status);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("output contains formatted duration for each job", () => {
    fc.assert(
      fc.property(arbJobRecordArray(1, 10), (records) => {
        const md = generateMarkdownReport(records);

        for (const rec of records) {
          // Duration should appear somewhere in a recognizable format
          // formatDuration produces: Xms, Xs, or Xm Ys
          const secs = Math.floor(rec.durationMs / 1000);
          if (rec.durationMs < 1000) {
            expect(md).toContain(`${rec.durationMs}ms`);
          } else if (secs < 60) {
            expect(md).toContain(`${secs}s`);
          } else {
            const mins = Math.floor(secs / 60);
            const remSecs = secs % 60;
            expect(md).toContain(`${mins}m ${remSecs}s`);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("when includeRecipeJson is true and recipeJson is non-empty, output contains Recipe JSON section with code fence", () => {
    fc.assert(
      fc.property(arbJobRecordArray(1, 5), (records) => {
        // Ensure at least one record has recipeJson
        const testRecords = records.map((r, i) =>
          i === 0
            ? { ...r, recipeJson: '{"passes":{"conv":{}}}' }
            : r,
        );

        const md = generateMarkdownReport(testRecords, { includeRecipeJson: true });

        // Should contain "Recipe JSON" text or a code fence
        const hasRecipeSection = md.includes("Recipe JSON") || md.includes("```json");
        expect(hasRecipeSection).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("when includeLogSummary is true and logSummary exists, output contains log counts", () => {
    fc.assert(
      fc.property(arbJobRecordArray(1, 5), (records) => {
        // Ensure at least one record has logSummary
        const testRecords = records.map((r, i) =>
          i === 0
            ? {
              ...r,
              logSummary: { totalLogs: 150, errorCount: 3, lastLog: "Done" },
            }
            : r,
        );

        const md = generateMarkdownReport(testRecords, { includeLogSummary: true });

        // Should contain the total log count and error count for the first record
        expect(md).toContain("150");
        expect(md).toContain("3");
      }),
      { numRuns: 100 },
    );
  });

  it("when 2+ completed jobs are present, output contains Comparison section", () => {
    fc.assert(
      fc.property(
        arbJobRecordArray(2, 10).map((records) =>
          records.map((r, i) => (i < 2 ? { ...r, status: "completed" as const } : r)),
        ),
        (records) => {
          const md = generateMarkdownReport(records);

          // Must contain the comparison section
          expect(md).toContain("## Comparison");
          expect(md).toContain("Fastest");
          expect(md).toContain("Average duration");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("when fewer than 2 completed jobs, output does NOT contain Comparison section", () => {
    fc.assert(
      fc.property(arbJobRecordArray(1, 5), (records) => {
        // Force all records to be non-completed
        const testRecords = records.map((r) => ({
          ...r,
          status: "failed" as const,
        }));

        const md = generateMarkdownReport(testRecords);

        expect(md).not.toContain("## Comparison");
      }),
      { numRuns: 100 },
    );
  });

  it("comparison section identifies the fastest job correctly", () => {
    fc.assert(
      fc.property(
        arbJobRecordArray(2, 10).map((records) =>
          records.map((r) => ({ ...r, status: "completed" as const })),
        ),
        (records) => {
          const md = generateMarkdownReport(records);

          // Find the actual fastest
          const fastest = records.reduce((a, b) =>
            a.durationMs < b.durationMs ? a : b,
          );

          // The fastest model ID should appear after "Fastest"
          const comparisonSection = md.slice(md.indexOf("## Comparison"));
          expect(comparisonSection).toContain(fastest.modelId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("comparison section shows lowest VRAM when VRAM data is present", () => {
    fc.assert(
      fc.property(
        arbJobRecordArray(2, 5).map((records) =>
          records.map((r, i) => ({
            ...r,
            status: "completed" as const,
            vramEstimateGb: 4 + i * 2, // deterministic ascending VRAM
          })),
        ),
        (records) => {
          const md = generateMarkdownReport(records);

          const comparisonSection = md.slice(md.indexOf("## Comparison"));
          expect(comparisonSection).toContain("Lowest VRAM");

          // The lowest VRAM model should be the first record (4 GB)
          expect(comparisonSection).toContain(records[0].modelId);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 14: Report Filename Pattern ────────────────────────────────────

describe("Property 14: Report Filename Pattern", () => {
  /**
   * Feature: v05-release, Property 14: Report Filename Pattern
   *
   * For any Markdown export, the downloaded filename must match the regex
   * pattern ^olive-report-\d{4}-\d{2}-\d{2}\.md$ where the date portion
   * equals the current UTC date.
   *
   * Validates: Requirements 9.9
   */

  it("filename matches the required pattern ^olive-report-YYYY-MM-DD.md$", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const filename = getReportFilename();
        expect(filename).toMatch(/^olive-report-\d{4}-\d{2}-\d{2}\.md$/);
      }),
      { numRuns: 100 },
    );
  });

  it("filename date matches the current UTC date", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const filename = getReportFilename();
        const today = new Date().toISOString().slice(0, 10);
        expect(filename).toBe(`olive-report-${today}.md`);
      }),
      { numRuns: 100 },
    );
  });

  it("filename prefix is exactly 'olive-report-' and suffix is exactly '.md'", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const filename = getReportFilename();
        expect(filename.startsWith("olive-report-")).toBe(true);
        expect(filename.endsWith(".md")).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("filename has exactly 26 characters (olive-report-YYYY-MM-DD.md = 26 chars)", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const filename = getReportFilename();
        // "olive-report-" (13) + "YYYY-MM-DD" (10) + ".md" (3) = 26
        expect(filename.length).toBe(26);
      }),
      { numRuns: 100 },
    );
  });
});
