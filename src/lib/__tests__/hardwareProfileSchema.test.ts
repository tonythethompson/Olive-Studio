/* Feature: ep-expansion-pack, Property 2: Hardware Profile Schema Completeness */

/**
 * Property-based test validating that every hardware profile in the MCP
 * knowledge base conforms to the required schema with correct field types.
 *
 * **Validates: Requirements 11.5, 14.5, 15.1**
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ─── Load hardware_profiles.json ─────────────────────────────────────────────

const profilesPath = resolve(
  import.meta.dirname,
  "../../../olive-mcp-server/olive_mcp_server/knowledge_base/hardware_profiles.json",
);
const raw = JSON.parse(readFileSync(profilesPath, "utf-8")) as {
  profiles: Record<string, unknown>[];
};
const profiles = raw.profiles;

// ─── Valid accelerator values ────────────────────────────────────────────────

const VALID_ACCELERATORS = new Set(["gpu", "cpu", "npu"]);

// ─── Property Test ───────────────────────────────────────────────────────────

describe("hardwareProfileSchema — Property 2: Hardware Profile Schema Completeness", () => {
  it("every profile has all required fields with correct types", () => {
    // Ensure we have profiles to test
    expect(profiles.length).toBeGreaterThan(0);

    // Create an arbitrary that samples uniformly from the loaded profiles
    const profileArb = fc.constantFrom(...profiles);

    fc.assert(
      fc.property(profileArb, (profile) => {
        // target: non-empty string
        expect(profile).toHaveProperty("target");
        expect(typeof profile.target).toBe("string");
        expect((profile.target as string).length).toBeGreaterThan(0);

        // accelerator: one of "gpu", "cpu", "npu"
        expect(profile).toHaveProperty("accelerator");
        expect(typeof profile.accelerator).toBe("string");
        expect(VALID_ACCELERATORS.has(profile.accelerator as string)).toBe(true);

        // execution_providers: non-empty array of strings
        expect(profile).toHaveProperty("execution_providers");
        expect(Array.isArray(profile.execution_providers)).toBe(true);
        const eps = profile.execution_providers as unknown[];
        expect(eps.length).toBeGreaterThan(0);
        for (const ep of eps) {
          expect(typeof ep).toBe("string");
          expect((ep as string).length).toBeGreaterThan(0);
        }

        // recommended_passes: non-empty array of strings
        expect(profile).toHaveProperty("recommended_passes");
        expect(Array.isArray(profile.recommended_passes)).toBe(true);
        const passes = profile.recommended_passes as unknown[];
        expect(passes.length).toBeGreaterThan(0);
        for (const pass of passes) {
          expect(typeof pass).toBe("string");
          expect((pass as string).length).toBeGreaterThan(0);
        }

        // typical_speedup: non-empty string
        expect(profile).toHaveProperty("typical_speedup");
        expect(typeof profile.typical_speedup).toBe("string");
        expect((profile.typical_speedup as string).length).toBeGreaterThan(0);

        // calibration_size: positive number
        expect(profile).toHaveProperty("calibration_size");
        expect(typeof profile.calibration_size).toBe("number");
        expect(profile.calibration_size as number).toBeGreaterThan(0);

        // optimal_batch_size: positive number
        expect(profile).toHaveProperty("optimal_batch_size");
        expect(typeof profile.optimal_batch_size).toBe("number");
        expect(profile.optimal_batch_size as number).toBeGreaterThan(0);

        // memory_gb: positive number
        expect(profile).toHaveProperty("memory_gb");
        expect(typeof profile.memory_gb).toBe("number");
        expect(profile.memory_gb as number).toBeGreaterThan(0);

        // ops_supported: non-empty array of strings
        expect(profile).toHaveProperty("ops_supported");
        expect(Array.isArray(profile.ops_supported)).toBe(true);
        const ops = profile.ops_supported as unknown[];
        expect(ops.length).toBeGreaterThan(0);
        for (const op of ops) {
          expect(typeof op).toBe("string");
          expect((op as string).length).toBeGreaterThan(0);
        }

        // known_issues: non-empty array of strings
        expect(profile).toHaveProperty("known_issues");
        expect(Array.isArray(profile.known_issues)).toBe(true);
        const issues = profile.known_issues as unknown[];
        expect(issues.length).toBeGreaterThan(0);
        for (const issue of issues) {
          expect(typeof issue).toBe("string");
          expect((issue as string).length).toBeGreaterThan(0);
        }

        // notes: non-empty string
        expect(profile).toHaveProperty("notes");
        expect(typeof profile.notes).toBe("string");
        expect((profile.notes as string).length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });
});
