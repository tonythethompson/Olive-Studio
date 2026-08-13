/**
 * Property-based tests for Recipe Catalog Version Pinning (Task 10.2).
 * Validates correctness property from design.md (Property 15).
 *
 * Feature: v05-release, Property 15: Catalog Commit SHA Format
 *
 * For any stored CatalogMetadata, the commitSha field must be exactly 40
 * characters long and consist only of hexadecimal characters ([0-9a-f]).
 *
 * Validates: Requirements 10.1, 10.2
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  isValidSha,
  formatCatalogMetadata,
  isCatalogStale,
  catalogEntryToRecipeItem,
  inferDeviceTarget,
  type CatalogEntry,
  type CatalogMetadata,
} from "@/lib/recipeCatalogPin";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Regex matching a valid 40-char lowercase hex SHA. */
const SHA_PATTERN = /^[0-9a-f]{40}$/;

/** Valid hexadecimal characters. */
const HEX_CHARS = "0123456789abcdef";

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Generate a valid 40-character lowercase hex SHA string. */
function arbValidSha(): fc.Arbitrary<string> {
  return fc
    .array(fc.constantFrom(...HEX_CHARS.split("")), {
      minLength: 40,
      maxLength: 40,
    })
    .map((chars) => chars.join(""));
}

/** Generate a SHA with invalid length (not 40 characters). */
function arbInvalidLengthSha(): fc.Arbitrary<string> {
  return fc.oneof(
    // Too short (1–39 chars)
    fc
      .array(fc.constantFrom(...HEX_CHARS.split("")), {
        minLength: 1,
        maxLength: 39,
      })
      .map((chars) => chars.join("")),
    // Too long (41–80 chars)
    fc
      .array(fc.constantFrom(...HEX_CHARS.split("")), {
        minLength: 41,
        maxLength: 80,
      })
      .map((chars) => chars.join("")),
    // Empty string
    fc.constant(""),
  );
}

/** Generate a 40-char string that contains at least one non-hex character. */
function arbInvalidCharsSha(): fc.Arbitrary<string> {
  // Characters that are NOT valid hex
  const nonHexChars = "ghijklmnopqrstuvwxyzGHIJKLMNOPQRSTUVWXYZ!@#$%^&*()_+-= ";

  return fc
    .tuple(
      // Position to inject the invalid character (0-39)
      fc.integer({ min: 0, max: 39 }),
      // The invalid character
      fc.constantFrom(...nonHexChars.split("")),
      // Base valid 40-char hex string (we'll replace one char)
      arbValidSha(),
    )
    .map(([pos, invalidChar, validSha]) => {
      return validSha.slice(0, pos) + invalidChar + validSha.slice(pos + 1);
    });
}

/** Generate a 40-char string with uppercase hex chars (should still fail strict check). */
function arbUppercaseSha(): fc.Arbitrary<string> {
  const upperHex = "0123456789ABCDEF";
  return fc
    .tuple(
      // Position to inject uppercase (0-39)
      fc.integer({ min: 0, max: 39 }),
      // The uppercase hex char (A-F only, not 0-9 which are same in both cases)
      fc.constantFrom("A", "B", "C", "D", "E", "F"),
      // Base valid lowercase SHA
      arbValidSha(),
    )
    .map(([pos, upperChar, validSha]) => {
      return validSha.slice(0, pos) + upperChar + validSha.slice(pos + 1);
    });
}

/** Generate a non-empty branch name. */
function arbBranchName(): fc.Arbitrary<string> {
  return fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0);
}

// ─── Property 15: Catalog Commit SHA Format ──────────────────────────────────

describe("Property 15: Catalog Commit SHA Format", () => {
  /**
   * Feature: v05-release, Property 15: Catalog Commit SHA Format
   *
   * For any stored CatalogMetadata, the commitSha field must be exactly 40
   * characters long and consist only of hexadecimal characters ([0-9a-f]).
   *
   * Validates: Requirements 10.1, 10.2
   */

  describe("isValidSha — accepts valid 40-char hex strings", () => {
    it("returns true for any valid 40-char lowercase hex string", () => {
      fc.assert(
        fc.property(arbValidSha(), (sha) => {
          expect(isValidSha(sha)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("isValidSha — rejects invalid strings", () => {
    it("returns false for strings with invalid length", () => {
      fc.assert(
        fc.property(arbInvalidLengthSha(), (sha) => {
          expect(isValidSha(sha)).toBe(false);
        }),
        { numRuns: 100 },
      );
    });

    it("returns false for 40-char strings with non-hex characters", () => {
      fc.assert(
        fc.property(arbInvalidCharsSha(), (sha) => {
          expect(isValidSha(sha)).toBe(false);
        }),
        { numRuns: 100 },
      );
    });

    it("returns false for 40-char strings with uppercase hex characters", () => {
      fc.assert(
        fc.property(arbUppercaseSha(), (sha) => {
          expect(isValidSha(sha)).toBe(false);
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("formatCatalogMetadata — produces valid SHA in output", () => {
    it("resulting commitSha matches ^[0-9a-f]{40}$ for any valid input SHA", () => {
      fc.assert(
        fc.property(arbValidSha(), arbBranchName(), (sha, branch) => {
          const metadata: CatalogMetadata = formatCatalogMetadata(sha, branch);

          // commitSha must be exactly 40 characters
          expect(metadata.commitSha).toHaveLength(40);

          // commitSha must match the strict pattern
          expect(metadata.commitSha).toMatch(SHA_PATTERN);

          // commitSha must be lowercase
          expect(metadata.commitSha).toBe(metadata.commitSha.toLowerCase());
        }),
        { numRuns: 100 },
      );
    });

    it("normalizes uppercase hex input to lowercase in commitSha", () => {
      fc.assert(
        fc.property(arbUppercaseSha(), arbBranchName(), (sha, branch) => {
          // formatCatalogMetadata calls .toLowerCase() internally
          const metadata: CatalogMetadata = formatCatalogMetadata(sha, branch);

          // The result must be all lowercase
          expect(metadata.commitSha).toBe(metadata.commitSha.toLowerCase());

          // The result must be 40 chars
          expect(metadata.commitSha).toHaveLength(40);
        }),
        { numRuns: 100 },
      );
    });

    it("preserves the branch name and generates a valid ISO timestamp", () => {
      fc.assert(
        fc.property(arbValidSha(), arbBranchName(), (sha, branch) => {
          const metadata: CatalogMetadata = formatCatalogMetadata(sha, branch);

          // branch is preserved
          expect(metadata.branch).toBe(branch);

          // fetchedAt is a valid ISO 8601 string
          expect(metadata.fetchedAt).toBeTruthy();
          const parsed = new Date(metadata.fetchedAt);
          expect(parsed.getTime()).not.toBeNaN();
        }),
        { numRuns: 100 },
      );
    });
  });

  describe("isCatalogStale — staleness detection", () => {
    it("returns false when stored SHA matches upstream SHA", () => {
      fc.assert(
        fc.property(arbValidSha(), arbBranchName(), (sha, branch) => {
          const stored: CatalogMetadata = {
            branch,
            commitSha: sha,
            fetchedAt: new Date().toISOString(),
          };
          expect(isCatalogStale(stored, sha)).toBe(false);
        }),
        { numRuns: 100 },
      );
    });

    it("returns true when stored SHA differs from upstream SHA", () => {
      fc.assert(
        fc.property(
          arbValidSha(),
          arbValidSha(),
          arbBranchName(),
          (storedSha, upstreamSha, branch) => {
            // Only test when SHAs are actually different
            fc.pre(storedSha !== upstreamSha);

            const stored: CatalogMetadata = {
              branch,
              commitSha: storedSha,
              fetchedAt: new Date().toISOString(),
            };
            expect(isCatalogStale(stored, upstreamSha)).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    it("is case-insensitive (normalizes upstream to lowercase for comparison)", () => {
      fc.assert(
        fc.property(arbValidSha(), arbBranchName(), (sha, branch) => {
          const stored: CatalogMetadata = {
            branch,
            commitSha: sha,
            fetchedAt: new Date().toISOString(),
          };
          // Pass uppercase version of same SHA — should still be not stale
          const uppercaseSha = sha.toUpperCase();
          expect(isCatalogStale(stored, uppercaseSha)).toBe(false);
        }),
        { numRuns: 100 },
      );
    });
  });
});

describe("catalogEntryToRecipeItem", () => {
  it("carries pinned.commitSha so deferred loads stay on the pin", () => {
    const sha = "a".repeat(40);
    const entry: CatalogEntry = {
      id: "Qwen-Qwen2.5-1.5B-Instruct/aitk/qwen2_5_dml_config.json",
      name: "LLM / qwen2_5_dml_config",
      architecture: "LLM",
      deviceTarget: "DirectML",
      content: null,
      pinned: { branch: "main", commitSha: sha, fetchedAt: "2026-01-01T00:00:00.000Z" },
    };
    const item = catalogEntryToRecipeItem(entry);
    expect(item.repoPath).toBe(entry.id);
    expect(item.commitSha).toBe(sha);
    expect(item.device).toBe("DirectML");
  });

  it("labels ROCm recipe paths as CUDA to match catalog device comparison", () => {
    expect(inferDeviceTarget("Llama-3-8B/rocm/llama3_rocm_gptq.json")).toBe("CUDA");
  });
});
