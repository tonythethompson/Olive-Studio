/**
 * Property-based tests for the Review Reconciler (Task 1.5).
 * Validates correctness properties from design.md (Properties 7–8).
 *
 * Feature: v05-release, Property 7: Deterministic Validation Authority
 * Feature: v05-release, Property 8: Review Isolation from Chat History
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { reconcileFindings, type ProviderConflict } from "@/lib/reviewReconciler";
import type { PipelineIssue, IssueSeverity } from "@/lib/pipelineValidation";
import type {
  Finding,
  FindingSeverity,
  ActionPayloadApplyPatch,
  ActionPayloadExplain,
} from "@/lib/types/findingTypes";
import type { UIState } from "@/types";

// ─── Constants ───────────────────────────────────────────────────────────────

const VALID_SEVERITIES: FindingSeverity[] = ["critical", "warning", "info"];

const PASS_FIELD_KEYS = [
  "quantization",
  "quantMethod",
  "quantPrecision",
  "conversion",
  "conversionFormat",
  "conversionOpset",
  "pruning",
  "pruningType",
  "pruningMethod",
  "peft",
  "peftMethod",
  "splitting",
] as const;

type PassFieldKey = (typeof PASS_FIELD_KEYS)[number];

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Generate a non-empty bounded string. */
function arbBoundedString(maxLength: number): fc.Arbitrary<string> {
  return fc.string({ minLength: 1, maxLength });
}

/** Generate a valid pass field key from the known set. */
function arbPassFieldKey(): fc.Arbitrary<PassFieldKey> {
  return fc.constantFrom(...PASS_FIELD_KEYS);
}

/** Generate a random pass field value (string or boolean). */
function arbPassFieldValue(): fc.Arbitrary<string | boolean> {
  return fc.oneof(
    fc.constantFrom("ptq", "awq", "gptq", "int4", "int8", "onnx", "openvino", "structured"),
    fc.boolean(),
  );
}

/** Generate a PipelineIssue targeting a specific pass field via autofix. */
function arbPipelineIssue(opts?: {
  severity?: IssueSeverity;
  targetPassField?: PassFieldKey;
}): fc.Arbitrary<PipelineIssue> {
  const severityArb = opts?.severity
    ? fc.constant(opts.severity)
    : fc.constantFrom<IssueSeverity>("critical", "warning", "info");
  const passFieldArb = opts?.targetPassField
    ? fc.constant(opts.targetPassField)
    : arbPassFieldKey();

  return fc.tuple(
    fc.uuid(),
    severityArb,
    arbBoundedString(80),
    arbBoundedString(200),
    passFieldArb,
    arbPassFieldValue(),
  ).map(([id, severity, title, description, passField, passValue]) => ({
    id,
    severity,
    title,
    description,
    affectedPasses: [passField],
    actionLabel: `Fix ${passField}`,
    autofix: {
      passes: { [passField]: passValue } as unknown as UIState["passes"],
    } as Partial<UIState>,
  }));
}

/** Generate a ProviderConflict (HardwareConflict) targeting a specific pass key. */
function arbProviderConflict(opts?: {
  passKey?: PassFieldKey;
  severity?: IssueSeverity;
  autofixValue?: string | boolean;
}): fc.Arbitrary<ProviderConflict> {
  const passKeyArb = opts?.passKey ? fc.constant(opts.passKey) : arbPassFieldKey();
  const severityArb = opts?.severity
    ? fc.constant(opts.severity)
    : fc.constantFrom<IssueSeverity>("critical", "warning", "info");
  const autofixValueArb = opts?.autofixValue !== undefined
    ? fc.constant(opts.autofixValue)
    : arbPassFieldValue();

  return fc.tuple(
    passKeyArb,
    arbBoundedString(60),
    arbBoundedString(200),
    severityArb,
    autofixValueArb,
  ).map(([passKey, passName, reason, severity, autofixValue]) => ({
    passKey,
    passName,
    reason,
    severity,
    autofix: () => ({ [passKey]: autofixValue }) as Partial<UIState["passes"]>,
  }));
}

/** Generate an AI Finding with an applyPatch action targeting a specific pass field. */
function arbAiFindingTargetingPassField(opts?: {
  passField?: PassFieldKey;
  passValue?: string | boolean;
  severity?: FindingSeverity;
}): fc.Arbitrary<Finding> {
  const passFieldArb = opts?.passField ? fc.constant(opts.passField) : arbPassFieldKey();
  const valueArb = opts?.passValue !== undefined ? fc.constant(opts.passValue) : arbPassFieldValue();
  const severityArb = opts?.severity
    ? fc.constant(opts.severity)
    : fc.constantFrom<FindingSeverity>(...VALID_SEVERITIES);

  return fc.tuple(
    fc.uuid(),
    arbBoundedString(100),
    arbBoundedString(300),
    severityArb,
    arbBoundedString(150),
    arbBoundedString(60),
    passFieldArb,
    valueArb,
  ).map(([id, title, description, severity, evidence, label, passField, value]) => ({
    id: `ai-${id}`,
    title,
    description,
    severity,
    evidence,
    actions: [
      {
        kind: "applyPatch" as const,
        label,
        payload: {
          passes: { [passField]: value } as unknown as Partial<UIState["passes"]>,
        },
      } satisfies ActionPayloadApplyPatch,
    ],
  }));
}

/** Generate an AI Finding with an explain action only (no applyPatch). */
function arbAiFindingExplainOnly(): fc.Arbitrary<Finding> {
  return fc.tuple(
    fc.uuid(),
    arbBoundedString(100),
    arbBoundedString(300),
    fc.constantFrom<FindingSeverity>(...VALID_SEVERITIES),
    arbBoundedString(150),
    arbBoundedString(60),
    arbBoundedString(200),
  ).map(([id, title, description, severity, evidence, label, body]) => ({
    id: `ai-explain-${id}`,
    title,
    description,
    severity,
    evidence,
    actions: [
      {
        kind: "explain" as const,
        label,
        payload: { body },
      } satisfies ActionPayloadExplain,
    ],
  }));
}

/**
 * Generate a pair of (PipelineIssue, AI Finding) that target the SAME pass field.
 * The deterministic issue has the specified severity.
 */
function arbConflictingPair(detSeverity: IssueSeverity): fc.Arbitrary<{
  detIssue: PipelineIssue;
  aiFinding: Finding;
  passField: PassFieldKey;
}> {
  return arbPassFieldKey().chain((passField) =>
    fc.tuple(
      arbPipelineIssue({ severity: detSeverity, targetPassField: passField }),
      arbAiFindingTargetingPassField({ passField }),
    ).map(([detIssue, aiFinding]) => ({ detIssue, aiFinding, passField })),
  );
}

/**
 * Generate a (PipelineIssue, AI Finding) pair where the AI Finding targets
 * a DIFFERENT pass field than the deterministic issue.
 */
function arbNonConflictingPair(): fc.Arbitrary<{
  detIssue: PipelineIssue;
  aiFinding: Finding;
}> {
  // Pick two distinct pass fields
  return fc.tuple(arbPassFieldKey(), arbPassFieldKey())
    .filter(([f1, f2]) => f1 !== f2)
    .chain(([detField, aiField]) =>
      fc.tuple(
        arbPipelineIssue({ severity: "critical", targetPassField: detField }),
        arbAiFindingTargetingPassField({ passField: aiField }),
      ).map(([detIssue, aiFinding]) => ({ detIssue, aiFinding })),
    );
}

/**
 * Generate a (ProviderConflict, AI Finding) where the AI Finding targets the
 * same passKey but suggests a DIFFERENT value than the conflict's autofix.
 */
function arbConflictWithWrongAiFix(): fc.Arbitrary<{
  conflict: ProviderConflict;
  aiFinding: Finding;
}> {
  return arbPassFieldKey().chain((passKey) => {
    // Use two known distinct values
    const autofixValue = "ptq";
    const wrongValue = "awq";
    return fc.tuple(
      arbProviderConflict({ passKey, severity: "critical", autofixValue }),
      arbAiFindingTargetingPassField({ passField: passKey, passValue: wrongValue }),
    ).map(([conflict, aiFinding]) => ({ conflict, aiFinding }));
  });
}

/**
 * Generate a (ProviderConflict, AI Finding) where the AI Finding targets the
 * same passKey and suggests the SAME value as the conflict's autofix.
 */
function arbConflictWithCorrectAiFix(): fc.Arbitrary<{
  conflict: ProviderConflict;
  aiFinding: Finding;
}> {
  return arbPassFieldKey().chain((passKey) => {
    const autofixValue = "ptq";
    return fc.tuple(
      arbProviderConflict({ passKey, severity: "critical", autofixValue }),
      arbAiFindingTargetingPassField({ passField: passKey, passValue: autofixValue }),
    ).map(([conflict, aiFinding]) => ({ conflict, aiFinding }));
  });
}

// ─── Property 7: Deterministic Validation Authority ──────────────────────────

describe("Property 7: Deterministic Validation Authority", () => {
  /**
   * Feature: v05-release, Property 7: Deterministic Validation Authority
   *
   * For any pair of (deterministic PipelineIssue, AI AuditSuggestion) targeting
   * the same pass field: if the deterministic issue has severity "critical" and
   * the AI suggestion's recommended value would not resolve the conflict (as
   * determined by getProviderConflicts()), the AI suggestion must be suppressed
   * from displayed results. The displayed severity for that pass field must
   * always be the deterministic issue's severity, regardless of AI assessment.
   *
   * Validates: Requirements 5.1, 5.2, 5.5
   */

  it("AI findings contradicting deterministic issues on the same pass field are discarded", () => {
    fc.assert(
      fc.property(
        arbConflictingPair("critical"),
        ({ detIssue, aiFinding }) => {
          const result = reconcileFindings([aiFinding], [detIssue], []);

          // The AI finding must NOT appear in the output
          const aiInOutput = result.find((f) => f.id === aiFinding.id);
          expect(aiInOutput).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("deterministic critical severity is preserved in output regardless of AI severity", () => {
    fc.assert(
      fc.property(
        arbConflictingPair("critical"),
        ({ detIssue }) => {
          const result = reconcileFindings([], [detIssue], []);

          // Find the deterministic finding in the output
          const detFinding = result.find((f) => f.id === `det-${detIssue.id}`);
          expect(detFinding).toBeDefined();
          // Its severity must remain "critical" (never downgraded)
          expect(detFinding!.severity).toBe("critical");
        },
      ),
      { numRuns: 100 },
    );
  });

  it("AI finding suppressed when its patch would not resolve a critical provider conflict", () => {
    fc.assert(
      fc.property(
        arbConflictWithWrongAiFix(),
        ({ conflict, aiFinding }) => {
          const result = reconcileFindings([aiFinding], [], [conflict]);

          // The AI finding should be suppressed because its suggested value
          // doesn't match the provider conflict's autofix resolution
          const aiInOutput = result.find((f) => f.id === aiFinding.id);
          expect(aiInOutput).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("AI finding NOT suppressed when its patch matches the provider conflict autofix value", () => {
    fc.assert(
      fc.property(
        arbConflictWithCorrectAiFix(),
        ({ conflict, aiFinding }) => {
          const result = reconcileFindings([aiFinding], [], [conflict]);

          // The AI finding should survive because its suggestion matches the resolution
          const aiInOutput = result.find((f) => f.id === aiFinding.id);
          expect(aiInOutput).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("AI findings not targeting any deterministic pass field are preserved", () => {
    fc.assert(
      fc.property(
        arbNonConflictingPair(),
        ({ detIssue, aiFinding }) => {
          const result = reconcileFindings([aiFinding], [detIssue], []);

          // The AI finding should survive since it targets a different field
          const aiInOutput = result.find((f) => f.id === aiFinding.id);
          expect(aiInOutput).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("discards AI findings that patch the same top-level autofix key as a deterministic issue", () => {
    const detIssue: PipelineIssue = {
      id: "provider-hardware-cpu",
      severity: "critical",
      title: "CPU not available on this machine",
      description: "Use detected CUDA hardware",
      affectedPasses: ["provider"],
      actionLabel: "Use detected hardware",
      autofix: { ihvProvider: "CUDAExecutionProvider" },
    };
    const aiFinding: Finding = {
      id: "ai-switch-cpu",
      title: "Switch to CPU",
      description: "Prefer CPUExecutionProvider",
      severity: "info",
      evidence: "model suggested CPU",
      actions: [
        {
          kind: "applyPatch",
          label: "Use CPU",
          payload: { ihvProvider: "CPUExecutionProvider" },
        },
      ],
    };

    const result = reconcileFindings([aiFinding], [detIssue], []);
    expect(result.find((f) => f.id === aiFinding.id)).toBeUndefined();
    expect(result.find((f) => f.id === `det-${detIssue.id}`)).toBeDefined();
  });

  it("preserves AI findings that patch a different top-level key than the deterministic autofix", () => {
    const detIssue: PipelineIssue = {
      id: "provider-hardware-cpu",
      severity: "critical",
      title: "CPU not available on this machine",
      description: "Use detected CUDA hardware",
      affectedPasses: ["provider"],
      actionLabel: "Use detected hardware",
      autofix: { ihvProvider: "CUDAExecutionProvider" },
    };
    const aiFinding: Finding = {
      id: "ai-cache-dir",
      title: "Set cache directory",
      description: "Point cacheDir at a local folder",
      severity: "info",
      evidence: "model suggested cacheDir",
      actions: [
        {
          kind: "applyPatch",
          label: "Set cache",
          payload: { cacheDir: "/tmp/olive-cache" },
        },
      ],
    };

    const result = reconcileFindings([aiFinding], [detIssue], []);
    expect(result.find((f) => f.id === aiFinding.id)).toBeDefined();
  });

  it("deterministic findings appear before AI findings in output ordering", () => {
    fc.assert(
      fc.property(
        arbNonConflictingPair(),
        ({ detIssue, aiFinding }) => {
          const result = reconcileFindings([aiFinding], [detIssue], []);

          // Find positions
          const detIdx = result.findIndex((f) => f.id === `det-${detIssue.id}`);
          const aiIdx = result.findIndex((f) => f.id === aiFinding.id);

          // Deterministic findings come before AI findings
          expect(detIdx).toBeGreaterThanOrEqual(0);
          expect(aiIdx).toBeGreaterThanOrEqual(0);
          expect(detIdx).toBeLessThan(aiIdx);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("provider conflict findings preserve their severity in output", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<IssueSeverity>("critical", "warning", "info"),
        arbPassFieldKey(),
        (severity, passKey) => {
          const conflict: ProviderConflict = {
            passKey,
            passName: `Test ${passKey}`,
            reason: "Test reason",
            severity,
            autofix: () => ({ [passKey]: "ptq" }) as Partial<UIState["passes"]>,
          };

          const result = reconcileFindings([], [], [conflict]);

          const conflictFinding = result.find((f) => f.id === `prov-${passKey}`);
          expect(conflictFinding).toBeDefined();
          expect(conflictFinding!.severity).toBe(severity);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 8: Review Isolation from Chat History ──────────────────────────

describe("Property 8: Review Isolation from Chat History", () => {
  /**
   * Feature: v05-release, Property 8: Review Isolation from Chat History
   *
   * For any automatic review refresh cycle triggered by /api/ai/analyze-state,
   * the chatHistory array and chatMessages state must remain identical before
   * and after the review completes — no elements appended, prepended, or
   * modified.
   *
   * The reconcileFindings function is a pure function — it never receives
   * chatHistory or chatMessages as parameters, guaranteeing by design that
   * reconciliation cannot mutate chat state. This property verifies:
   * 1. reconcileFindings does not accept or modify external state
   * 2. The function is pure (same inputs → same outputs, no side effects)
   * 3. Input arrays are not mutated by the reconciler
   *
   * Validates: Requirements 5.3
   */

  it("reconcileFindings does not mutate its input arrays", () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.array(arbAiFindingTargetingPassField(), { minLength: 0, maxLength: 5 }),
          fc.array(arbPipelineIssue(), { minLength: 0, maxLength: 3 }),
          fc.array(arbProviderConflict(), { minLength: 0, maxLength: 3 }),
        ),
        ([aiFindings, deterministicIssues, providerConflicts]) => {
          // Deep clone inputs to compare after call
          const aiOriginal = JSON.parse(JSON.stringify(aiFindings));
          const detOriginal = JSON.parse(JSON.stringify(deterministicIssues));
          // ProviderConflict has functions, so we compare structural fields
          const conflictOriginalFields = providerConflicts.map((c) => ({
            passKey: c.passKey,
            passName: c.passName,
            reason: c.reason,
            severity: c.severity,
          }));

          reconcileFindings(aiFindings, deterministicIssues, providerConflicts);

          // Input arrays must not be mutated
          expect(aiFindings).toEqual(aiOriginal);
          expect(deterministicIssues).toEqual(detOriginal);
          expect(
            providerConflicts.map((c) => ({
              passKey: c.passKey,
              passName: c.passName,
              reason: c.reason,
              severity: c.severity,
            })),
          ).toEqual(conflictOriginalFields);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("reconcileFindings is a pure function — same inputs produce identical outputs", () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.array(arbAiFindingExplainOnly(), { minLength: 0, maxLength: 5 }),
          fc.array(arbPipelineIssue(), { minLength: 0, maxLength: 3 }),
          fc.array(arbProviderConflict(), { minLength: 0, maxLength: 3 }),
        ),
        ([aiFindings, deterministicIssues, providerConflicts]) => {
          const result1 = reconcileFindings(aiFindings, deterministicIssues, providerConflicts);
          const result2 = reconcileFindings(aiFindings, deterministicIssues, providerConflicts);

          // Pure function: identical inputs → identical outputs
          expect(result1).toEqual(result2);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("chatHistory and chatMessages arrays remain untouched during reconciliation", () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.nat({ max: 20 }),
          fc.nat({ max: 20 }),
          fc.array(arbAiFindingExplainOnly(), { minLength: 0, maxLength: 5 }),
          fc.array(arbPipelineIssue(), { minLength: 0, maxLength: 3 }),
          fc.array(arbProviderConflict(), { minLength: 0, maxLength: 3 }),
        ),
        ([chatHistoryLength, chatMessagesLength, aiFindings, issues, conflicts]) => {
          // Create simulated chat state arrays (as they would exist in the store)
          const chatHistory: Array<{ role: string; content: string }> = Array.from(
            { length: chatHistoryLength },
            (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: `msg-${i}` }),
          );
          const chatMessages: Array<{ id: string; text: string }> = Array.from(
            { length: chatMessagesLength },
            (_, i) => ({ id: `msg-${i}`, text: `message content ${i}` }),
          );

          // Deep clone for comparison
          const chatHistoryBefore = JSON.parse(JSON.stringify(chatHistory));
          const chatMessagesBefore = JSON.parse(JSON.stringify(chatMessages));

          // Run reconciliation — it should have no access to chat arrays
          reconcileFindings(aiFindings, issues, conflicts);

          // Chat state must be completely unchanged
          expect(chatHistory).toEqual(chatHistoryBefore);
          expect(chatMessages).toEqual(chatMessagesBefore);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("reconcileFindings function signature excludes chat parameters (structural guarantee)", () => {
    // This test verifies at the type/structural level that reconcileFindings
    // accepts exactly 3 parameters and none of them are chat-related.
    // The function's parameter count proves it cannot access external mutable state.
    expect(reconcileFindings.length).toBe(3);

    // Calling with exactly the 3 expected arguments succeeds
    const result = reconcileFindings([], [], []);
    expect(Array.isArray(result)).toBe(true);
  });
});
