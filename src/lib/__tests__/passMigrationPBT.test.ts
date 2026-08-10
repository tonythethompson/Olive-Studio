/**
 * Property-based tests for pass migration (Tasks 10.3–10.7).
 * Validates correctness properties from design.md (Properties 1-5).
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  applyMigrations,
  PASS_NAME_MIGRATIONS,
  PARAM_MIGRATIONS,
  type ParamMigration,
} from "@/lib/passMigration";
import { createDefaultPipelineState } from "@/lib/stores/pipelineStore";
import { commitUiStateUpdate } from "@/lib/pipelineValidation";
import { buildOliveRecipe } from "@/lib/oliveRecipeBuilder";
import type { UIState } from "@/types";

// ─── Arbitraries ──────────────────────────────────────────────

const PASS_CATALOG_NAMES_012 = [
  "OnnxConversion",
  "OnnxQuantization",
  "OrtTransformersOptimization",
  "OnnxFloatToFloat16",
  "OrtPerfTuning",
  "MobiusModelBuilder", // renamed in 0.13.0
  "QairtPreparation", // removed in 0.13.0
  "QairtGenAIBuilder", // removed in 0.13.0
  "AutoAWQQuantizer",
  "IncBitsAndBytesNF4Quantization",
  "GptqQuantizer",
  "Rtn",
] as const;

const PASS_CATALOG_NAMES_013 = [
  "OnnxConversion",
  "OnnxQuantization",
  "OrtTransformersOptimization",
  "OnnxFloatToFloat16",
  "OrtPerfTuning",
  "MobiusBuilder",
  "QairtPipeline",
  "KQuant",
  "OnnxKquantQuantization",
  "QuantizeEmbeddingInt8",
  "ShareEmbeddingLmHead",
  "SimplifiedLayerNormToRMSNorm",
  "OnnxDiscrepancyCheck",
  "AutoAWQQuantizer",
  "IncBitsAndBytesNF4Quantization",
  "GptqQuantizer",
  "Rtn",
] as const;

/** Generate a UIState with random passRecipeOverrides from the 0.12.x catalog. */
function arbOldState(): fc.Arbitrary<UIState> {
  return fc
    .record({
      passNames: fc.subarray([...PASS_CATALOG_NAMES_012], { minLength: 0, maxLength: 5 }),
      params: fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.jsonValue()),
    })
    .map(({ passNames, params }) => {
      const overrides: Record<string, Record<string, unknown>> = {};
      for (const name of passNames) {
        overrides[name] = { ...params };
      }
      const base = createDefaultPipelineState();
      return {
        ...base,
        passRecipeOverrides: Object.keys(overrides).length > 0 ? overrides : undefined,
      } as UIState;
    });
}

/** Generate a UIState with passes from the 0.13.0 catalog (no deprecated passes). */
function arbNewState(): fc.Arbitrary<UIState> {
  return fc
    .record({
      passNames: fc.subarray([...PASS_CATALOG_NAMES_013], { minLength: 0, maxLength: 5 }),
      params: fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.jsonValue()),
    })
    .map(({ passNames, params }) => {
      const overrides: Record<string, Record<string, unknown>> = {};
      for (const name of passNames) {
        overrides[name] = { ...params };
      }
      const base = createDefaultPipelineState();
      return {
        ...base,
        passRecipeOverrides: Object.keys(overrides).length > 0 ? overrides : undefined,
      } as UIState;
    });
}

// ─── Property Tests ───────────────────────────────────────────

describe("passMigrationPBT", () => {
  // ─── Property 1: Migration produces valid UIState (Task 10.3) ─────
  it("Property 1: Migration output has no deprecated pass names in overrides", () => {
    const deprecatedNames = new Set(PASS_NAME_MIGRATIONS.map((m) => m.oldName));

    fc.assert(
      fc.property(arbOldState(), (state) => {
        const result = applyMigrations(state);
        const overrideKeys = Object.keys(result.state.passRecipeOverrides ?? {});
        // No deprecated pass name should remain.
        for (const key of overrideKeys) {
          expect(deprecatedNames.has(key)).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  // ─── Property 2: Migration idempotence (Task 10.4) ────────────────
  it("Property 2: Applying migration twice yields the same result", () => {
    fc.assert(
      fc.property(arbOldState(), (state) => {
        const first = applyMigrations(state);
        const second = applyMigrations(first.state);
        expect(second.state).toEqual(first.state);
        expect(second.renamedPasses.length).toBe(0);
        expect(second.removedPasses.length).toBe(0);
        expect(second.migratedParams).toBe(0);
        expect(second.discardedParams).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  // ─── Property 3: Renamed parameter value preservation (Task 10.5) ──
  it("Property 3: Synthetic param migration preserves values under new key", () => {
    // Since PARAM_MIGRATIONS is empty for 0.13.0, we test the infrastructure
    // by temporarily injecting a synthetic migration.
    const originalMigrations = [...PARAM_MIGRATIONS];

    const syntheticMigration: ParamMigration = {
      passType: "OnnxConversion",
      oldParam: "legacyParam",
      newParam: "modernParam",
      since: "0.13.0",
    };

    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        // Inject synthetic migration.
        PARAM_MIGRATIONS.length = 0;
        PARAM_MIGRATIONS.push(syntheticMigration);

        try {
          const state = createDefaultPipelineState();
          state.passRecipeOverrides = {
            OnnxConversion: { legacyParam: value, otherParam: "keep" } as UIState["passRecipeOverrides"] extends Record<string, infer V> ? V : never,
          };

          const result = applyMigrations(state);
          const overrides = result.state.passRecipeOverrides as Record<string, Record<string, unknown>> | undefined;

          expect(overrides?.OnnxConversion).toBeDefined();
          expect(overrides!.OnnxConversion.modernParam).toEqual(value);
          expect("legacyParam" in overrides!.OnnxConversion).toBe(false);
          expect(overrides!.OnnxConversion.otherParam).toBe("keep");
          expect(result.migratedParams).toBe(1);
        } finally {
          // Restore original.
          PARAM_MIGRATIONS.length = 0;
          PARAM_MIGRATIONS.push(...originalMigrations);
        }
      }),
      { numRuns: 100 },
    );
  });

  // ─── Property 4: Removed pass exclusion and counting (Task 10.6) ───
  it("Property 4: Removed passes are excluded and counted", () => {
    const removedMigrations = PASS_NAME_MIGRATIONS.filter((m) => m.newName === null);
    const removedNames = removedMigrations.map((m) => m.oldName);

    fc.assert(
      fc.property(
        fc.subarray(removedNames, { minLength: 1 }),
        fc.subarray([...PASS_CATALOG_NAMES_013], { minLength: 0, maxLength: 3 }),
        (includedRemoved, validPasses) => {
          const overrides: Record<string, Record<string, unknown>> = {};
          for (const name of includedRemoved) {
            overrides[name] = { enabled: true };
          }
          for (const name of validPasses) {
            overrides[name] = { config: "value" };
          }

          const state: UIState = {
            ...createDefaultPipelineState(),
            passRecipeOverrides: overrides,
          } as UIState;

          const result = applyMigrations(state);

          // Removed passes should be in result.removedPasses.
          for (const name of includedRemoved) {
            expect(result.removedPasses).toContain(name);
          }

          // Removed passes should NOT be in output state overrides.
          const outputKeys = Object.keys(result.state.passRecipeOverrides ?? {});
          for (const name of includedRemoved) {
            expect(outputKeys).not.toContain(name);
          }

          // Valid passes should still be present.
          for (const name of validPasses) {
            expect(outputKeys).toContain(name);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // ─── Property 5: Recipe schema validity after full pipeline (Task 10.7) ──
  it("Property 5: buildOliveRecipe succeeds on migrated + coerced state", () => {
    fc.assert(
      fc.property(arbNewState(), (state) => {
        const { state: migrated } = applyMigrations(state);
        const coerced = commitUiStateUpdate(migrated, {});
        const recipe = buildOliveRecipe(coerced);
        // Recipe should be a non-null object with passes and input_model.
        expect(recipe).toBeDefined();
        expect(typeof recipe).toBe("object");
        expect(recipe).toHaveProperty("passes");
        expect(recipe).toHaveProperty("input_model");
      }),
      { numRuns: 100 },
    );
  });
});
