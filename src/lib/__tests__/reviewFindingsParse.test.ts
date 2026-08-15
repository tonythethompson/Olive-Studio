import { describe, it, expect } from "vitest";
import { parseAiReviewReply, REVIEW_FINDINGS_RESPONSE_CONTRACT } from "../reviewFindingsParse.ts";
import { filterFindings } from "../auditSuggestionFilter.ts";
import type { Finding } from "../types/findingTypes.ts";

type AuditFilterContext = Parameters<typeof filterFindings>[1];

describe("REVIEW_FINDINGS_RESPONSE_CONTRACT", () => {
  it("describes a findings[] array with shared Finding/Action fields", () => {
    expect(REVIEW_FINDINGS_RESPONSE_CONTRACT).toContain('"findings"');
    expect(REVIEW_FINDINGS_RESPONSE_CONTRACT).toContain("applyPatch");
    expect(REVIEW_FINDINGS_RESPONSE_CONTRACT).toContain("navigate");
    expect(REVIEW_FINDINGS_RESPONSE_CONTRACT).toContain("explain");
    expect(REVIEW_FINDINGS_RESPONSE_CONTRACT).toContain("documentation");
  });
});

describe("parseAiReviewReply", () => {
  it("parses a compliant findings response", () => {
    const json = JSON.stringify({
      score: 72,
      level: "Suboptimal",
      summary: "The pipeline can be improved with AWQ int4.",
      findings: [
        {
          id: "review-1",
          title: "Enable AWQ int4 quantization",
          description: "Weights should be quantized to int4 for consumer TensorRT RTX.",
          severity: "warning",
          evidence: "Selected EP is NvTensorRT-RTX.",
          actions: [
            {
              kind: "applyPatch",
              label: "Apply AWQ int4",
              payload: { passes: { quantMethod: "awq", quantPrecision: "int4" } },
            },
            { kind: "explain", label: "Learn more", payload: { body: "AWQ int4 is recommended." } },
          ],
        },
      ],
    });

    const parsed = parseAiReviewReply(json);
    expect(parsed.structured).toBe(true);
    expect(parsed.score).toBe(72);
    expect(parsed.level).toBe("Suboptimal");
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0]!.actions).toHaveLength(2);
    expect(parsed.findings[0]!.actions[0]!.kind).toBe("applyPatch");
    expect(parsed.findings[0]!.actions[0]!.payload).toEqual({
      passes: { quantMethod: "awq", quantPrecision: "int4" },
    });
  });

  it("strips invalid applyPatch payloads and falls back to explain", () => {
    const json = JSON.stringify({
      score: 55,
      level: "Inefficient",
      summary: "Bad suggestion.",
      findings: [
        {
          id: "review-2",
          title: "Set nested Olive path",
          description: "Should not be allowed.",
          severity: "warning",
          evidence: "Nested path.",
          actions: [
            {
              kind: "applyPatch",
              label: "Apply nested",
              payload: { "passes.conversion.config.input_model_dtype": "fp16" },
            },
          ],
        },
      ],
    });

    const parsed = parseAiReviewReply(json);
    expect(parsed.structured).toBe(true);
    expect(parsed.findings[0]!.actions[0]!.kind).toBe("explain");
  });

  it("ensures every finding has at least one action", () => {
    const json = JSON.stringify({
      score: 80,
      level: "Optimized",
      summary: "Looks good.",
      findings: [
        {
          id: "review-3",
          title: "No patch available",
          description: "Everything is configured.",
          severity: "info",
          evidence: "No action.",
          actions: [],
        },
      ],
    });

    const parsed = parseAiReviewReply(json);
    expect(parsed.findings[0]!.actions).toHaveLength(1);
    expect(parsed.findings[0]!.actions[0]!.kind).toBe("explain");
  });

  it("returns structured=false for malformed JSON", () => {
    const parsed = parseAiReviewReply("not json");
    expect(parsed.structured).toBe(false);
    expect(parsed.findings).toEqual([]);
  });

  it("ignores invalid actions and keeps valid ones", () => {
    const json = JSON.stringify({
      score: 60,
      level: "Suboptimal",
      summary: "Mixed actions.",
      findings: [
        {
          id: "review-4",
          title: "Mixed",
          description: "Some actions are invalid.",
          severity: "warning",
          evidence: "Mixed.",
          actions: [
            { kind: "navigate", label: "Open", payload: {} },
            { kind: "documentation", label: "Docs", payload: { url: "https://example.com" } },
            { kind: "bogus", label: "Bogus", payload: {} },
          ],
        },
      ],
    });

    const parsed = parseAiReviewReply(json);
    expect(parsed.findings[0]!.actions).toHaveLength(1);
    expect(parsed.findings[0]!.actions[0]!.kind).toBe("documentation");
  });

  it("caps the number of findings at 3", () => {
    const findings = Array.from({ length: 6 }, (_, i) => ({
      id: `f-${i}`,
      title: `Finding ${i}`,
      description: "Desc.",
      severity: "info",
      evidence: "E.",
      actions: [{ kind: "explain", label: "Learn", payload: { body: "x" } }],
    }));
    const parsed = parseAiReviewReply(JSON.stringify({ score: 50, level: "Inefficient", summary: "Many", findings }));
    expect(parsed.findings).toHaveLength(3);
  });
});

describe("filterFindings", () => {
  const ctx = {
    model: { displayName: "meta-llama/Llama-2-7b", huggingFaceId: "meta-llama/Llama-2-7b", hfTask: "" },
    hardware: { executionProvider: "NvTensorRTRTXExecutionProvider" },
  } as unknown as AuditFilterContext;

  it("drops classic TensorRT suggestions when on NvTensorRT-RTX", () => {
    const findings: Finding[] = [
      {
        id: "bad",
        title: "Add TensorRTExecutionProvider",
        description: "Use classic TRT engine build.",
        severity: "warning",
        evidence: "Engine build.",
        actions: [{ kind: "applyPatch", label: "Apply", payload: { passes: { conversion: true } } }],
      },
      {
        id: "good",
        title: "Use AWQ int4",
        description: "Consumer RTX works best with AWQ.",
        severity: "warning",
        evidence: "OK.",
        actions: [{ kind: "applyPatch", label: "Apply", payload: { passes: { quantMethod: "awq" } } }],
      },
    ];

    const filtered = filterFindings(findings, ctx);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.id).toBe("good");
  });

  it("drops ASR advice for non-ASR models", () => {
    const findings: Finding[] = [
      {
        id: "bad",
        title: "Whisper pipeline",
        description: "Use Whisper automatic speech recognition.",
        severity: "warning",
        evidence: "ASR.",
        actions: [{ kind: "explain", label: "Learn", payload: { body: "x" } }],
      },
    ];

    expect(filterFindings(findings, ctx)).toHaveLength(0);
  });

  it("limits results to 3 findings", () => {
    const findings: Finding[] = Array.from({ length: 5 }, (_, i) => ({
      id: `f-${i}`,
      title: `Finding ${i}`,
      description: "Desc.",
      severity: "info",
      evidence: "E.",
      actions: [{ kind: "explain", label: "Learn", payload: { body: "x" } }],
    }));
    expect(filterFindings(findings, ctx)).toHaveLength(3);
  });
});
