/**
 * Property-based tests for Playground core pure helpers (Task 12.1).
 * Tags follow design.md: // Feature: playground-tab, Property N
 */
import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { usePlaygroundStore, type PlaygroundSubView } from "@/lib/stores/playgroundStore";
import {
  ARENA_CLOUD_TIMEOUT_MIN_MS,
  ARENA_CLOUD_TIMEOUT_MAX_MS,
  resolveCloudTimeoutMs,
} from "@/lib/arenaConstants";
import {
  clearRunResults,
  computeElapsed,
  getFasterSlot,
  isArenaPromptBlank,
} from "@/components/features/ArenaPanel";

const SUB_VIEWS = ["browser-test", "benchmark", "arena"] as const satisfies readonly PlaygroundSubView[];

describe("playgroundPBT", () => {
  beforeEach(() => {
    usePlaygroundStore.getState().resetPlayground();
  });

  it("Property 1: Sub-view selection round-trip", () => {
    // Feature: playground-tab, Property 1
    fc.assert(
      fc.property(fc.constantFrom(...SUB_VIEWS), (v) => {
        usePlaygroundStore.getState().setActiveSubView(v);
        expect(usePlaygroundStore.getState().activeSubView).toBe(v);
      }),
      { numRuns: 100 },
    );
  });

  it("Property 3: isArenaPromptBlank matches trim() for blank and non-blank prompts", () => {
    // Feature: playground-tab, Property 3
    // Helper invariant: blank ⇔ trim() === "". UI/behavior (cloud run blocked,
    // prior results preserved) is covered in ArenaPanel.test.tsx.
    const whitespaceChar = fc.constantFrom(" ", "\t", "\n", "\r");

    // Blank-only inputs must be blank.
    fc.assert(
      fc.property(fc.stringOf(whitespaceChar, { maxLength: 32 }), (prompt) => {
        expect(isArenaPromptBlank(prompt)).toBe(true);
      }),
      { numRuns: 50 },
    );

    // Contrapositive: any string with a non-whitespace character is not blank.
    fc.assert(
      fc.property(
        fc.tuple(
          fc.stringOf(whitespaceChar, { maxLength: 8 }),
          fc.string({ minLength: 1 }).filter((s) => /\S/.test(s)),
          fc.stringOf(whitespaceChar, { maxLength: 8 }),
        ),
        ([pre, mid, post]) => {
          const prompt = `${pre}${mid}${post}`;
          expect(isArenaPromptBlank(prompt)).toBe(false);
        },
      ),
      { numRuns: 50 },
    );

    // Full equivalence over arbitrary strings (covers both directions).
    fc.assert(
      fc.property(fc.string(), (prompt) => {
        expect(isArenaPromptBlank(prompt)).toBe(prompt.trim() === "");
      }),
      { numRuns: 100 },
    );
  });

  it("Property 4: Elapsed time positive for completed runs", () => {
    // Feature: playground-tab, Property 4
    fc.assert(
      fc.property(
        fc
          .tuple(fc.nat({ max: 1_000_000 }), fc.nat({ max: 1_000_000 }))
          .map(([a, b]) => [Math.min(a, b), Math.max(a, b) + 1] as const),
        ([start, end]) => {
          expect(end).toBeGreaterThan(start);
          expect(computeElapsed(start, end)).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Property 6: Faster slot gets emerald highlight", () => {
    // Feature: playground-tab, Property 6
    fc.assert(
      fc.property(
        fc
          .tuple(
            fc.double({ min: 0.1, max: 10_000, noNaN: true }),
            fc.double({ min: 0.1, max: 10_000, noNaN: true }),
          )
          .filter(([a, b]) => Math.abs(a - b) > 0.0001),
        ([a, b]) => {
          expect(getFasterSlot(a, b)).toBe(a < b ? "a" : "b");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Property 7: New run clear fully replaces any prior slot results", () => {
    // Feature: playground-tab, Property 7
    // Models handleRun's replace-with-clearRunResults() step: for any prior
    // completed/error/running pair, applying the clear yields the idle baseline
    // (full replace, not merge). Component-level second-run lifecycle is in
    // ArenaPanel.test.tsx.
    const statusArb = fc.constantFrom("idle", "running", "done", "error") as fc.Arbitrary<
      "idle" | "running" | "done" | "error"
    >;
    fc.assert(
      fc.property(
        fc.record({
          outputA: fc.string(),
          outputB: fc.string(),
          elapsedA: fc.nat({ max: 1_000_000 }),
          elapsedB: fc.nat({ max: 1_000_000 }),
          statusA: statusArb,
          statusB: statusArb,
          errorA: fc.option(fc.string(), { nil: undefined }),
          errorB: fc.option(fc.string(), { nil: undefined }),
        }),
        (prior) => {
          const priorState = {
            resultA: {
              output: prior.outputA,
              elapsedMs: prior.elapsedA,
              status: prior.statusA,
              ...(prior.errorA !== undefined ? { error: prior.errorA } : {}),
            },
            resultB: {
              output: prior.outputB,
              elapsedMs: prior.elapsedB,
              status: prior.statusB,
              ...(prior.errorB !== undefined ? { error: prior.errorB } : {}),
            },
          };

          // handleRun does not merge prior into cleared — it assigns clearRunResults()
          // then sets status to "running" (parallel path). Sequential path runs Slot A
          // first with the same clear baseline for both slots.
          const cleared = clearRunResults();
          const afterClear = {
            resultA: { ...cleared.resultA, status: "running" as const },
            resultB: { ...cleared.resultB, status: "running" as const },
          };

          expect(cleared).toEqual({
            resultA: { output: "", elapsedMs: 0, status: "idle" },
            resultB: { output: "", elapsedMs: 0, status: "idle" },
          });
          expect(afterClear).toEqual({
            resultA: { output: "", elapsedMs: 0, status: "running" },
            resultB: { output: "", elapsedMs: 0, status: "running" },
          });
          // Full replace: residual prior keys (e.g. error) are not kept.
          expect("error" in afterClear.resultA).toBe(false);
          expect("error" in afterClear.resultB).toBe(false);
          // Contrast with merge semantics which would retain prior.error.
          const mergedA = { ...priorState.resultA, ...cleared.resultA };
          if (prior.errorA !== undefined) {
            expect("error" in mergedA).toBe(true);
            expect("error" in afterClear.resultA).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("Property 13: Cloud timeout resolution always bounded", () => {
    // Feature: playground-tab, Property 13
    const edgeCases = [
      undefined,
      null,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      0,
      -1,
      1e9,
      "30000",
      {},
      [],
    ];

    for (const edge of edgeCases) {
      expect(() => resolveCloudTimeoutMs(edge)).not.toThrow();
      const ms = resolveCloudTimeoutMs(edge);
      expect(Number.isFinite(ms)).toBe(true);
      expect(ms).toBeGreaterThanOrEqual(ARENA_CLOUD_TIMEOUT_MIN_MS);
      expect(ms).toBeLessThanOrEqual(ARENA_CLOUD_TIMEOUT_MAX_MS);
    }

    fc.assert(
      fc.property(fc.anything(), (raw) => {
        expect(() => resolveCloudTimeoutMs(raw)).not.toThrow();
        const ms = resolveCloudTimeoutMs(raw);
        expect(Number.isFinite(ms)).toBe(true);
        expect(ms).toBeGreaterThanOrEqual(ARENA_CLOUD_TIMEOUT_MIN_MS);
        expect(ms).toBeLessThanOrEqual(ARENA_CLOUD_TIMEOUT_MAX_MS);
      }),
      { numRuns: 100 },
    );
  });
});
