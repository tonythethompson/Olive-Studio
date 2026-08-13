/**
 * React hooks for fetching MCP troubleshooting diagnostics.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import type { McpDiagnostic } from "@/types";
import { requestMcpDiagnostic } from "@/lib/mcpClient";

interface UseMcpDiagnosticReturn {
  /** The latest diagnostic result (only for single-diagnostic use). */
  diagnostic: McpDiagnostic | null;
  /** True while a fetch is in flight. */
  isDiagnosing: boolean;
  /** Last fetch error message, if any. Cleared on the next successful fetch. */
  error: string | null;
  /**
   * Fetch a diagnostic for the given logs. Returns the McpDiagnostic
   * result (or null on failure) so callers can store it in any shape
   * they need (single state, keyed Record, etc.).
   */
  fetchDiagnostic: (logs: string[]) => Promise<McpDiagnostic | null>;
  /** Clear the stored diagnostic and abort any in-flight fetch. */
  clearDiagnostic: () => void;
}

/**
 * Manages fetching and storing a single MCP diagnostic for error logs.
 *
 * Cancels any in-flight request when a new fetch starts or the component unmounts,
 * and exposes loading and error state alongside the diagnostic result.
 *
 * @returns The current diagnostic, loading state, error message, and diagnostic fetcher.
 */
export function useMcpDiagnostic(): UseMcpDiagnosticReturn {
  const [diagnostic, setDiagnostic] = useState<McpDiagnostic | null>(null);
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Cancel in-flight request on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const fetchDiagnostic = useCallback(async (logs: string[]): Promise<McpDiagnostic | null> => {
    if (logs.length === 0) return null;
    // Cancel any previous in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsDiagnosing(true);
    setError(null);
    setDiagnostic(null);
    try {
      const { diagnostic: result, error: fetchError } = await requestMcpDiagnostic(logs, controller.signal);
      if (controller.signal.aborted) return null;
      if (result) {
        setDiagnostic(result);
        setError(null);
        return result;
      }
      setError(fetchError);
      return null;
    } finally {
      // Only clear loading if this request wasn't superseded by a newer one
      if (!controller.signal.aborted) setIsDiagnosing(false);
    }
  }, []);

  const clearDiagnostic = useCallback(() => {
    abortRef.current?.abort();
    setDiagnostic(null);
    setError(null);
    setIsDiagnosing(false);
  }, []);

  return { diagnostic, isDiagnosing, error, fetchDiagnostic, clearDiagnostic };
}

/**
 * Manages MCP diagnostics, loading states, and errors independently for each key.
 *
 * Starting a request for a key cancels any previous request for that key and clears
 * its previous diagnostic. Aborted requests do not update the returned state.
 *
 * @returns Functions and keyed state for fetching and tracking diagnostics.
 */
export function useMcpDiagnosticKeyed(): {
  fetchKeyedDiagnostic: (key: string, logs: string[]) => Promise<McpDiagnostic | null>;
  diagnostics: Record<string, McpDiagnostic>;
  diagnosingKeys: Record<string, boolean>;
  errors: Record<string, string | null>;
} {
  const [diagnostics, setDiagnostics] = useState<Record<string, McpDiagnostic>>({});
  const [diagnosingKeys, setDiagnosingKeys] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const abortMapRef = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => {
    const aborts = abortMapRef.current;
    return () => {
      for (const controller of aborts.values()) controller.abort();
      aborts.clear();
    };
  }, []);

  const fetchKeyedDiagnostic = useCallback(async (key: string, logs: string[]) => {
    if (logs.length === 0) return null;
    abortMapRef.current.get(key)?.abort();
    const controller = new AbortController();
    abortMapRef.current.set(key, controller);

    setDiagnosingKeys((prev) => ({ ...prev, [key]: true }));
    setDiagnostics((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setErrors((prev) => ({ ...prev, [key]: null }));
    try {
      const { diagnostic: result, error: fetchError } = await requestMcpDiagnostic(logs, controller.signal);
      if (controller.signal.aborted) return null;
      if (result) {
        setDiagnostics((prev) => ({ ...prev, [key]: result }));
        setErrors((prev) => ({ ...prev, [key]: null }));
        return result;
      }
      setErrors((prev) => ({ ...prev, [key]: fetchError }));
      return null;
    } finally {
      if (!controller.signal.aborted) {
        setDiagnosingKeys((prev) => ({ ...prev, [key]: false }));
      }
      if (abortMapRef.current.get(key) === controller) {
        abortMapRef.current.delete(key);
      }
    }
  }, []);

  return { fetchKeyedDiagnostic, diagnostics, diagnosingKeys, errors };
}
