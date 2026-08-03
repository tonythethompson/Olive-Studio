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

  it("Property 3: Whitespace prompt blocks run", () => {
    // Feature: playground-tab, Property 3
    const whitespaceChar = fc.constantFrom(" ", "\t", "\n", "\r");
    fc.assert(
      fc.property(fc.stringOf(whitespaceChar, { maxLength: 32 }), (prompt) => {
        expect(isArenaPromptBlank(prompt)).toBe(true);
        expect(prompt.trim() === "").toBe(true);
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

  it("Property 7: New run clears prior outputs", () => {
    // Feature: playground-tab, Property 7
    fc.assert(
      fc.property(
        fc.record({
          outputA: fc.string(),
          outputB: fc.string(),
          elapsedA: fc.nat(),
          elapsedB: fc.nat(),
        }),
        (_prior) => {
          // Prior values are only used to document the property's "for any prior state"
          // premise; clearRunResults always returns the idle baseline regardless of input.
          void _prior;
          const cleared = clearRunResults();
          expect(cleared.resultA.output).toBe("");
          expect(cleared.resultB.output).toBe("");
          expect(cleared.resultA.elapsedMs).toBe(0);
          expect(cleared.resultB.elapsedMs).toBe(0);
          expect(cleared.resultA.status).toBe("idle");
          expect(cleared.resultB.status).toBe("idle");
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
