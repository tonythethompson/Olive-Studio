/**
 * Pipeline Review lifecycle hook — orchestrates the review cycle from trigger
 * through fingerprint computation, API call, reconciliation, and staleness
 * detection.
 *
 * Design invariants:
 * - Only the most-recently-initiated review's results are applied (Req 3.6).
 * - Results arriving with a stale fingerprint are silently discarded (Req 3.3).
 * - After an applyPatch action commits, a debounced auto-refresh is scheduled
 *   between 300–1000 ms (Req 2.6).
 * - The hook never mutates chatHistory or chatMessages (Req 5.3).
 *
 * @module usePipelineReview
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { useWorkspaceFingerprint } from "@/lib/hooks/useWorkspaceFingerprint";
import { usePipelineStore } from "@/lib/stores/pipelineStore";
import { reconcileFindings } from "@/lib/reviewReconciler";
import {
  getPipelineValidation,
  getProviderConflicts,
} from "@/lib/pipelineValidation";
import { computeFingerprint } from "@/lib/workspaceFingerprint";
import { resolveAuditAutofix } from "@/lib/auditAutofix";
import type { Action, Finding } from "@/lib/types/findingTypes";
import type { ChatActionPatch } from "@/lib/chatActions";
import type { UIState } from "@/types";

// ─── Return Type ─────────────────────────────────────────────────────────────

export interface UsePipelineReviewReturn {
  /** Reconciled findings from the most recent valid review. */
  findings: Finding[];
  /** Pipeline health score (0–100). */
  score: number;
  /** Human-readable level label. */
  level: string;
  /** Short narrative summary of the review. */
  summary: string;
  /** True when the current findings are stale relative to the live workspace state. */
  isStale: boolean;
  /** True while a review request is in flight. */
  isLoading: boolean;
  /** Error message from the last failed review attempt (empty string if none). */
  error: string;
  /** Timestamp (Date.now()) when the last successful review completed, or 0 if none. */
  completedAt: number;
  /** Trigger a new review cycle. */
  refresh: () => void;
  /** Clear committed review results (e.g. provider removed). */
  reset: () => void;
  /**
   * Schedule an auto-refresh after a patch action (debounced 300–1000 ms).
   * Call this from ActionButton after applying a patch via commitUiStateUpdate.
   */
  schedulePostPatchRefresh: () => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Minimum debounce delay for post-patch auto-refresh (ms). */
const POST_PATCH_DEBOUNCE_MS = 400;
const ANALYZE_TIMEOUT_MS = 45_000;

const ACTION_KINDS = new Set<Action["kind"]>([
  "applyPatch",
  "navigate",
  "explain",
  "documentation",
]);

function parseActions(raw: unknown): Action[] {
  if (!Array.isArray(raw)) return [];
  const out: Action[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (!ACTION_KINDS.has(rec.kind as Action["kind"])) continue;
    if (typeof rec.label !== "string") continue;
    out.push(rec as Action);
  }
  return out.slice(0, 10);
}

function parseFindings(raw: unknown): Finding[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Finding[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const severity = rec.severity;
    if (
      typeof rec.id !== "string" ||
      typeof rec.title !== "string" ||
      typeof rec.description !== "string" ||
      (severity !== "critical" && severity !== "warning" && severity !== "info")
    ) {
      continue;
    }
    const actions = parseActions(rec.actions);
    out.push({
      id: rec.id,
      title: rec.title.slice(0, 120),
      description: rec.description.slice(0, 2000),
      severity,
      evidence: typeof rec.evidence === "string" ? rec.evidence : rec.description,
      actions:
        actions.length > 0
          ? actions
          : [
              {
                kind: "explain",
                label: "View details",
                payload: { body: `**${rec.title}**\n\n${rec.description}` },
              },
            ],
    });
  }
  return out;
}

// ─── Hook Implementation ─────────────────────────────────────────────────────

/**
 * Orchestrates the Pipeline Review lifecycle:
 *
 * 1. `refresh()` increments a review counter (to discard stale in-flight results).
 * 2. The current workspace fingerprint is captured at request time.
 * 3. A POST to `/api/ai/analyze-state` returns AI-generated suggestions.
 * 4. On response, reconcileFindings merges AI suggestions with deterministic issues.
 * 5. The result fingerprint is compared against the *current* fingerprint —
 *    if mismatched, the result is discarded as stale.
 * 6. On success, findings/score/level/summary are updated in local state.
 *
 * Staleness tracking:
 * - `isStale` becomes true when the workspace fingerprint changes after a
 *   review result was committed (the result's fingerprint no longer matches).
 * - On discard (stale arrival), the previous findings remain marked stale.
 */
export function usePipelineReview(controlledState?: UIState): UsePipelineReviewReturn {
  // ── External state ────────────────────────────────────────────────────────
  const { fingerprint: currentFingerprint } = useWorkspaceFingerprint();
  const storeState = usePipelineStore((s) => s.state);
  const pipelineState = controlledState ?? storeState;

  // ── Local state ───────────────────────────────────────────────────────────
  const [findings, setFindings] = useState<Finding[]>([]);
  const [score, setScore] = useState(0);
  const [level, setLevel] = useState("");
  const [summary, setSummary] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  /** Fingerprint that was current when the last successful result was committed. */
  const [resultFingerprint, setResultFingerprint] = useState("");
  /** Timestamp (Date.now()) when the last successful review completed. */
  const [completedAt, setCompletedAt] = useState(0);

  // ── Refs ──────────────────────────────────────────────────────────────────
  /** Monotonically increasing review ID — used to discard older in-flight results. */
  const reviewIdRef = useRef(0);
  /** Timer for post-patch debounced auto-refresh. */
  const postPatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** Latest pipeline state ref for async access inside fetch callbacks. */
  const stateRef = useRef(pipelineState);

  // Keep stateRef in sync.
  useEffect(() => {
    stateRef.current = pipelineState;
  }, [pipelineState]);

  // Cleanup timers on unmount.
  useEffect(() => {
    return () => {
      if (postPatchTimerRef.current) {
        clearTimeout(postPatchTimerRef.current);
      }
      abortRef.current?.abort();
    };
  }, []);

  // ── Staleness derivation ──────────────────────────────────────────────────
  // The findings are stale if the result's fingerprint doesn't match the
  // current live fingerprint, unless we've never completed a review.
  const isStale =
    resultFingerprint !== "" &&
    (currentFingerprint === "" || resultFingerprint !== currentFingerprint);

  // ── Core review cycle ─────────────────────────────────────────────────────

  const refresh = useCallback(() => {
    // Gate: do not start a review until the workspace fingerprint has been
    // computed at least once. Without this, the result would be committed with
    // an empty fingerprint and staleness detection would never trigger.
    if (currentFingerprint === "") return;

    const thisReviewId = ++reviewIdRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), ANALYZE_TIMEOUT_MS);

    setIsLoading(true);
    setError("");

    // Capture the snapshot and compute its hash before fetch.
    const snapshot = stateRef.current;
    let snapshotHash = "";

    void (async () => {
      try {
        // Hash the snapshot before fetch so we can compare against the live state later.
        snapshotHash = await computeFingerprint(snapshot);

        // If a newer review was initiated while hashing, abandon.
        if (thisReviewId !== reviewIdRef.current) return;

        const response = await fetch("/api/ai/analyze-state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: snapshot }),
          signal: controller.signal,
        });

        // If a newer review was initiated while this was in-flight, abandon.
        if (thisReviewId !== reviewIdRef.current) return;

        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.includes("application/json")) {
          throw new Error(
            "The analysis service returned an unexpected response. Try again.",
          );
        }

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            (data as { error?: string }).error || `HTTP ${response.status}`,
          );
        }

        // Abandon if a newer review was started during JSON parsing.
        if (thisReviewId !== reviewIdRef.current) return;

        // Hash the live pipeline state after the response arrives.
        const liveState = stateRef.current;
        const liveHash = await computeFingerprint(liveState);

        // If a newer review was initiated during live hashing, abandon.
        if (thisReviewId !== reviewIdRef.current) return;

        // Re-read after hashing so we don't commit findings for a superseded state.
        const confirmState = stateRef.current;
        const confirmHash = await computeFingerprint(confirmState);
        if (thisReviewId !== reviewIdRef.current) return;

        // Discard if the snapshot hash differs from the live state hash
        // (the workspace has moved on since the review was requested).
        if (snapshotHash !== liveHash || liveHash !== confirmHash) return;

        // Extract AI suggestions from the response (legacy format compatibility).
        const rawResult = data as {
          score?: number;
          level?: string;
          summary?: string;
          suggestions?: Array<Record<string, unknown>>;
          findings?: Finding[];
        };

        const { issues } = getPipelineValidation(snapshot);
        const providerConflicts = getProviderConflicts(
          snapshot.ihvProvider,
          snapshot.passes,
        );

        const parsedFindings = parseFindings(rawResult.findings);
        const aiFindings: Finding[] = parsedFindings ?? adaptSuggestionsToFindings(
          rawResult.suggestions ?? [],
          snapshot,
        );

        // Reconcile AI findings with deterministic validation.
        const reconciled = reconcileFindings(aiFindings, issues, providerConflicts);

        // Final abandon check.
        if (thisReviewId !== reviewIdRef.current) return;

        // Commit results — use the live hash as the result fingerprint.
        setFindings(reconciled);
        setScore(rawResult.score ?? 0);
        setLevel(rawResult.level ?? "");
        setSummary(rawResult.summary ?? "");
        setResultFingerprint(liveHash);
        setCompletedAt(Date.now());
        setError("");
      } catch (err: unknown) {
        // Only apply error if this is still the active review.
        if (thisReviewId !== reviewIdRef.current) return;
        if (err instanceof DOMException && err.name === "AbortError") {
          setError("Analysis timed out. Try again.");
          return;
        }
        const message =
          err instanceof Error ? err.message : "Review failed.";
        setError(message);
      } finally {
        if (thisReviewId === reviewIdRef.current) {
          setIsLoading(false);
        }
        window.clearTimeout(timeoutId);
      }
    })();
  }, [currentFingerprint]);

  const reset = useCallback(() => {
    reviewIdRef.current += 1;
    abortRef.current?.abort();
    if (postPatchTimerRef.current) {
      clearTimeout(postPatchTimerRef.current);
      postPatchTimerRef.current = null;
    }
    setFindings([]);
    setScore(0);
    setLevel("");
    setSummary("");
    setResultFingerprint("");
    setCompletedAt(0);
    setError("");
    setIsLoading(false);
  }, []);

  // ── Post-patch auto-refresh (Req 2.6: 300–1000 ms) ───────────────────────

  const schedulePostPatchRefresh = useCallback(() => {
    if (postPatchTimerRef.current) {
      clearTimeout(postPatchTimerRef.current);
    }
    postPatchTimerRef.current = setTimeout(() => {
      postPatchTimerRef.current = null;
      refresh();
    }, POST_PATCH_DEBOUNCE_MS);
  }, [refresh]);

  // ── Return ────────────────────────────────────────────────────────────────

  return {
    findings,
    score,
    level,
    summary,
    isStale,
    isLoading,
    error,
    completedAt,
    refresh,
    reset,
    schedulePostPatchRefresh,
  };
}

// ─── Adapter: legacy Suggestion → Finding ────────────────────────────────────

/**
 * Converts legacy `AuditSuggestion` objects from the `/api/ai/analyze-state`
 * response into the unified `Finding` format for reconciliation.
 *
 * This adapter bridges the old response format (pre-v0.5) to the new Finding
 * contract until the backend is migrated to return findings directly.
 */
function adaptSuggestionsToFindings(
  suggestions: Array<Record<string, unknown>>,
  pipelineState: Parameters<typeof resolveAuditAutofix>[1],
): Finding[] {
  return suggestions.map((s, idx) => {
    const title = typeof s.title === "string" ? s.title.slice(0, 120) : `Finding ${idx + 1}`;
    const description =
      typeof s.description === "string" ? s.description.slice(0, 2000) : "";
    const impact = typeof s.impact === "string" ? s.impact : "Low";

    // Map legacy impact levels to Finding severity.
    const severity =
      impact === "High" ? "critical" : impact === "Medium" ? "warning" : "info";

    // Build actions from legacy autofix.
    const actions: Finding["actions"] = [];
    const autofix = s.autofix as { pass?: string; value?: unknown } | undefined;
    if (autofix && typeof autofix.pass === "string" && autofix.pass) {
      const value = typeof autofix.value === "string"
        ? autofix.value
        : JSON.stringify(autofix.value ?? "");
      const payload = resolveAuditAutofix(
        { pass: autofix.pass, value },
        pipelineState,
      );
      if (payload) {
        actions.push({
          kind: "applyPatch",
          label: `Apply fix: ${autofix.pass}`.slice(0, 80),
          payload: payload as ChatActionPatch,
        });
      }
    }

    // Always provide an explain fallback if no valid patch action.
    if (actions.length === 0) {
      actions.push({
        kind: "explain",
        label: "View details",
        payload: { body: `**${title}**\n\n${description}` },
      });
    }

    return {
      id: `ai-${idx}`,
      title,
      description,
      severity,
      evidence: description,
      actions,
    } satisfies Finding;
  });
}
