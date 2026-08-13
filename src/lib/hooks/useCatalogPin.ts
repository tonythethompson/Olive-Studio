/**
 * Hook for integrating recipe catalog version pinning into the loading flow.
 *
 * On mount (when enabled), resolves the upstream HEAD SHA via `resolveHeadSha()`,
 * compares against the stored catalog metadata in localStorage, and exposes
 * staleness state, refresh control, and error handling.
 *
 * Consumed by Recipe Catalog panels to show `CatalogUpdateNotice` when newer
 * recipes are available upstream.
 *
 * @module useCatalogPin
 * @see Requirements 10.2, 10.3, 10.5, 10.6, 10.7
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  resolveHeadSha,
  fetchCatalogAtSha,
  isCatalogStale,
  formatCatalogMetadata,
  CatalogPinError,
} from "@/lib/recipeCatalogPin";
import type { CatalogMetadata, CatalogEntry } from "@/lib/recipeCatalogPin";

// ─── Constants ───────────────────────────────────────────────────────────────

/** localStorage key for persisted catalog pin metadata. */
export const CATALOG_PIN_STORAGE_KEY = "olive-studio:catalog-pin";

/**
 * Minimum interval (in ms) between successive SHA resolution calls.
 * Prevents hammering the GitHub API on rapid remounts.
 */
const DEBOUNCE_RESOLVE_MS = 2_000;

/**
 * Minimum time (in ms) since last fetch before checking upstream again.
 * Requirement 10.3: "last catalog fetch occurred more than 60 seconds ago".
 */
const STALE_CHECK_THRESHOLD_MS = 60_000;

/** Shared across hook instances so remounts still honor the debounce window. */
let lastResolveTimeMs = 0;

// ─── localStorage Helpers ────────────────────────────────────────────────────

/**
 * Loads stored catalog metadata from localStorage.
 * Returns `null` if nothing is stored or the data is invalid.
 */
export function loadStoredMetadata(): CatalogMetadata | null {
  try {
    const raw = localStorage.getItem(CATALOG_PIN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof parsed.branch === "string" &&
      typeof parsed.commitSha === "string" &&
      typeof parsed.fetchedAt === "string" &&
      parsed.commitSha.length === 40
    ) {
      return parsed as unknown as CatalogMetadata;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Persists catalog metadata to localStorage.
 */
export function saveStoredMetadata(metadata: CatalogMetadata): void {
  try {
    localStorage.setItem(CATALOG_PIN_STORAGE_KEY, JSON.stringify(metadata));
  } catch {
    // Silently fail if localStorage is unavailable (e.g. quota exceeded)
  }
}

// ─── Hook Return Type ────────────────────────────────────────────────────────

export interface UseCatalogPinReturn {
  /** Whether the stored catalog is outdated relative to upstream. */
  isStale: boolean;
  /** Whether a catalog refresh is currently in progress. */
  isRefreshing: boolean;
  /** The currently stored commit SHA (from localStorage), or null if none. */
  currentSha: string | null;
  /** The upstream HEAD SHA resolved from GitHub, or null if not yet resolved. */
  upstreamSha: string | null;
  /** Error message if SHA resolution or catalog fetch failed. */
  error: string | null;
  /** Trigger a catalog refresh: fetches new catalog at the upstream SHA. */
  refresh: () => Promise<CatalogEntry[] | null>;
  /** The full stored metadata (branch + SHA + fetchedAt), or null. */
  metadata: CatalogMetadata | null;
}

export interface UseCatalogPinOptions {
  /** Whether the hook should actively check for updates. Defaults to true. */
  enabled?: boolean;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Integrates recipe catalog version pinning into the recipe loading flow.
 *
 * Behavior:
 * 1. On mount (when enabled): loads stored metadata from localStorage.
 * 2. Resolves upstream HEAD SHA (debounced to avoid rapid API calls).
 * 3. Compares using `isCatalogStale(stored, upstream)`.
 * 4. Exposes `isStale`, `isRefreshing`, `refresh()`, `currentSha`, `error`.
 * 5. On `refresh()`: fetches catalog at upstream SHA, persists new metadata.
 * 6. On failure: sets error state, retains previous catalog.
 */
export function useCatalogPin(options: UseCatalogPinOptions = {}): UseCatalogPinReturn {
  const { enabled = true } = options;

  const [metadata, setMetadata] = useState<CatalogMetadata | null>(() => loadStoredMetadata());
  const [upstreamSha, setUpstreamSha] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track the debounce timer and mount state
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  // Track the last resolve time to avoid hammering the API
  // Track whether a resolve is already in-flight to prevent duplicate calls
  const resolvingRef = useRef(false);
  // Track whether a refresh is in-flight to prevent duplicate refresh calls
  const refreshingRef = useRef(false);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Resolve upstream HEAD SHA on mount (debounced)
  useEffect(() => {
    if (!enabled) return;

    // Check if we should skip based on freshness threshold
    const stored = loadStoredMetadata();
    if (stored) {
      const fetchedAt = new Date(stored.fetchedAt).getTime();
      const elapsed = Date.now() - fetchedAt;
      if (elapsed < STALE_CHECK_THRESHOLD_MS) {
        // Last fetch was recent enough, skip the upstream check
        setMetadata(stored);
        setUpstreamSha(stored.commitSha);
        return;
      }
    }

    // Debounce the resolution to prevent rapid API calls on remounts
    const now = Date.now();
    const timeSinceLastResolve = now - lastResolveTimeMs;
    const delay = Math.max(0, DEBOUNCE_RESOLVE_MS - timeSinceLastResolve);

    debounceTimerRef.current = setTimeout(() => {
      // Guard against duplicate in-flight resolves
      if (resolvingRef.current) return;
      resolvingRef.current = true;
      lastResolveTimeMs = Date.now();

      void resolveHeadSha()
        .then((sha) => {
          if (!mountedRef.current) return;
          setUpstreamSha(sha);
          setError(null);
        })
        .catch((err: unknown) => {
          if (!mountedRef.current) return;
          const message =
            err instanceof CatalogPinError
              ? err.message
              : err instanceof Error
                ? err.message
                : "Failed to check for catalog updates";
          setError(message);
        })
        .finally(() => {
          resolvingRef.current = false;
        });
    }, delay);

    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [enabled]);

  // Compute staleness
  const isStale =
    upstreamSha !== null && metadata !== null && isCatalogStale(metadata, upstreamSha);

  // Current SHA from stored metadata
  const currentSha = metadata?.commitSha ?? null;

  /**
   * Refresh the catalog: fetch at the resolved upstream SHA and persist new metadata.
   * On failure, retains the previous catalog and sets error state.
   */
  const refresh = useCallback(async (): Promise<CatalogEntry[] | null> => {
    // Guard against duplicate in-flight refreshes
    if (refreshingRef.current) return null;

    const sha = upstreamSha;
    if (!sha) {
      setError("No upstream SHA resolved — cannot refresh catalog.");
      return null;
    }

    refreshingRef.current = true;
    setIsRefreshing(true);
    setError(null);

    try {
      const entries = await fetchCatalogAtSha(sha);
      // Use the branch from the first entry's pinned metadata, or fall back
      // to the currently stored metadata's branch, or "main".
      const branch = entries[0]?.pinned.branch ?? metadata?.branch ?? "main";
      const newMetadata = formatCatalogMetadata(sha, branch);
      // Persist to localStorage
      saveStoredMetadata(newMetadata);
      if (mountedRef.current) {
        setMetadata(newMetadata);
        setUpstreamSha(sha);
        setIsRefreshing(false);
        setError(null);
      }
      return entries;
    } catch (err: unknown) {
      if (mountedRef.current) {
        const message =
          err instanceof CatalogPinError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to refresh catalog";
        setError(message);
        setIsRefreshing(false);
      }
      // Retain previous catalog on failure (Requirement 10.5)
      return null;
    } finally {
      refreshingRef.current = false;
    }
  }, [upstreamSha, metadata]);

  return {
    isStale,
    isRefreshing,
    currentSha,
    upstreamSha,
    error,
    refresh,
    metadata,
  };
}
