/**
 * Property-based tests for workspace fingerprint determinism and staleness (Task 1.3).
 * Validates correctness properties from design.md (Properties 5–6).
 *
 * Feature: v05-release, Property 5: Fingerprint Determinism and Transient Exclusion
 * Feature: v05-release, Property 6: Fingerprint Staleness Consistency
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  computeFingerprint,
  _serializeForFingerprint,
} from "@/lib/workspaceFingerprint";
import { FINGERPRINT_EXCLUDED_KEYS, type ReviewResult } from "@/lib/types/findingTypes";
import { createDefaultPipelineState } from "@/lib/stores/pipelineStore";
import type { UIState } from "@/types";

// ─── Constants ───────────────────────────────────────────────────────────────

const VALID_IHV_PROVIDERS = [
  "CPUExecutionProvider",
  "CUDAExecutionProvider",
  "TensorrtExecutionProvider",
  "NvTensorRTRTXExecutionProvider",
  "DmlExecutionProvider",
  "OpenVINOExecutionProvider",
  "QNNExecutionProvider",
  "ROCMExecutionProvider",
  "WebGpuExecutionProvider",
] as const;

const VALID_MODEL_SOURCES = ["huggingface", "local", "azure"] as const;
const VALID_CUDA_VERSIONS = ["auto", "cpu", "cu118", "cu121", "cu124", "cu126", "cu128", "cu130", "cu132"] as const;
const VALID_OPENVINO_TARGETS = ["CPU", "GPU", "NPU"] as const;
const VALID_MEMORY_OFFLOADS = ["gpu_only", "auto"] as const;
const VALID_QUANT_METHODS = ["ptq", "awq", "qat", "gptq", "hqq", "rtn", "kquant", "spinquant", "quarot"] as const;
const VALID_QUANT_PRECISIONS = ["int4", "int8", "fp16"] as const;
const VALID_PRUNING_TYPES = ["structured", "unstructured"] as const;
const VALID_PRUNING_METHODS = ["magnitude", "sparsegpt", "wanda"] as const;
const VALID_PRUNING_CRITERIA = ["l1_norm", "l2_norm"] as const;
const VALID_PEFT_METHODS = ["lora", "qlora"] as const;
const VALID_CONVERSION_FORMATS = ["onnx", "openvino", "qnn", "tensorrt"] as const;
const VALID_CONVERSION_SOURCE_FORMATS = ["pytorch", "tensorflow", "jax"] as const;

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Generate random UIState passes object with realistic values. */
function arbPasses() {
  return fc.record({
    conversion: fc.boolean(),
    conversionSourceFormat: fc.constantFrom(...VALID_CONVERSION_SOURCE_FORMATS),
    conversionFormat: fc.constantFrom(...VALID_CONVERSION_FORMATS),
    conversionOpset: fc.integer({ min: 11, max: 21 }),
    conversionInputTargetTypes: fc.string({ minLength: 0, maxLength: 30 }),
    quantization: fc.boolean(),
    quantMethod: fc.constantFrom(...VALID_QUANT_METHODS),
    quantPrecision: fc.constantFrom(...VALID_QUANT_PRECISIONS),
    gptqBlockSize: fc.constantFrom(32, 64, 128),
    gptqDescAct: fc.boolean(),
    gptqGroupSize: fc.constantFrom(32, 64, 128),
    awqGroupSize: fc.constantFrom(32, 64, 128),
    awqDampPercent: fc.double({ min: 0.001, max: 0.1, noNaN: true }),
    awqSym: fc.boolean(),
    qatQuantPrecision: fc.constantFrom("int4", "int8") as fc.Arbitrary<"int4" | "int8">,
    qatCalibrateMethod: fc.constantFrom("minmax", "percentile", "entropy") as fc.Arbitrary<"minmax" | "percentile" | "entropy">,
    qatCalibrateSteps: fc.integer({ min: 1, max: 1000 }),
    quantPreset: fc.string({ minLength: 0, maxLength: 30 }),
    pruning: fc.boolean(),
    pruningSparsity: fc.double({ min: 0, max: 1, noNaN: true }),
    pruningType: fc.constantFrom(...VALID_PRUNING_TYPES),
    pruningMethod: fc.constantFrom(...VALID_PRUNING_METHODS),
    pruningCriteria: fc.constantFrom(...VALID_PRUNING_CRITERIA),
    splitting: fc.boolean(),
    onnxTransforms: fc.boolean(),
    peft: fc.boolean(),
    peftMethod: fc.constantFrom(...VALID_PEFT_METHODS),
    diffusionLora: fc.boolean(),
    trustRemoteCode: fc.boolean(),
    mobiusBuilder: fc.boolean(),
    qairtPipeline: fc.boolean(),
    quantizeEmbeddingInt8: fc.boolean(),
    shareEmbeddingLmHead: fc.boolean(),
    simplifiedLayerNormToRMSNorm: fc.boolean(),
    onnxDiscrepancyCheck: fc.boolean(),
  });
}

/** Generate a realistic UIState (non-transient fields vary). */
function arbUIState(): fc.Arbitrary<UIState> {
  return arbPasses().chain((passes) =>
    fc.record({
      modelSource: fc.constantFrom(...VALID_MODEL_SOURCES),
      localFiles: fc.array(
        fc.record({
          name: fc.string({ minLength: 1, maxLength: 50 }),
          size: fc.nat({ max: 1_000_000_000 }),
        }),
        { minLength: 0, maxLength: 5 },
      ),
      azureModelPath: fc.string({ minLength: 0, maxLength: 100 }),
      hfModelId: fc.string({ minLength: 0, maxLength: 100 }),
      hfDataset: fc.string({ minLength: 0, maxLength: 100 }),
      ihvProvider: fc.constantFrom(...VALID_IHV_PROVIDERS),
      openvinoTargetDevice: fc.constantFrom(...VALID_OPENVINO_TARGETS),
      memoryOffload: fc.constantFrom(...VALID_MEMORY_OFFLOADS),
      cudaVersion: fc.constantFrom(...VALID_CUDA_VERSIONS),
      cacheDir: fc.string({ minLength: 0, maxLength: 100 }),
      azureStr: fc.string({ minLength: 0, maxLength: 100 }),
      distributedCaching: fc.boolean(),
      activeJobId: fc.option(fc.uuid(), { nil: null }),
      passes: fc.constant(passes),
    }) as fc.Arbitrary<UIState>,
  );
}

/**
 * Generate a pair of UIState objects that are deeply equal in recipe-relevant
 * state but differ only in transient fields (activeJobId, localFiles metadata/paths).
 */
function arbUIStatePairDifferingOnlyInTransient(): fc.Arbitrary<[UIState, UIState]> {
  return arbUIState().chain((baseState) =>
    fc
      .tuple(
        fc.option(fc.uuid(), { nil: null }),
        fc.array(
          fc.record({
            size: fc.integer({ min: 1, max: 100000 }),
          }),
          {
            minLength: baseState.localFiles?.length ?? 0,
            maxLength: baseState.localFiles?.length ?? 0,
          },
        ),
      )
      .map(([altJobId, altFileMeta]) => {
        const state1: UIState = { ...baseState };
        const state2: UIState = {
          ...baseState,
          activeJobId: altJobId,
          localFiles: baseState.localFiles?.map((file, i) => ({
            ...file,
            size: altFileMeta[i]?.size ?? file.size,
          })),
        };
        return [state1, state2] as [UIState, UIState];
      }),
  );
}

/**
 * Generate a pair of UIState objects guaranteed to differ in at least one
 * non-transient field.
 */
function arbUIStatePairDifferingInNonTransient(): fc.Arbitrary<[UIState, UIState]> {
  return fc.tuple(arbUIState(), arbUIState()).filter(([a, b]) => {
    // Verify they actually differ in non-transient fields via serialization
    const serA = _serializeForFingerprint(a);
    const serB = _serializeForFingerprint(b);
    return serA !== serB;
  });
}

// ─── Staleness Helper ────────────────────────────────────────────────────────

/**
 * Simulates the staleness detection logic from the design:
 * - If result fingerprint !== current fingerprint → stale (discard/mark)
 * - If result fingerprint === current fingerprint → findings are fresh
 */
function isFindingsStale(
  reviewFingerprint: string,
  currentFingerprint: string,
): boolean {
  return reviewFingerprint !== currentFingerprint;
}

// ─── Property 5: Fingerprint Determinism and Transient Exclusion ─────────────

describe("Property 5: Fingerprint Determinism and Transient Exclusion", () => {
  /**
   * Feature: v05-release, Property 5: Fingerprint Determinism and Transient Exclusion
   *
   * For any two UIState objects that are deeply equal after excluding transient
   * fields (activeJobId, localFiles), the computed workspace fingerprint must be
   * byte-identical. Conversely, for any two UIState objects that differ only in
   * transient fields, the fingerprints must still be identical.
   *
   * Validates: Requirements 3.1, 3.5
   */

  it("same UIState always produces the same fingerprint (idempotency)", { timeout: 15000 }, async () => {
    await fc.assert(
      fc.asyncProperty(arbUIState(), async (state) => {
        const fp1 = await computeFingerprint(state);
        const fp2 = await computeFingerprint(state);
        expect(fp1).toBe(fp2);
      }),
      { numRuns: 100 },
    );
  });

  it("fingerprint is a 64-character lowercase hex string", async () => {
    await fc.assert(
      fc.asyncProperty(arbUIState(), async (state) => {
        const fp = await computeFingerprint(state);
        expect(fp).toMatch(/^[0-9a-f]{64}$/);
      }),
      { numRuns: 100 },
    );
  });

  it("states differing only in transient fields produce identical fingerprints", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUIStatePairDifferingOnlyInTransient(),
        async ([state1, state2]) => {
          const fp1 = await computeFingerprint(state1);
          const fp2 = await computeFingerprint(state2);
          expect(fp1).toBe(fp2);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("serialization excludes exactly the FINGERPRINT_EXCLUDED_KEYS", () => {
    fc.assert(
      fc.property(arbUIState(), (state) => {
        const serialized = _serializeForFingerprint(state);
        const parsed = JSON.parse(serialized) as Record<string, unknown>;

        // None of the excluded keys should appear in the serialized output
        for (const excludedKey of FINGERPRINT_EXCLUDED_KEYS) {
          expect(parsed).not.toHaveProperty(excludedKey);
        }

        // All non-excluded keys present in state should appear
        for (const key of Object.keys(state)) {
          if (
            !FINGERPRINT_EXCLUDED_KEYS.includes(key as keyof UIState) &&
            (state as unknown as Record<string, unknown>)[key] !== undefined
          ) {
            expect(parsed).toHaveProperty(key);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("deeply-equal states (after transient exclusion) produce byte-identical fingerprints", async () => {
    await fc.assert(
      fc.asyncProperty(arbUIState(), async (state) => {
        // Create a deep clone of the state (same non-transient content)
        const clone: UIState = JSON.parse(JSON.stringify(state));
        // Set different transient values to ensure exclusion works
        clone.activeJobId = state.activeJobId === "test-id" ? null : "test-id";

        const fp1 = await computeFingerprint(state);
        const fp2 = await computeFingerprint(clone);
        expect(fp1).toBe(fp2);
      }),
      { numRuns: 100 },
    );
  });

  it("serialization is deterministic: object key order does not affect output", () => {
    fc.assert(
      fc.property(arbUIState(), (state) => {
        // Create a version with keys in reverse order
        const keys = Object.keys(state);
        const reversed: Record<string, unknown> = {};
        for (let i = keys.length - 1; i >= 0; i--) {
          reversed[keys[i]] = (state as unknown as Record<string, unknown>)[keys[i]];
        }

        const ser1 = _serializeForFingerprint(state);
        const ser2 = _serializeForFingerprint(reversed as unknown as UIState);
        expect(ser1).toBe(ser2);
      }),
      { numRuns: 100 },
    );
  });

  it("the default pipeline state produces a consistent fingerprint", async () => {
    const state1 = createDefaultPipelineState();
    const state2 = createDefaultPipelineState();
    const fp1 = await computeFingerprint(state1);
    const fp2 = await computeFingerprint(state2);
    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ─── Property 6: Fingerprint Staleness Consistency ───────────────────────────

describe("Property 6: Fingerprint Staleness Consistency", () => {
  /**
   * Feature: v05-release, Property 6: Fingerprint Staleness Consistency
   *
   * For any review result whose attached fingerprint does not match the current
   * workspace fingerprint, those findings must be discarded or marked stale.
   * For any UIState update that produces the same fingerprint as before (no-op
   * patch), existing findings must remain unmarked. For any UIState update that
   * produces a different fingerprint, all existing findings must be marked stale.
   *
   * Validates: Requirements 3.3, 3.4, 3.7
   */

  it("mismatched fingerprint marks findings as stale", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUIStatePairDifferingInNonTransient(),
        async ([stateAtReview, currentState]) => {
          const reviewFingerprint = await computeFingerprint(stateAtReview);
          const currentFingerprint = await computeFingerprint(currentState);

          // Since states differ in non-transient fields, fingerprints must differ
          expect(reviewFingerprint).not.toBe(currentFingerprint);

          // Staleness detection: findings are stale when fingerprints mismatch
          expect(isFindingsStale(reviewFingerprint, currentFingerprint)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("same fingerprint retains findings as fresh (no-op patch)", async () => {
    await fc.assert(
      fc.asyncProperty(arbUIState(), async (state) => {
        const fingerprint = await computeFingerprint(state);

        // Simulate a no-op patch: compute fingerprint again on the same state
        const afterPatchFingerprint = await computeFingerprint(state);

        // Fingerprints match → findings remain valid
        expect(isFindingsStale(fingerprint, afterPatchFingerprint)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("transient-only change retains findings as fresh", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUIStatePairDifferingOnlyInTransient(),
        async ([stateBefore, stateAfter]) => {
          const fpBefore = await computeFingerprint(stateBefore);
          const fpAfter = await computeFingerprint(stateAfter);

          // Transient-only changes should not invalidate findings
          expect(isFindingsStale(fpBefore, fpAfter)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("non-transient state change invalidates all existing findings", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUIStatePairDifferingInNonTransient(),
        async ([stateBefore, stateAfter]) => {
          const fpAtReview = await computeFingerprint(stateBefore);
          const fpCurrent = await computeFingerprint(stateAfter);

          // States differ in non-transient fields → fingerprints differ
          expect(fpAtReview).not.toBe(fpCurrent);

          // All findings from the review must be marked stale
          expect(isFindingsStale(fpAtReview, fpCurrent)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("review result with matching fingerprint is not discarded", async () => {
    await fc.assert(
      fc.asyncProperty(arbUIState(), async (state) => {
        const currentFp = await computeFingerprint(state);

        // Simulate a review result that was computed on the same state
        const reviewResult: ReviewResult = {
          findings: [],
          score: 85,
          level: "Optimized",
          summary: "Test review",
          fingerprint: currentFp,
          timestamp: new Date().toISOString(),
        };

        // Result is fresh — should NOT be discarded
        expect(isFindingsStale(reviewResult.fingerprint, currentFp)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("review result with stale fingerprint must be discarded", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUIStatePairDifferingInNonTransient(),
        async ([stateAtReview, currentState]) => {
          const reviewFp = await computeFingerprint(stateAtReview);
          const currentFp = await computeFingerprint(currentState);

          const reviewResult: ReviewResult = {
            findings: [
              {
                id: "test-finding-1",
                title: "Test",
                description: "A test finding",
                severity: "warning",
                evidence: "test evidence",
                actions: [
                  { kind: "explain", label: "Learn more", payload: { body: "explanation" } },
                ],
              },
            ],
            score: 60,
            level: "Suboptimal",
            summary: "Stale review",
            fingerprint: reviewFp,
            timestamp: new Date().toISOString(),
          };

          // Result from a different pipeline state must be stale
          expect(isFindingsStale(reviewResult.fingerprint, currentFp)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("fingerprint changes iff non-transient state changes", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbUIState(),
        fc.constantFrom(...VALID_IHV_PROVIDERS),
        async (state, altProvider) => {
          const fpBefore = await computeFingerprint(state);

          // Create a state with a different non-transient field
          const modifiedState: UIState = {
            ...state,
            ihvProvider: altProvider,
          };

          const fpAfter = await computeFingerprint(modifiedState);

          if (state.ihvProvider === altProvider) {
            // No actual change → fingerprint unchanged
            expect(fpBefore).toBe(fpAfter);
          } else {
            // Real change → fingerprint must differ
            expect(fpBefore).not.toBe(fpAfter);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
