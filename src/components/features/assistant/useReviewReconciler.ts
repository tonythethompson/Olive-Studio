/**
 * Hook that wraps the `reconcileFindings` utility with reactive access
 * to the current deterministic validation state from the pipeline store.
 *
 * Subscribes to the pipeline store to derive CROSS_PASS_RULES issues
 * (via `getPipelineValidation`) and provider hardware conflicts (via
 * `getProviderConflicts`). Exposes a stable `reconcile` function that
 * merges AI findings with the current deterministic state.
 *
 * Design invariants (Requirement 5):
 * - Deterministic validation is authoritative over AI findings.
 * - AI findings contradicting deterministic issues are discarded.
 * - Critical severity from deterministic sources is never downgraded.
 * - AI suggestions whose applyPatch would not resolve a provider conflict
 *   on the targeted pass field are suppressed.
 *
 * @module useReviewReconciler
 */

import { useCallback, useMemo } from "react";
import { usePipelineStore } from "@/lib/stores/pipelineStore";
import { reconcileFindings } from "@/lib/reviewReconciler";
import {
  getPipelineValidation,
  getProviderConflicts,
  type PipelineIssue,
  type HardwareConflict,
} from "@/lib/pipelineValidation";
import type { Finding } from "@/lib/types/findingTypes";

export interface UseReviewReconcilerReturn {
  /**
   * Reconcile AI-generated findings with the current deterministic
   * validation state. Returns the merged findings array with
   * deterministic findings first (authoritative), then surviving AI findings.
   */
  reconcile: (aiFindings: Finding[]) => Finding[];
}

/**
 * Provides a reactive `reconcile` function that merges AI findings with
 * deterministic pipeline validation issues and provider hardware conflicts.
 *
 * The hook subscribes to the pipeline store and memoizes the deterministic
 * issues and provider conflicts so reconciliation is efficient. When the
 * pipeline state changes, the memoized values update and subsequent calls
 * to `reconcile` reflect the latest deterministic validation.
 *
 * @returns An object containing the `reconcile` function.
 */
export function useReviewReconciler(): UseReviewReconcilerReturn {
  const state = usePipelineStore((s) => s.state);

  // Memoize deterministic issues derived from the current pipeline state.
  // getPipelineValidation runs CROSS_PASS_RULES, provider issues, and
  // other deterministic checks. We extract only the issues array.
  const deterministicIssues: PipelineIssue[] = useMemo(() => {
    return getPipelineValidation(state).issues;
  }, [state]);

  // Memoize provider hardware conflicts for the current provider + passes.
  const providerConflicts: HardwareConflict[] = useMemo(() => {
    return getProviderConflicts(state.ihvProvider, state.passes);
  }, [state.ihvProvider, state.passes]);

  // Stable reconcile function that uses current memoized deterministic state.
  const reconcile = useCallback(
    (aiFindings: Finding[]): Finding[] => {
      return reconcileFindings(aiFindings, deterministicIssues, providerConflicts);
    },
    [deterministicIssues, providerConflicts],
  );

  return { reconcile };
}
