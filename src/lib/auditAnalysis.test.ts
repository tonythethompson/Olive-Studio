import { describe, it, expect } from "vitest";
import { closeTruncatedJson, expandTerseSuggestion, parseAuditAnalysisReply } from "./auditAnalysis.ts";

describe("closeTruncatedJson", () => {
  it("closes an unterminated string and open braces", () => {
    const raw = `{"score":55,"level":"Suboptimal","summary":"Enable AWQ for`;
    const closed = closeTruncatedJson(raw);
    expect(() => JSON.parse(closed)).not.toThrow();
    expect(JSON.parse(closed).score).toBe(55);
  });

  it("drops a trailing lone backslash before closing the string", () => {
    const raw = `{"score":55,"summary":"path C:\\`;
    const closed = closeTruncatedJson(raw);
    expect(() => JSON.parse(closed)).not.toThrow();
    expect(JSON.parse(closed).score).toBe(55);
  });

  it("keeps a completed escape pair intact", () => {
    const raw = `{"score":55,"summary":"path C:\\\\`;
    const closed = closeTruncatedJson(raw);
    expect(JSON.parse(closed).summary).toBe("path C:\\");
  });
});

describe("parseAuditAnalysisReply", () => {
  it("parses a valid audit payload", () => {
    const raw = JSON.stringify({
      score: 72,
      level: "Suboptimal",
      summary: "Consider AWQ",
      suggestions: [
        {
          title: "Enable AWQ",
          description: "Use AWQ int4",
          impact: "High",
          type: "suggestion",
          autofix: { pass: "quantMethod", value: "awq" },
        },
      ],
    });
    const parsed = parseAuditAnalysisReply(raw);
    expect(parsed.score).toBe(72);
    expect(parsed.suggestions).toHaveLength(1);
    expect(parsed.suggestions[0]!.autofix.value).toBe("awq");
  });

  it("keeps empty suggestions and caps at 3", () => {
    const empty = parseAuditAnalysisReply(
      JSON.stringify({ score: 90, level: "Optimized", summary: "Looks solid.", suggestions: [] }),
    );
    expect(empty.suggestions).toHaveLength(0);

    const many = parseAuditAnalysisReply(
      JSON.stringify({
        score: 50,
        level: "Suboptimal",
        summary: "Several ideas.",
        suggestions: Array.from({ length: 6 }, (_, i) => ({
          title: `Idea ${i}`,
          description: `Do thing ${i} for a better Olive / ORT fit on this GPU.`,
          impact: "Low",
          type: "suggestion",
          autofix: { pass: "quantMethod", value: "awq" },
        })),
      }),
    );
    expect(many.suggestions).toHaveLength(3);
  });

  it("recovers truncated JSON instead of throwing", () => {
    const raw =
      '{"score":40,"level":"Critical","summary":"Missing quantization for TensorRT RTX path and also';
    const parsed = parseAuditAnalysisReply(raw);
    expect(parsed.score).toBe(40);
    expect(parsed.level).toBe("Critical");
    expect(parsed.summary.length).toBeGreaterThan(0);
  });

  it("falls back to a soft summary for free-form text (like chat)", () => {
    const parsed = parseAuditAnalysisReply("You should enable AWQ and disable structured pruning.");
    expect(parsed.score).toBe(50);
    expect(parsed.suggestions).toEqual([]);
    expect(parsed.summary).toMatch(/Partial audit|unstructured/i);
  });

  it("does not treat unrelated JSON as a structured audit", () => {
    const parsed = parseAuditAnalysisReply(
      JSON.stringify({ email: "dev@example.com", accounts: [{ id: "abc" }] }),
    );
    expect(parsed.structured).toBe(false);
    expect(parsed.summary).toMatch(/Partial audit|unstructured/i);
  });

  it("expands terse field-name suggestions into readable sentences", () => {
    const expanded = expandTerseSuggestion("opset", "update to 21", {
      pass: "conversionOpset",
      value: "21",
    });
    expect(expanded.title.toLowerCase()).toContain("conversionopset");
    expect(expanded.description.split(/\s+/).length).toBeGreaterThan(6);
  });
});
