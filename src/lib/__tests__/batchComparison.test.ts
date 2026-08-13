/**
 * Property-based tests for batch comparison job count constraint (Task 5.5).
 * Feature: v05-release, Property 12: Batch Comparison Job Count Constraint
 *
 * Validates: Requirements 8.6
 *
 * For any invocation of the batch comparison, the input job record count must be
 * between 2 and 10 inclusive. Inputs outside this range must be rejected without
 * producing a comparison table.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { validateJobCount, parseMcpCompareOutput } from "@/lib/batchComparison";

describe("batchComparison — Property 12: Batch Comparison Job Count Constraint", () => {
  /**
   * **Validates: Requirements 8.6**
   *
   * Property 12a: Integers in [2, 10] are accepted.
   * For any integer count within the valid range, validateJobCount returns true.
   */
  it("accepts all integers in [2, 10]", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 10 }),
        (count) => {
          expect(validateJobCount(count)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.6**
   *
   * Property 12b: Integers below 2 are rejected.
   * For any integer less than 2, validateJobCount returns false.
   */
  it("rejects all integers below 2", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 1 }),
        (count) => {
          expect(validateJobCount(count)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.6**
   *
   * Property 12c: Integers above 10 are rejected.
   * For any integer greater than 10, validateJobCount returns false.
   */
  it("rejects all integers above 10", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 11, max: 10000 }),
        (count) => {
          expect(validateJobCount(count)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.6**
   *
   * Property 12d: Non-integer edge values are rejected.
   * NaN, Infinity, -Infinity, and fractional values outside [2, 10] integer
   * range are rejected by validateJobCount.
   */
  it("rejects NaN, Infinity, and -Infinity", () => {
    expect(validateJobCount(NaN)).toBe(false);
    expect(validateJobCount(Infinity)).toBe(false);
    expect(validateJobCount(-Infinity)).toBe(false);
  });

  /**
   * **Validates: Requirements 8.6**
   *
   * Property 12e: Fractional values are rejected since validateJobCount requires integer job counts.
   * Fractional values across all ranges (e.g. 1.5 below range, 2.5 within 2–10 range, 10.5 above range) are rejected.
   */
  it("rejects fractional values below 2 and above 10", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1000, max: 1.999, noNaN: true }),
        (count) => {
          expect(validateJobCount(count)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );

    fc.assert(
      fc.property(
        fc.double({ min: 10.001, max: 100000, noNaN: true }),
        (count) => {
          expect(validateJobCount(count)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 8.6**
   *
   * Property 12f: The boundary values 2 and 10 are accepted (inclusive range).
   */
  it("accepts exact boundary values 2 and 10", () => {
    expect(validateJobCount(2)).toBe(true);
    expect(validateJobCount(10)).toBe(true);
  });

  /**
   * **Validates: Requirements 8.6**
   *
   * Property 12g: The boundary-adjacent values 1 and 11 are rejected.
   */
  it("rejects boundary-adjacent values 1 and 11", () => {
    expect(validateJobCount(1)).toBe(false);
    expect(validateJobCount(11)).toBe(false);
  });
});

describe("batchComparison — parseMcpCompareOutput validation", () => {
  /** Helper: generate a finite double (no NaN, no Infinity). */
  const arbFiniteDouble = fc.double({ noNaN: true, min: -1e15, max: 1e15 });

  /** Helper: generate a valid CompareResultEntry-shaped object. */
  const arbResultEntry = fc.record({
    job_id: fc.string({ minLength: 1, maxLength: 20 }),
    latency_ms: fc.oneof(arbFiniteDouble, fc.constant(null)),
    model_size_mb: fc.oneof(arbFiniteDouble, fc.constant(null)),
    accuracy: fc.oneof(arbFiniteDouble, fc.constant(null)),
    score: arbFiniteDouble,
  });

  /** Helper: generate a valid ExcludedJob-shaped object. */
  const arbExcludedJob = fc.record({
    job_id: fc.string({ minLength: 1, maxLength: 20 }),
    reason: fc.string({ minLength: 1, maxLength: 100 }),
  });

  /** Helper: generate a full valid CompareResultsOutput-shaped object. */
  const arbValidOutput = fc
    .record({
      results: fc.array(arbResultEntry, { minLength: 0, maxLength: 10 }),
      reasoning: fc.string({ minLength: 1, maxLength: 200 }),
      excluded_jobs: fc.array(arbExcludedJob, { minLength: 0, maxLength: 5 }),
    })
    .chain((base) =>
      fc
        .oneof(
          fc.constant(null),
          base.results.length > 0
            ? fc.constantFrom(...base.results.map((r) => r.job_id))
            : fc.constant(null),
        )
        .map((winner) => ({ ...base, winner })),
    );

  it("returns typed output for valid MCP compare_results responses", () => {
    fc.assert(
      fc.property(arbValidOutput, (raw) => {
        const result = parseMcpCompareOutput(raw as Record<string, unknown>);
        expect(result).not.toBeNull();
        expect(result!.results).toEqual(raw.results);
        expect(result!.winner).toEqual(raw.winner);
        expect(result!.reasoning).toEqual(raw.reasoning);
        expect(result!.excluded_jobs).toEqual(raw.excluded_jobs);
      }),
      { numRuns: 100 },
    );
  });

  it("returns null when results is not an array", () => {
    const invalidInputs = [
      { results: "not-array", winner: null, reasoning: "x", excluded_jobs: [] },
      { results: 42, winner: null, reasoning: "x", excluded_jobs: [] },
      { results: null, winner: null, reasoning: "x", excluded_jobs: [] },
      { winner: null, reasoning: "x", excluded_jobs: [] }, // missing results
    ];
    for (const input of invalidInputs) {
      expect(parseMcpCompareOutput(input as Record<string, unknown>)).toBeNull();
    }
  });

  it("returns null when winner is invalid type (not string or null)", () => {
    fc.assert(
      fc.property(
        fc.array(arbResultEntry, { minLength: 1, maxLength: 3 }),
        fc.oneof(fc.integer(), fc.boolean(), fc.constant(undefined)),
        (results, badWinner) => {
          const raw = {
            results,
            winner: badWinner,
            reasoning: "some reasoning",
            excluded_jobs: [],
          };
          expect(parseMcpCompareOutput(raw as Record<string, unknown>)).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns null when reasoning is not a string", () => {
    const raw = {
      results: [{ job_id: "j1", latency_ms: 10, model_size_mb: 50, accuracy: 0.9, score: 85 }],
      winner: null,
      reasoning: 123,
      excluded_jobs: [],
    };
    expect(parseMcpCompareOutput(raw as Record<string, unknown>)).toBeNull();
  });

  it("accepts MCP compare_results payloads nested under comparison.metrics", () => {
    const raw = {
      comparison: [
        {
          job_id: "a",
          status: "completed",
          metrics: { latency_ms: 12, model_size_mb: 40, accuracy: 0.8 },
          score: 0.7,
        },
        {
          job_id: "b",
          status: "completed",
          metrics: { latency_ms: 20, model_size_mb: 30, accuracy: null },
          score: 0.4,
        },
      ],
      winner: "a",
      reasoning: "a wins",
      excluded_jobs: [{ job_id: "c", reason: "job_failed" }],
    };
    const result = parseMcpCompareOutput(raw);
    expect(result).toEqual({
      results: [
        { job_id: "a", latency_ms: 12, model_size_mb: 40, accuracy: 0.8, score: 0.7 },
        { job_id: "b", latency_ms: 20, model_size_mb: 30, accuracy: null, score: 0.4 },
      ],
      winner: "a",
      reasoning: "a wins",
      excluded_jobs: [{ job_id: "c", reason: "job_failed" }],
    });
  });

  it("returns null when excluded_jobs contains invalid entries", () => {
    const raw = {
      results: [{ job_id: "j1", latency_ms: 10, model_size_mb: 50, accuracy: 0.9, score: 85 }],
      winner: null,
      reasoning: "ok",
      excluded_jobs: [{ job_id: 123, reason: "bad" }], // job_id not a string
    };
    expect(parseMcpCompareOutput(raw as Record<string, unknown>)).toBeNull();
  });
});
