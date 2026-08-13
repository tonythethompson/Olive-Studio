/**
 * Review Reconciler — merges AI-generated findings with deterministic
 * pipeline validation issues and provider hardware conflicts.
 *
 * Design invariants (Requirement 5):
 * - Deterministic validation is authoritative: AI findings that contradict
 *   deterministic issues on the same pass field are discarded.
 * - Critical severity from deterministic sources is never downgraded.
 * - AI suggestions whose applyPatch would not resolve a provider conflict
 *   on the targeted pass field are suppressed.
 * - This module is a PURE FUNCTION — it never mutates its inputs, never
 *   accesses chatHistory/chatMessages, and produces no side effects.
 *
 * @module reviewReconciler
 */

import type {
  Finding,
  FindingSeverity,
  Action,
  ActionPayloadApplyPatch,
} from "@/lib/types/findingTypes";
import type { PipelineIssue, HardwareConflict } from "@/lib/pipelineValidation";

// ─── Public Type Alias ───────────────────────────────────────────────────────

/**
 * ProviderConflict is the public contract name used by the reconciler.
 * Internally it maps to `HardwareConflict` from pipelineValidation.
 */
export type ProviderConflict = HardwareConflict;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract the set of pass fields targeted by a Finding's applyPatch actions.
 * A "pass field" is a key within `patch.passes` (e.g. "quantMethod", "conversionFormat").
 */
function getAiFindingTargetPassFields(finding: Finding): Set<string> {
  const fields = new Set<string>();
  for (const action of finding.actions) {
    if (action.kind === "applyPatch") {
      const patch = (action as ActionPayloadApplyPatch).payload;
      if (patch.passes) {
        for (const key of Object.keys(patch.passes)) {
          fields.add(key);
        }
      }
    }
  }
  return fields;
}

/**
 * Determine if an AI finding contradicts a deterministic issue on the same
 * pass field. Any AI finding targeting the same pass field as a deterministic
 * issue is discarded — deterministic validation is authoritative (Req 5.1).
 */
function contradictsDeterministicIssue(
  finding: Finding,
  deterministicPassFields: Map<string, PipelineIssue>,
): boolean {
  const aiTargetFields = getAiFindingTargetPassFields(finding);
  if (aiTargetFields.size === 0) return false;

  // Any AI finding targeting the same pass field as a deterministic issue
  // is discarded — deterministic validation is authoritative (Req 5.1).
  for (const field of aiTargetFields) {
    if (deterministicPassFields.has(field)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if an AI finding's applyPatch action targets a pass field that has
 * a critical provider conflict, and the suggested value would NOT resolve it.
 *
 * A value "resolves" a conflict if it matches the conflict's autofix value
 * for that same pass key.
 */
function wouldNotResolveProviderConflict(
  finding: Finding,
  conflictsByPassKey: Map<string, ProviderConflict>,
): boolean {
  for (const action of finding.actions) {
    if (action.kind !== "applyPatch") continue;
    const patch = (action as ActionPayloadApplyPatch).payload;
    if (!patch.passes) continue;

    for (const [passKey, suggestedValue] of Object.entries(patch.passes)) {
      const conflict = conflictsByPassKey.get(passKey);
      if (!conflict || conflict.severity !== "critical") continue;

      const autofixPasses = conflict.autofix();
      const resolveValue = (autofixPasses as Record<string, unknown>)[passKey];

      // Missing autofix for this key still leaves the critical conflict unresolved.
      if (resolveValue === undefined || suggestedValue !== resolveValue) {
        return true;
      }
    }
  }
  return false;
}

const KNOWN_PASS_FIELDS = new Set([
  "conversion",
  "conversionSourceFormat",
  "conversionFormat",
  "conversionOpset",
  "conversionInputTargetTypes",
  "quantization",
  "quantMethod",
  "quantPrecision",
  "pruning",
  "pruningType",
  "pruningMethod",
  "pruningSparsity",
  "peft",
  "peftMethod",
  "splitting",
]);

const AFFECTED_PASS_FIELDS: Record<string, string[]> = {
  peft: ["peft", "peftMethod"],
  quantization: ["quantization", "quantMethod", "quantPrecision"],
  conversion: ["conversion", "conversionFormat", "conversionOpset", "conversionSourceFormat"],
  pruning: ["pruning", "pruningType", "pruningMethod", "pruningSparsity"],
  splitting: ["splitting"],
};

function collectDeterministicPassFields(issue: PipelineIssue): string[] {
  const passPatch = issue.autofix?.passes;
  if (!passPatch || typeof passPatch !== "object") {
    return (issue.affectedPasses ?? []).filter((k) => k !== "provider");
  }
  const patch = passPatch as Record<string, unknown>;
  const concrete = Object.keys(patch).filter((k) => KNOWN_PASS_FIELDS.has(k) && k !== "provider");
  if (issue.affectedPasses && issue.affectedPasses.length > 0) {
    const mapped = new Set<string>();
    for (const passId of issue.affectedPasses) {
      if (passId in patch && KNOWN_PASS_FIELDS.has(passId)) {
        mapped.add(passId);
        continue;
      }
      for (const field of AFFECTED_PASS_FIELDS[passId] ?? []) {
        if (field in patch) mapped.add(field);
      }
    }
    if (mapped.size > 0) return [...mapped];
  }
  return concrete;
}

/**
 * Convert a deterministic PipelineIssue into the unified Finding format.
 */
const TOP_LEVEL_PATCH_KEYS = [
  "ihvProvider",
  "cudaVersion",
  "memoryOffload",
  "modelSource",
  "hfModelId",
  "hfDataset",
  "cacheDir",
] as const;

function pipelineIssueToFinding(issue: PipelineIssue): Finding {
  const actions: Action[] = [];

  if (issue.autofix && issue.actionLabel) {
    const payload: ActionPayloadApplyPatch["payload"] = {};
    const autofix = issue.autofix as Record<string, unknown>;
    for (const key of TOP_LEVEL_PATCH_KEYS) {
      if (autofix[key] !== undefined) {
        (payload as Record<string, unknown>)[key] = autofix[key];
      }
    }
    if (issue.autofix.passes && typeof issue.autofix.passes === "object") {
      const passPatch = issue.autofix.passes as Record<string, unknown>;
      const targeted: Record<string, unknown> = {};
      const keys = collectDeterministicPassFields(issue);
      for (const key of keys) {
        if (key in passPatch) targeted[key] = passPatch[key];
      }
      if (Object.keys(targeted).length > 0) {
        payload.passes = targeted as ActionPayloadApplyPatch["payload"]["passes"];
      }
    }
    if (Object.keys(payload).length > 0) {
      actions.push({
        kind: "applyPatch",
        label: issue.actionLabel.slice(0, 80),
        payload,
      });
    }
  }

  // Always provide at least an explain action as fallback
  if (actions.length === 0) {
    actions.push({
      kind: "explain",
      label: "View details",
      payload: { body: `**${issue.title}**\n\n${issue.description}` },
    });
  }

  return {
    id: `det-${issue.id}`,
    title: issue.title.slice(0, 120),
    description: issue.description.slice(0, 2000),
    severity: issue.severity as FindingSeverity,
    evidence: issue.description,
    actions,
  };
}

/**
 * Convert a provider HardwareConflict into the unified Finding format.
 */
function providerConflictToFinding(conflict: ProviderConflict): Finding {
  const autofixPasses = conflict.autofix();
  const actions: Action[] = [
    {
      kind: "applyPatch",
      label: `Fix: ${conflict.passName}`.slice(0, 80),
      payload: { passes: autofixPasses },
    },
  ];

  return {
    id: `prov-${conflict.passKey}`,
    title: `${conflict.passName} incompatible`.slice(0, 120),
    description: conflict.reason.slice(0, 2000),
    severity: conflict.severity as FindingSeverity,
    evidence: conflict.reason,
    actions,
  };
}

// ─── Main Reconciler ─────────────────────────────────────────────────────────

/**
 * Reconcile AI-generated findings with deterministic pipeline issues and
 * provider hardware conflicts.
 *
 * Logic:
 * 1. Build lookup maps for deterministic issues (by affected pass fields)
 *    and provider conflicts (by passKey).
 * 2. Filter AI findings:
 *    - Discard findings that contradict deterministic issues on same pass field.
 *    - Suppress findings whose applyPatch wouldn't resolve provider conflicts.
 * 3. Convert deterministic issues and provider conflicts to Finding format.
 * 4. Return combined array: deterministic findings first (authority), then
 *    surviving AI findings.
 *
 * This function is pure — it never mutates inputs and has no side effects.
 *
 * @param aiFindings - Findings produced by the AI review engine
 * @param deterministicIssues - Issues from CROSS_PASS_RULES validation
 * @param providerConflicts - Hardware conflicts from getProviderConflicts()
 * @returns Reconciled findings array
 */
export function reconcileFindings(
  aiFindings: Finding[],
  deterministicIssues: PipelineIssue[],
  providerConflicts: ProviderConflict[],
): Finding[] {
  // Build lookup: pass field → deterministic issue
  // A deterministic issue's "affected pass fields" come from its autofix keys
  // and its affectedPasses array
  const deterministicPassFields = new Map<string, PipelineIssue>();
  for (const issue of deterministicIssues) {
    for (const field of collectDeterministicPassFields(issue)) {
      deterministicPassFields.set(field, issue);
    }
    if (issue.autofix) {
      for (const key of Object.keys(issue.autofix)) {
        if (key !== "passes") {
          deterministicPassFields.set(key, issue);
        }
      }
    }
  }

  // Build lookup: passKey → provider conflict (critical only for suppression)
  const conflictsByPassKey = new Map<string, ProviderConflict>();
  for (const conflict of providerConflicts) {
    conflictsByPassKey.set(conflict.passKey, conflict);
  }

  // Filter AI findings
  const survivingAiFindings: Finding[] = [];
  for (const finding of aiFindings) {
    // Rule 1: Discard AI findings contradicting deterministic issues
    if (contradictsDeterministicIssue(finding, deterministicPassFields)) {
      continue;
    }

    // Rule 2: Suppress AI findings whose patch wouldn't resolve provider conflicts
    if (wouldNotResolveProviderConflict(finding, conflictsByPassKey)) {
      continue;
    }

    survivingAiFindings.push(finding);
  }

  // Convert deterministic sources to Finding format
  const deterministicFindings = deterministicIssues.map(pipelineIssueToFinding);
  const conflictFindings = providerConflicts.map(providerConflictToFinding);

  // Deduplicate: if a provider conflict targets the same passKey as a
  // deterministic issue, the deterministic issue (which already incorporates
  // the conflict context) takes precedence
  const uniqueConflictFindings = conflictFindings.filter((f) => {
    // Check if the conflict's passKey is already covered by a deterministic issue
    const passKey = f.id.replace("prov-", "");
    return !deterministicPassFields.has(passKey);
  });

  // Combine: deterministic first (authority), then conflicts, then surviving AI
  return [...deterministicFindings, ...uniqueConflictFindings, ...survivingAiFindings];
}
