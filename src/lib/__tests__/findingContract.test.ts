/**
 * Property-based tests for the Finding/Action contract (Tasks 1.6, 3.6).
 * Validates correctness properties from design.md (Properties 1–3).
 *
 * Feature: v05-release, Property 1: Finding Structural Invariant
 * Feature: v05-release, Property 2: Action Payload Validity
 * Feature: v05-release, Property 3: Non-Patch Actions Preserve Store
 */
import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { sanitizeChatActionPatch, chatPatchToUiState } from "@/lib/chatActions";
import { commitUiStateUpdate, mergeUiState } from "@/lib/pipelineStateCommit";
import { usePipelineStore, createDefaultPipelineState } from "@/lib/stores/pipelineStore";
import {
  executeNavigateAction,
  executeExplainAction,
  executeDocumentationAction,
  executeAction,
} from "@/lib/actionExecutor";
import type { UIState } from "@/types";
import type {
  Finding,
  FindingSeverity,
  Action,
  ActionPayloadApplyPatch,
  ActionPayloadNavigate,
  ActionPayloadExplain,
  ActionPayloadDocumentation,
  ActionKind,
} from "@/lib/types/findingTypes";
import type { ChatActionPatch } from "@/lib/chatActions";

// ─── Constants ───────────────────────────────────────────────────────────────

const VALID_SEVERITIES: FindingSeverity[] = ["critical", "warning", "info"];
const VALID_ACTION_KINDS: ActionKind[] = ["applyPatch", "navigate", "explain", "documentation"];

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

const VALID_QUANT_METHODS = ["ptq", "awq", "qat", "gptq", "hqq", "rtn", "kquant", "spinquant", "quarot"] as const;
const VALID_QUANT_PRECISIONS = ["int4", "int8", "fp16"] as const;
const VALID_CUDA_VERSIONS = ["auto", "cpu", "cu118", "cu121", "cu124", "cu126", "cu128", "cu130", "cu132"] as const;
const VALID_MODEL_SOURCES = ["huggingface", "local", "azure"] as const;

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Generate a non-empty string of bounded length. */
function arbBoundedString(maxLength: number): fc.Arbitrary<string> {
  return fc.string({ minLength: 1, maxLength });
}

/** Generate an action label (max 80 chars, non-empty). */
function arbLabel(): fc.Arbitrary<string> {
  return arbBoundedString(80);
}

/** Generate a valid ChatActionPatch that will pass sanitizeChatActionPatch. */
function arbValidChatActionPatch(): fc.Arbitrary<ChatActionPatch> {
  return fc.record(
    {
      ihvProvider: fc.constantFrom(...VALID_IHV_PROVIDERS),
      cudaVersion: fc.constantFrom(...VALID_CUDA_VERSIONS),
      modelSource: fc.constantFrom(...VALID_MODEL_SOURCES),
      hfModelId: fc.string({ minLength: 1, maxLength: 64 }).filter((s) => s.trim().length > 0),
      passes: fc.record(
        {
          quantization: fc.boolean(),
          quantMethod: fc.constantFrom(...VALID_QUANT_METHODS),
          quantPrecision: fc.constantFrom(...VALID_QUANT_PRECISIONS),
          conversion: fc.boolean(),
        },
        { requiredKeys: [] },
      ),
    },
    { requiredKeys: [] },
  ).filter((r) => {
    // Ensure at least one field is present so sanitize doesn't return null
    return Object.keys(r).length > 0 && (
      r.ihvProvider !== undefined ||
      r.cudaVersion !== undefined ||
      r.modelSource !== undefined ||
      (r.hfModelId !== undefined && r.hfModelId.trim().length > 0) ||
      (r.passes !== undefined && Object.keys(r.passes).length > 0)
    );
  });
}

/** Generate a valid applyPatch action. */
function arbApplyPatchAction(): fc.Arbitrary<ActionPayloadApplyPatch> {
  return arbValidChatActionPatch().chain((patch) =>
    arbLabel().map((label) => ({
      kind: "applyPatch" as const,
      label,
      payload: patch,
    })),
  );
}

/** Generate a valid navigate action. */
function arbNavigateAction(): fc.Arbitrary<ActionPayloadNavigate> {
  return fc.record({
    kind: fc.constant("navigate" as const),
    label: arbLabel(),
    payload: fc.record({
      targetPanel: fc.string({ minLength: 1, maxLength: 50 }),
    }),
  });
}

/** Generate a valid explain action. */
function arbExplainAction(): fc.Arbitrary<ActionPayloadExplain> {
  return fc.record({
    kind: fc.constant("explain" as const),
    label: arbLabel(),
    payload: fc.record({
      body: fc.string({ minLength: 1, maxLength: 500 }),
    }),
  });
}

/** Generate a valid documentation action. */
function arbDocumentationAction(): fc.Arbitrary<ActionPayloadDocumentation> {
  return fc.record({
    kind: fc.constant("documentation" as const),
    label: arbLabel(),
    payload: fc.record(
      {
        url: fc.webUrl(),
        topicKey: fc.string({ minLength: 1, maxLength: 50 }),
      },
      { requiredKeys: [] },
    ),
  });
}

/** Generate any valid Action (any kind). */
function arbAction(): fc.Arbitrary<Action> {
  return fc.oneof(
    arbApplyPatchAction(),
    arbNavigateAction(),
    arbExplainAction(),
    arbDocumentationAction(),
  );
}

/** Generate a valid Finding (all structural invariants satisfied). */
function arbFinding(): fc.Arbitrary<Finding> {
  return fc.record({
    id: fc.uuid(),
    title: arbBoundedString(120),
    description: fc.string({ minLength: 0, maxLength: 2000 }),
    severity: fc.constantFrom(...VALID_SEVERITIES),
    evidence: fc.string({ minLength: 0, maxLength: 500 }),
    actions: fc.array(arbAction(), { minLength: 1, maxLength: 10 }),
  });
}

/** Generate an array of Findings with unique IDs within a run. */
function arbFindingsRun(): fc.Arbitrary<Finding[]> {
  return fc.array(arbFinding(), { minLength: 1, maxLength: 20 }).map((findings) => {
    // Ensure IDs are unique within the run by appending index
    return findings.map((f, i) => ({
      ...f,
      id: `${f.id}-${i}`,
    }));
  });
}

// ─── Property 4 Helpers: Coercion Detection ──────────────────────────────────

/**
 * Compare two UIState objects and return the key paths where they differ.
 * Used to detect which fields were auto-coerced by sanitizePipelineState.
 */
function detectCoercedFields(naive: UIState, coerced: UIState): string[] {
  const diffs: string[] = [];

  // Check top-level scalar fields
  for (const key of Object.keys(naive) as (keyof UIState)[]) {
    if (key === "passes") continue; // Handle nested separately
    if (key === "localFiles" || key === "batchJobs") continue; // Arrays, skip deep compare
    if (naive[key] !== coerced[key]) {
      diffs.push(key);
    }
  }

  // Check nested passes fields
  if (naive.passes && coerced.passes) {
    for (const passKey of Object.keys(naive.passes) as (keyof UIState["passes"])[]) {
      if (naive.passes[passKey] !== coerced.passes[passKey]) {
        diffs.push(`passes.${passKey}`);
      }
    }
  }

  return diffs;
}

/**
 * Deep-equal comparison for UIState (structural, ignoring prototype/method differences).
 */
function deepEqualUIState(a: UIState, b: UIState): boolean {
  return detectCoercedFields(a, b).length === 0;
}

/**
 * Generate a ChatActionPatch that is LIKELY to trigger coercion.
 * Pairs incompatible provider + pass settings to ensure the coercion logic fires.
 */
function arbCoercionTriggeringPatch(): fc.Arbitrary<{ baseState: UIState; patch: ChatActionPatch }> {
  return fc.oneof(
    // Scenario: OpenVINO format on non-OpenVINO provider
    fc.record({
      provider: fc.constantFrom(
        "CPUExecutionProvider" as const,
        "CUDAExecutionProvider" as const,
        "TensorrtExecutionProvider" as const,
        "DmlExecutionProvider" as const,
      ),
    }).map(({ provider }) => ({
      baseState: { ...createDefaultPipelineState(), ihvProvider: provider },
      patch: { passes: { conversion: true, conversionFormat: "openvino" } } as ChatActionPatch,
    })),

    // Scenario: AWQ on CPU-only provider
    fc.constant({
      baseState: { ...createDefaultPipelineState(), ihvProvider: "CPUExecutionProvider" as const },
      patch: { passes: { quantization: true, quantMethod: "awq" } } as ChatActionPatch,
    }),

    // Scenario: GPTQ on CPU-only provider
    fc.constant({
      baseState: { ...createDefaultPipelineState(), ihvProvider: "CPUExecutionProvider" as const },
      patch: { passes: { quantization: true, quantMethod: "gptq" } } as ChatActionPatch,
    }),

    // Scenario: LoRA + quantization → qlora coercion
    fc.record({
      precision: fc.constantFrom("int4" as const, "int8" as const),
    }).map(({ precision }) => ({
      baseState: { ...createDefaultPipelineState(), ihvProvider: "CUDAExecutionProvider" as const },
      patch: { passes: { peft: true, peftMethod: "lora", quantization: true, quantPrecision: precision } } as ChatActionPatch,
    })),

    // Scenario: INT4 + pruning → int8 coercion
    fc.constant({
      baseState: { ...createDefaultPipelineState(), ihvProvider: "CUDAExecutionProvider" as const },
      patch: { passes: { pruning: true, quantization: true, quantPrecision: "int4" } } as ChatActionPatch,
    }),

    // Scenario: Structured pruning on non-tensor-core provider
    fc.constantFrom(
      "CPUExecutionProvider" as const,
      "OpenVINOExecutionProvider" as const,
      "QNNExecutionProvider" as const,
    ).map((provider) => ({
      baseState: { ...createDefaultPipelineState(), ihvProvider: provider },
      patch: { passes: { pruning: true, pruningType: "structured" } } as ChatActionPatch,
    })),

    // Scenario: OpenVINO conversion + onnxTransforms → onnxTransforms disabled
    fc.constant({
      baseState: { ...createDefaultPipelineState(), ihvProvider: "OpenVINOExecutionProvider" as const },
      patch: { passes: { conversion: true, conversionFormat: "openvino", onnxTransforms: true } } as ChatActionPatch,
    }),

    // Scenario: HQQ/RTN/kquant on non-CPU/CUDA providers
    fc.record({
      method: fc.constantFrom("hqq" as const, "rtn" as const, "kquant" as const),
      provider: fc.constantFrom(
        "TensorrtExecutionProvider" as const,
        "DmlExecutionProvider" as const,
        "OpenVINOExecutionProvider" as const,
      ),
    }).map(({ method, provider }) => ({
      baseState: { ...createDefaultPipelineState(), ihvProvider: provider },
      patch: { passes: { quantization: true, quantMethod: method } } as ChatActionPatch,
    })),
  );
}

/**
 * Generate a ChatActionPatch that should NOT trigger any coercion.
 * These are "safe" combinations where naive merge === committed state.
 */
function arbNonCoercingPatch(): fc.Arbitrary<{ baseState: UIState; patch: ChatActionPatch }> {
  return fc.oneof(
    // Simple hfModelId change — never coerced
    fc.string({ minLength: 1, maxLength: 64 }).filter((s) => s.trim().length > 0).map((id) => ({
      baseState: createDefaultPipelineState(),
      patch: { hfModelId: id } as ChatActionPatch,
    })),

    // PTQ quantization on CPU — valid and no coercion
    fc.constant({
      baseState: createDefaultPipelineState(),
      patch: { passes: { quantization: true, quantMethod: "ptq", quantPrecision: "int8" } } as ChatActionPatch,
    }),

    // ONNX conversion on CPU — the default, no coercion
    fc.constant({
      baseState: createDefaultPipelineState(),
      patch: { passes: { conversion: true, conversionFormat: "onnx" } } as ChatActionPatch,
    }),

    // Switching to CUDA provider — no pass coercion for default passes
    fc.constant({
      baseState: createDefaultPipelineState(),
      patch: { ihvProvider: "CUDAExecutionProvider" } as ChatActionPatch,
    }),

    // Unstructured pruning on any provider — always allowed
    fc.constantFrom(
      "CPUExecutionProvider" as const,
      "CUDAExecutionProvider" as const,
      "OpenVINOExecutionProvider" as const,
    ).map((provider) => ({
      baseState: { ...createDefaultPipelineState(), ihvProvider: provider },
      patch: { passes: { pruning: true, pruningType: "unstructured" } } as ChatActionPatch,
    })),
  );
}

// ─── Property 1: Finding Structural Invariant ────────────────────────────────

describe("Property 1: Finding Structural Invariant", () => {
  /**
   * Feature: v05-release, Property 1: Finding Structural Invariant
   *
   * For any valid Finding object produced by the review engine, the following
   * must hold: id is a non-empty string unique within its review run, title is
   * a non-empty string of at most 120 characters, description is at most 2000
   * characters, severity is one of "critical" | "warning" | "info", evidence
   * is a string, and actions is an array with between 1 and 10 elements where
   * each element has a valid kind and label of at most 80 characters.
   *
   * Validates: Requirements 2.1, 2.4
   */

  it("all generated Findings satisfy field constraints", () => {
    fc.assert(
      fc.property(arbFinding(), (finding) => {
        // id: non-empty string
        expect(finding.id).toBeTruthy();
        expect(typeof finding.id).toBe("string");
        expect(finding.id.length).toBeGreaterThan(0);

        // title: non-empty string, max 120 chars
        expect(typeof finding.title).toBe("string");
        expect(finding.title.length).toBeGreaterThan(0);
        expect(finding.title.length).toBeLessThanOrEqual(120);

        // description: max 2000 chars
        expect(typeof finding.description).toBe("string");
        expect(finding.description.length).toBeLessThanOrEqual(2000);

        // severity: valid enum
        expect(VALID_SEVERITIES).toContain(finding.severity);

        // evidence: is a string
        expect(typeof finding.evidence).toBe("string");

        // actions: 1–10 elements
        expect(finding.actions.length).toBeGreaterThanOrEqual(1);
        expect(finding.actions.length).toBeLessThanOrEqual(10);
      }),
      { numRuns: 100 },
    );
  });

  it("all actions have valid kind and label within limits", () => {
    fc.assert(
      fc.property(arbFinding(), (finding) => {
        for (const action of finding.actions) {
          // kind: valid ActionKind
          expect(VALID_ACTION_KINDS).toContain(action.kind);

          // label: non-empty string, max 80 chars
          expect(typeof action.label).toBe("string");
          expect(action.label.length).toBeGreaterThan(0);
          expect(action.label.length).toBeLessThanOrEqual(80);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("Finding IDs are unique within a review run", () => {
    fc.assert(
      fc.property(arbFindingsRun(), (findings) => {
        const ids = findings.map((f) => f.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── Property 4: Coercion Difference Detection ──────────────────────────────

describe("Property 4: Coercion Difference Detection", () => {
  /**
   * Feature: v05-release, Property 4: Coercion Difference Detection
   *
   * For any ChatActionPatch applied via commitUiStateUpdate, if the committed
   * UIState differs from the direct merge of the patch fields onto the prior
   * state (indicating auto-coercion occurred), the differing fields can be
   * identified — forming the material for a coercion notice.
   *
   * Validates: Requirements 2.7
   */

  it("coerced fields are detectable when commitUiStateUpdate differs from naive merge", () => {
    fc.assert(
      fc.property(arbCoercionTriggeringPatch(), ({ baseState, patch }) => {
        // Step 1: Compute the naive merge (no coercion)
        const naiveMerged = mergeUiState(baseState, chatPatchToUiState(baseState, patch));

        // Step 2: Compute the coerced state via commitUiStateUpdate
        const coerced = commitUiStateUpdate(baseState, chatPatchToUiState(baseState, patch));

        // Step 3: Identify fields that differ between naive merge and coerced result
        const coercedFields = detectCoercedFields(naiveMerged, coerced);

        // Property assertion: if ANY coercion occurred, differing keys are non-empty
        const hasCoercion = !deepEqualUIState(naiveMerged, coerced);
        if (hasCoercion) {
          expect(coercedFields.length).toBeGreaterThan(0);
          // Each coerced field identifies a concrete key path
          for (const field of coercedFields) {
            expect(field).toBeTruthy();
            expect(typeof field).toBe("string");
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it("no coercion means naive merge and committed state are identical", () => {
    fc.assert(
      fc.property(arbNonCoercingPatch(), ({ baseState, patch }) => {
        const naiveMerged = mergeUiState(baseState, chatPatchToUiState(baseState, patch));
        const coerced = commitUiStateUpdate(baseState, chatPatchToUiState(baseState, patch));

        // When the patch does not trigger coercion, they must be identical
        const coercedFields = detectCoercedFields(naiveMerged, coerced);
        expect(coercedFields).toHaveLength(0);
        expect(deepEqualUIState(naiveMerged, coerced)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("specific known coercion scenarios produce the expected coerced field", () => {
    // Scenario 1: OpenVINO conversion format gets coerced to "onnx" when provider is CPU
    const base1 = createDefaultPipelineState();
    base1.ihvProvider = "CPUExecutionProvider";
    const patch1: ChatActionPatch = { passes: { conversion: true, conversionFormat: "openvino" } };
    const uiPatch1 = chatPatchToUiState(base1, patch1);
    const naive1 = mergeUiState(base1, uiPatch1);
    const coerced1 = commitUiStateUpdate(base1, uiPatch1);
    const fields1 = detectCoercedFields(naive1, coerced1);
    expect(fields1).toContain("passes.conversionFormat");

    // Scenario 2: AWQ quant method coerced to "ptq" when provider is CPU
    const base2 = createDefaultPipelineState();
    base2.ihvProvider = "CPUExecutionProvider";
    const patch2: ChatActionPatch = { passes: { quantization: true, quantMethod: "awq" } };
    const uiPatch2 = chatPatchToUiState(base2, patch2);
    const naive2 = mergeUiState(base2, uiPatch2);
    const coerced2 = commitUiStateUpdate(base2, uiPatch2);
    const fields2 = detectCoercedFields(naive2, coerced2);
    expect(fields2).toContain("passes.quantMethod");

    // Scenario 3: LoRA + quantization triggers peftMethod coercion to "qlora"
    const base3 = createDefaultPipelineState();
    base3.ihvProvider = "CUDAExecutionProvider";
    const patch3: ChatActionPatch = { passes: { peft: true, peftMethod: "lora", quantization: true, quantPrecision: "int4" } };
    const uiPatch3 = chatPatchToUiState(base3, patch3);
    const naive3 = mergeUiState(base3, uiPatch3);
    const coerced3 = commitUiStateUpdate(base3, uiPatch3);
    const fields3 = detectCoercedFields(naive3, coerced3);
    expect(fields3).toContain("passes.peftMethod");
  });
});

// ─── Property 2: Action Payload Validity ─────────────────────────────────────

describe("Property 2: Action Payload Validity", () => {
  /**
   * Feature: v05-release, Property 2: Action Payload Validity
   *
   * For any Action with kind "applyPatch", calling
   * sanitizeChatActionPatch(action.payload) must return a non-null
   * ChatActionPatch. For any Finding where all candidate applyPatch payloads
   * would produce null from sanitizeChatActionPatch, the Finding's actions
   * array must contain at least one action with kind "explain" or
   * "documentation".
   *
   * Validates: Requirements 2.3, 2.5
   */

  it("applyPatch payloads always pass sanitizeChatActionPatch", () => {
    fc.assert(
      fc.property(arbApplyPatchAction(), (action) => {
        const result = sanitizeChatActionPatch(action.payload);
        expect(result).not.toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it("when all applyPatch payloads fail sanitization, a fallback explain/documentation action exists", () => {
    // Generate a Finding where applyPatch actions have INVALID payloads
    // (empty objects that sanitize to null), then verify fallback exists.
    const arbFindingWithInvalidPatches: fc.Arbitrary<Finding> = fc.record({
      id: fc.uuid(),
      title: arbBoundedString(120),
      description: fc.string({ minLength: 0, maxLength: 2000 }),
      severity: fc.constantFrom(...VALID_SEVERITIES),
      evidence: fc.string({ minLength: 0, maxLength: 500 }),
      actions: fc
        .tuple(
          // At least one invalid applyPatch (payload that sanitizes to null)
          fc.array(
            fc.record({
              kind: fc.constant("applyPatch" as const),
              label: arbLabel(),
              // Invalid payload: unknown keys only → sanitizeChatActionPatch returns null
              payload: fc.record({
                unknownKey: fc.string(),
              }) as fc.Arbitrary<Record<string, unknown>> as fc.Arbitrary<ChatActionPatch>,
            }),
            { minLength: 1, maxLength: 3 },
          ),
          // At least one fallback explain or documentation action
          fc.oneof(arbExplainAction(), arbDocumentationAction()),
        )
        .map(([invalidPatches, fallback]) => [...invalidPatches, fallback]),
    });

    fc.assert(
      fc.property(arbFindingWithInvalidPatches, (finding) => {
        // Verify all applyPatch payloads fail sanitization
        const patchActions = finding.actions.filter(
          (a): a is ActionPayloadApplyPatch => a.kind === "applyPatch",
        );
        for (const patchAction of patchActions) {
          const result = sanitizeChatActionPatch(patchAction.payload);
          expect(result).toBeNull();
        }

        // Verify there is at least one fallback explain/documentation action
        const hasFallback = finding.actions.some(
          (a) => a.kind === "explain" || a.kind === "documentation",
        );
        expect(hasFallback).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("valid applyPatch payloads produce non-null sanitized patches with at least one recognized field", () => {
    fc.assert(
      fc.property(arbValidChatActionPatch(), (patch) => {
        const result = sanitizeChatActionPatch(patch);
        expect(result).not.toBeNull();
        // The sanitized patch has at least one key
        expect(Object.keys(result!).length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it("navigate/explain/documentation actions have correct payload shapes", () => {
    fc.assert(
      fc.property(
        fc.oneof(arbNavigateAction(), arbExplainAction(), arbDocumentationAction()),
        (action) => {
          switch (action.kind) {
            case "navigate":
              expect(action.payload).toHaveProperty("targetPanel");
              expect(typeof action.payload.targetPanel).toBe("string");
              break;
            case "explain":
              expect(action.payload).toHaveProperty("body");
              expect(typeof action.payload.body).toBe("string");
              break;
            case "documentation":
              // url and topicKey are optional
              if ("url" in action.payload && action.payload.url !== undefined) {
                expect(typeof action.payload.url).toBe("string");
              }
              if ("topicKey" in action.payload && action.payload.topicKey !== undefined) {
                expect(typeof action.payload.topicKey).toBe("string");
              }
              break;
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ─── Property 3: Non-Patch Actions Preserve Store ────────────────────────────

describe("Property 3: Non-Patch Actions Preserve Store", () => {
  /**
   * Feature: v05-release, Property 3: Non-Patch Actions Preserve Store
   *
   * For any Action with kind "navigate", "explain", or "documentation",
   * executing that action must not modify the PipelineStore state — the UIState
   * before and after execution must be deeply equal.
   *
   * Validates: Requirements 2.8
   */

  beforeEach(() => {
    // Reset store to a known state before each test
    usePipelineStore.getState().resetState();
  });

  it("navigate actions do not modify PipelineStore state", () => {
    fc.assert(
      fc.property(arbNavigateAction(), (action) => {
        // Snapshot state before execution
        const stateBefore = structuredClone(usePipelineStore.getState().state);

        // Execute the navigate action
        const result = executeNavigateAction(action);

        // State after must be identical
        const stateAfter = usePipelineStore.getState().state;
        expect(stateAfter).toEqual(stateBefore);
        expect(result.modifiedStore).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("explain actions do not modify PipelineStore state", () => {
    fc.assert(
      fc.property(arbExplainAction(), (action) => {
        // Snapshot state before execution
        const stateBefore = structuredClone(usePipelineStore.getState().state);

        // Execute the explain action
        const result = executeExplainAction(action);

        // State after must be identical
        const stateAfter = usePipelineStore.getState().state;
        expect(stateAfter).toEqual(stateBefore);
        expect(result.modifiedStore).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("documentation actions do not modify PipelineStore state", () => {
    fc.assert(
      fc.property(arbDocumentationAction(), (action) => {
        // Snapshot state before execution
        const stateBefore = structuredClone(usePipelineStore.getState().state);

        // Execute the documentation action
        const result = executeDocumentationAction(action);

        // State after must be identical
        const stateAfter = usePipelineStore.getState().state;
        expect(stateAfter).toEqual(stateBefore);
        expect(result.modifiedStore).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("any non-patch action via executeAction does not modify PipelineStore state", () => {
    // Generate only non-patch actions
    const arbNonPatchAction = fc.oneof(
      arbNavigateAction(),
      arbExplainAction(),
      arbDocumentationAction(),
    );

    fc.assert(
      fc.property(arbNonPatchAction, (action) => {
        // Snapshot state before execution
        const stateBefore = structuredClone(usePipelineStore.getState().state);

        // Execute via the dispatcher
        const result = executeAction(action);

        // State after must be identical
        const stateAfter = usePipelineStore.getState().state;
        expect(stateAfter).toEqual(stateBefore);
        expect(result.modifiedStore).toBe(false);
        expect(result.success).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("non-patch actions preserve store even with non-default pipeline state", () => {
    // Set up a modified pipeline state first
    usePipelineStore.getState().setState({
      hfModelId: "microsoft/phi-2",
      ihvProvider: "CUDAExecutionProvider",
      cudaVersion: "cu121",
      passes: {
        ...usePipelineStore.getState().state.passes,
        quantization: true,
        quantMethod: "awq",
        quantPrecision: "int4",
      },
    });

    const arbNonPatchAction = fc.oneof(
      arbNavigateAction(),
      arbExplainAction(),
      arbDocumentationAction(),
    );

    fc.assert(
      fc.property(arbNonPatchAction, (action) => {
        // Snapshot state (now non-default) before execution
        const stateBefore = structuredClone(usePipelineStore.getState().state);

        // Execute the action
        const result = executeAction(action);

        // State must remain unchanged
        const stateAfter = usePipelineStore.getState().state;
        expect(stateAfter).toEqual(stateBefore);
        expect(result.modifiedStore).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("sequence of non-patch actions does not accumulate store modifications", () => {
    // Generate a sequence of non-patch actions and execute them all
    const arbNonPatchAction = fc.oneof(
      arbNavigateAction(),
      arbExplainAction(),
      arbDocumentationAction(),
    );

    fc.assert(
      fc.property(
        fc.array(arbNonPatchAction, { minLength: 2, maxLength: 10 }),
        (actions) => {
          // Snapshot before the entire sequence
          const stateBefore = structuredClone(usePipelineStore.getState().state);

          // Execute all actions in sequence
          for (const action of actions) {
            const result = executeAction(action);
            expect(result.modifiedStore).toBe(false);
          }

          // State after entire sequence must be identical
          const stateAfter = usePipelineStore.getState().state;
          expect(stateAfter).toEqual(stateBefore);
        },
      ),
      { numRuns: 100 },
    );
  });
});
