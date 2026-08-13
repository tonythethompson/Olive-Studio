/**
 * Hook for tracking workspace fingerprint and staleness detection.
 *
 * Subscribes to the pipeline store and recomputes a SHA-256 fingerprint
 * (debounced) whenever pipeline-relevant state changes. Provides O(1)
 * staleness comparison for review results.
 *
 * @module useWorkspaceFingerprint
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { usePipelineStore } from "@/lib/stores/pipelineStore";
import { computeFingerprint } from "@/lib/workspaceFingerprint";
import type { WorkspaceFingerprintState } from "@/lib/types/findingTypes";

/** Debounce interval in milliseconds for fingerprint recomputation. */
const DEBOUNCE_MS = 200;

export interface UseWorkspaceFingerprintReturn {
  /** Current SHA-256 hex fingerprint of the pipeline state. */
  fingerprint: string;
  /** Timestamp (Date.now()) when the fingerprint was last computed. */
  computedAt: number;
  /**
   * Compares a review result's fingerprint against the current workspace
   * fingerprint. Returns `true` if the result is stale (mismatch).
   */
  isStale: (resultFingerprint: string) => boolean;
}

/**
 * Tracks the workspace fingerprint derived from the pipeline store state.
 *
 * - Subscribes to `usePipelineStore` state changes via a selector.
 * - Debounces fingerprint recomputation (200ms) to avoid excessive hashing.
 * - Exposes `fingerprint`, `computedAt`, and an `isStale()` comparator.
 *
 * @returns The current fingerprint state and staleness check utility.
 */
export function useWorkspaceFingerprint(): UseWorkspaceFingerprintReturn {
  const state = usePipelineStore((s) => s.state);

  const [fpState, setFpState] = useState<WorkspaceFingerprintState>({
    fingerprint: "",
    computedAt: 0,
  });

  // Ref to track the latest debounce timer for cleanup
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref to track in-flight computation to discard stale results
  const computeIdRef = useRef(0);

  useEffect(() => {
    // Clear any pending debounce timer
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }

    // Increment the generation counter immediately so that any in-flight
    // computation from a prior state is invalidated.
    const generation = ++computeIdRef.current;

    // Schedule debounced recomputation
    timerRef.current = setTimeout(() => {
      void computeFingerprint(state).then((hash) => {
        // Only commit if this generation is still the latest —
        // a newer state change would have incremented computeIdRef further.
        if (generation === computeIdRef.current) {
          setFpState({
            fingerprint: hash,
            computedAt: Date.now(),
          });
        }
      });
    }, DEBOUNCE_MS);

    // Cleanup on unmount or before next effect
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, [state]);

  /**
   * Returns true if the given result fingerprint does not match the current
   * workspace fingerprint, indicating the result is stale.
   */
  const isStale = useCallback(
    (resultFingerprint: string): boolean => {
      // If we haven't computed a fingerprint yet, we can't determine staleness
      if (fpState.fingerprint === "") return false;
      return resultFingerprint !== fpState.fingerprint;
    },
    [fpState.fingerprint],
  );

  return {
    fingerprint: fpState.fingerprint,
    computedAt: fpState.computedAt,
    isStale,
  };
}
