/**
 * Property-based and unit tests for MultiLoRA adapter validation (Task 11.1 / 11.2).
 * Feature: v05-release, Property 16: MultiLoRA Adapter Validation
 *
 * Validates: Requirements 11.2, 11.4, 11.5
 *
 * For any adapter entry in the `adapters` array (when `multiLora` flag is enabled):
 * `name` must be a non-empty string unique across all entries, `path` must be a
 * non-empty string, `rank` must be a positive integer, `alpha` must be a positive
 * finite number, and optional `targetModules` must be an array of non-empty strings.
 * The maximum adapter count must be 2 for hardware profiles with <= 12 GB VRAM and
 * 8 for profiles above 12 GB VRAM.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  validateAdapters,
  getMaxAdapterCount,
} from "@/lib/multiLoraValidation";

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Generate a valid adapter entry. */
const arbValidAdapter = fc.record({
  name: fc.string({ minLength: 1, maxLength: 50 }),
  path: fc.string({ minLength: 1, maxLength: 200 }),
  rank: fc.integer({ min: 1, max: 256 }),
  alpha: fc.double({ min: 0.001, max: 1000, noNaN: true }),
  targetModules: fc.option(
    fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 10 }),
    { nil: undefined },
  ),
});

/** Generate an array of valid adapters with unique names. */
function arbUniqueAdapters(min: number, max: number) {
  return fc
    .array(arbValidAdapter, { minLength: min, maxLength: max })
    .map((adapters) => {
      // Ensure unique names by appending index suffix
      return adapters.map((a, i) => ({ ...a, name: `adapter-${i}-${a.name}` }));
    });
}

/** Generate VRAM values in the low range (<= 12 GB). */
const arbLowVram = fc.double({ min: 0.5, max: 12, noNaN: true });

/** Generate VRAM values in the high range (> 12 GB). */
const arbHighVram = fc.double({ min: 12.001, max: 128, noNaN: true });

// ─── Property Tests ──────────────────────────────────────────────────────────

describe("multiLoraValidation — Property 16: MultiLoRA Adapter Validation", () => {
  /**
   * **Validates: Requirements 11.2**
   *
   * Property 16a: Valid adapter arrays pass validation.
   * For any array of adapters with unique names, non-empty paths, positive integer
   * ranks, positive finite alphas, and valid targetModules (within count limits),
   * validateAdapters returns valid=true with the parsed adapters.
   */
  it("accepts valid adapter arrays within count limits", () => {
    fc.assert(
      fc.property(
        arbUniqueAdapters(1, 2),
        arbLowVram,
        (adapters, vram) => {
          const result = validateAdapters(adapters, vram);
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
          expect(result.adapters).toHaveLength(adapters.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 11.4**
   *
   * Property 16b: VRAM-based adapter count limit for low VRAM (<=12 GB).
   * For any hardware with <= 12 GB VRAM, max adapter count is 2.
   * Arrays exceeding this count are rejected.
   */
  it("enforces max 2 adapters for <= 12 GB VRAM", () => {
    fc.assert(
      fc.property(
        arbUniqueAdapters(3, 8),
        arbLowVram,
        (adapters, vram) => {
          const result = validateAdapters(adapters, vram);
          expect(result.valid).toBe(false);
          const countError = result.errors.find((e) => e.field === "adapters");
          expect(countError).toBeDefined();
          expect(countError!.message).toContain("exceeds maximum of 2");
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 11.4**
   *
   * Property 16c: VRAM-based adapter count limit for high VRAM (>12 GB).
   * For any hardware with > 12 GB VRAM, max adapter count is 8.
   * Arrays within [1, 8] are accepted; arrays exceeding 8 are rejected.
   */
  it("accepts up to 8 adapters for > 12 GB VRAM", () => {
    fc.assert(
      fc.property(
        arbUniqueAdapters(1, 8),
        arbHighVram,
        (adapters, vram) => {
          const result = validateAdapters(adapters, vram);
          expect(result.valid).toBe(true);
          expect(result.adapters).toHaveLength(adapters.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects more than 8 adapters for > 12 GB VRAM", () => {
    fc.assert(
      fc.property(
        arbUniqueAdapters(9, 15),
        arbHighVram,
        (adapters, vram) => {
          const result = validateAdapters(adapters, vram);
          expect(result.valid).toBe(false);
          const countError = result.errors.find((e) => e.field === "adapters");
          expect(countError).toBeDefined();
          expect(countError!.message).toContain("exceeds maximum of 8");
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 11.2**
   *
   * Property 16d: Empty name is rejected.
   * For any adapter with an empty name string, validation fails with a name error.
   */
  it("rejects adapters with empty name", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.integer({ min: 1, max: 64 }),
        fc.double({ min: 0.1, max: 100, noNaN: true }),
        (path, rank, alpha) => {
          const adapters = [{ name: "", path, rank, alpha }];
          const result = validateAdapters(adapters, 24);
          expect(result.valid).toBe(false);
          const nameError = result.errors.find(
            (e) => e.index === 0 && e.field === "name",
          );
          expect(nameError).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 11.2**
   *
   * Property 16e: Empty path is rejected.
   * For any adapter with an empty path string, validation fails with a path error.
   */
  it("rejects adapters with empty path", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.integer({ min: 1, max: 64 }),
        fc.double({ min: 0.1, max: 100, noNaN: true }),
        (name, rank, alpha) => {
          const adapters = [{ name, path: "", rank, alpha }];
          const result = validateAdapters(adapters, 24);
          expect(result.valid).toBe(false);
          const pathError = result.errors.find(
            (e) => e.index === 0 && e.field === "path",
          );
          expect(pathError).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 11.2**
   *
   * Property 16f: Non-positive or non-integer rank is rejected.
   * For any adapter with rank <= 0 or fractional rank, validation fails.
   */
  it("rejects adapters with non-positive rank", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100, max: 0 }),
        (badRank) => {
          const adapters = [{ name: "test", path: "/model", rank: badRank, alpha: 1.0 }];
          const result = validateAdapters(adapters, 24);
          expect(result.valid).toBe(false);
          const rankError = result.errors.find(
            (e) => e.index === 0 && e.field === "rank",
          );
          expect(rankError).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects adapters with fractional rank", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.1, max: 100, noNaN: true }).filter((n) => !Number.isInteger(n)),
        (fractionalRank) => {
          const adapters = [{ name: "test", path: "/model", rank: fractionalRank, alpha: 1.0 }];
          const result = validateAdapters(adapters, 24);
          expect(result.valid).toBe(false);
          const rankError = result.errors.find(
            (e) => e.index === 0 && e.field === "rank",
          );
          expect(rankError).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 11.2**
   *
   * Property 16g: Non-positive or non-finite alpha is rejected.
   * For any adapter with alpha <= 0, NaN, or Infinity, validation fails.
   */
  it("rejects adapters with non-positive alpha", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1000, max: 0, noNaN: true }),
        (badAlpha) => {
          const adapters = [{ name: "test", path: "/model", rank: 4, alpha: badAlpha }];
          const result = validateAdapters(adapters, 24);
          expect(result.valid).toBe(false);
          const alphaError = result.errors.find(
            (e) => e.index === 0 && e.field === "alpha",
          );
          expect(alphaError).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("rejects adapters with NaN or Infinity alpha", () => {
    const badAlphas = [NaN, Infinity, -Infinity];
    for (const alpha of badAlphas) {
      const adapters = [{ name: "test", path: "/model", rank: 4, alpha }];
      const result = validateAdapters(adapters, 24);
      expect(result.valid).toBe(false);
      const alphaError = result.errors.find(
        (e) => e.index === 0 && e.field === "alpha",
      );
      expect(alphaError).toBeDefined();
    }
  });

  /**
   * **Validates: Requirements 11.2**
   *
   * Property 16h: Invalid targetModules are rejected.
   * For any adapter with targetModules containing empty strings or non-strings,
   * validation fails with a targetModules error.
   */
  it("rejects adapters with invalid targetModules", () => {
    const invalidCases = [
      { name: "a", path: "/p", rank: 1, alpha: 1.0, targetModules: [""] },
      { name: "b", path: "/p", rank: 1, alpha: 1.0, targetModules: [123] },
      { name: "c", path: "/p", rank: 1, alpha: 1.0, targetModules: "not-array" },
      { name: "d", path: "/p", rank: 1, alpha: 1.0, targetModules: [null] },
    ];
    for (const adapter of invalidCases) {
      const result = validateAdapters([adapter] as unknown[], 24);
      expect(result.valid).toBe(false);
      const tmError = result.errors.find(
        (e) => e.index === 0 && e.field === "targetModules",
      );
      expect(tmError).toBeDefined();
    }
  });

  /**
   * **Validates: Requirements 11.5**
   *
   * Property 16i: Duplicate adapter names are detected.
   * For any adapters array containing duplicate names, validation reports an error
   * identifying the conflicting indices.
   */
  it("detects duplicate adapter names with conflicting indices", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }),
        (name) => {
          const adapters = [
            { name, path: "/path1", rank: 4, alpha: 1.0 },
            { name, path: "/path2", rank: 8, alpha: 2.0 },
          ];
          const result = validateAdapters(adapters, 24);
          expect(result.valid).toBe(false);
          const dupError = result.errors.find(
            (e) => e.field === "name" && e.message.includes("Duplicate"),
          );
          expect(dupError).toBeDefined();
          expect(dupError!.message).toContain("0");
          expect(dupError!.message).toContain("1");
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 11.2**
   *
   * Property 16j: Valid adapters with targetModules pass.
   * For any valid adapter with a proper targetModules array of non-empty strings,
   * validation succeeds and preserves the targetModules in the output.
   */
  it("preserves valid targetModules in parsed output", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 1, maxLength: 5 }),
        (modules) => {
          const adapters = [{ name: "lora-a", path: "/weights", rank: 16, alpha: 32, targetModules: modules }];
          const result = validateAdapters(adapters, 24);
          expect(result.valid).toBe(true);
          expect(result.adapters[0].targetModules).toEqual(modules);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Unit Tests ──────────────────────────────────────────────────────────────

describe("multiLoraValidation — Unit Tests", () => {
  describe("getMaxAdapterCount", () => {
    it("returns 2 for 12 GB VRAM", () => {
      expect(getMaxAdapterCount(12)).toBe(2);
    });

    it("returns 2 for VRAM below 12 GB", () => {
      expect(getMaxAdapterCount(4)).toBe(2);
      expect(getMaxAdapterCount(8)).toBe(2);
    });

    it("returns 8 for VRAM above 12 GB", () => {
      expect(getMaxAdapterCount(16)).toBe(8);
      expect(getMaxAdapterCount(24)).toBe(8);
      expect(getMaxAdapterCount(80)).toBe(8);
    });
  });

  describe("validateAdapters", () => {
    it("returns valid result for a single well-formed adapter", () => {
      const adapters = [
        { name: "lora-chat", path: "/models/chat-adapter", rank: 16, alpha: 32 },
      ];
      const result = validateAdapters(adapters, 24);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.adapters).toHaveLength(1);
      expect(result.adapters[0]).toEqual({
        name: "lora-chat",
        path: "/models/chat-adapter",
        rank: 16,
        alpha: 32,
      });
    });

    it("returns valid result for two adapters with different names", () => {
      const adapters = [
        { name: "lora-chat", path: "/models/chat", rank: 8, alpha: 16 },
        { name: "lora-code", path: "/models/code", rank: 16, alpha: 32, targetModules: ["q_proj", "v_proj"] },
      ];
      const result = validateAdapters(adapters, 24);
      expect(result.valid).toBe(true);
      expect(result.adapters).toHaveLength(2);
      expect(result.adapters[1].targetModules).toEqual(["q_proj", "v_proj"]);
    });

    it("rejects null entries in the array", () => {
      const adapters = [null];
      const result = validateAdapters(adapters as unknown[], 24);
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe("entry");
    });

    it("rejects array entries in the array", () => {
      const adapters = [["not", "an", "object"]];
      const result = validateAdapters(adapters as unknown[], 24);
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe("entry");
    });

    it("returns multiple errors for multiple invalid fields", () => {
      const adapters = [
        { name: "", path: "", rank: -1, alpha: 0 },
      ];
      const result = validateAdapters(adapters, 24);
      expect(result.valid).toBe(false);
      // Should have errors for name, path, rank, and alpha
      expect(result.errors.length).toBeGreaterThanOrEqual(4);
      const fields = result.errors.map((e) => e.field);
      expect(fields).toContain("name");
      expect(fields).toContain("path");
      expect(fields).toContain("rank");
      expect(fields).toContain("alpha");
    });

    it("rejects adapter with non-string name", () => {
      const adapters = [{ name: 123, path: "/p", rank: 4, alpha: 1.0 }];
      const result = validateAdapters(adapters as unknown[], 24);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "name")).toBe(true);
    });

    it("rejects adapter with non-string path", () => {
      const adapters = [{ name: "test", path: null, rank: 4, alpha: 1.0 }];
      const result = validateAdapters(adapters as unknown[], 24);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "path")).toBe(true);
    });

    it("detects three-way duplicate names", () => {
      const adapters = [
        { name: "dupe", path: "/a", rank: 4, alpha: 1.0 },
        { name: "dupe", path: "/b", rank: 8, alpha: 2.0 },
        { name: "dupe", path: "/c", rank: 16, alpha: 4.0 },
      ];
      const result = validateAdapters(adapters, 24);
      expect(result.valid).toBe(false);
      const dupError = result.errors.find(
        (e) => e.field === "name" && e.message.includes("Duplicate"),
      );
      expect(dupError).toBeDefined();
      expect(dupError!.message).toContain("0");
      expect(dupError!.message).toContain("1");
      expect(dupError!.message).toContain("2");
    });

    it("returns empty adapters array when validation fails", () => {
      const adapters = [{ name: "", path: "/p", rank: 4, alpha: 1.0 }];
      const result = validateAdapters(adapters, 24);
      expect(result.valid).toBe(false);
      expect(result.adapters).toHaveLength(0);
    });

    it("handles adapter entry with undefined targetModules (optional field)", () => {
      const adapters = [{ name: "test", path: "/p", rank: 4, alpha: 1.0 }];
      const result = validateAdapters(adapters, 24);
      expect(result.valid).toBe(true);
      expect(result.adapters[0].targetModules).toBeUndefined();
    });

    it("enforces count limit of 2 for exactly 12 GB VRAM", () => {
      const adapters = [
        { name: "a", path: "/a", rank: 4, alpha: 1.0 },
        { name: "b", path: "/b", rank: 4, alpha: 1.0 },
        { name: "c", path: "/c", rank: 4, alpha: 1.0 },
      ];
      const result = validateAdapters(adapters, 12);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "adapters")).toBe(true);
    });

    it("allows exactly 2 adapters for 12 GB VRAM", () => {
      const adapters = [
        { name: "a", path: "/a", rank: 4, alpha: 1.0 },
        { name: "b", path: "/b", rank: 4, alpha: 1.0 },
      ];
      const result = validateAdapters(adapters, 12);
      expect(result.valid).toBe(true);
    });
  });
});
