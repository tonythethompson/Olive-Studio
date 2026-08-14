import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface KbStatus {
  available: boolean;
  version?: string;
  lastUpdated?: string | null;
  lastSync?: string | null;
  passCount?: number;
  error?: string;
  /** Server-side failure class when available is false (missing/unreadable/invalid). */
  reason?: "missing" | "unreadable" | "invalid";
}

export interface KbSyncResult {
  ok: boolean;
  stdout?: string;
  stderr?: string | null;
  report?: Record<string, unknown> | null;
  error?: string;
}

const SYNC_TIMEOUT_MS = 130_000;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
export const KB_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const KB_STATUS_QUERY_KEY = ["kb-status"] as const;

function unavailableMessage(status: Pick<KbStatus, "error" | "reason">): string {
  const reasonBit = status.reason ? ` (${status.reason})` : "";
  return status.error ? `${status.error}${reasonBit}` : `Knowledge base unavailable${reasonBit}`;
}

async function fetchKbStatus(): Promise<KbStatus> {
  const res = await fetch("/api/mcp/kb-status");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as KbStatus;
}

async function postKbSync(): Promise<KbSyncResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {};
    // Optional: set VITE_SYNC_KB_TOKEN to match SYNC_KB_TOKEN when the server requires a sync token.
    const metaEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
    const syncToken = metaEnv?.VITE_SYNC_KB_TOKEN;
    if (syncToken) {
      headers["x-sync-token"] = syncToken;
    }
    const res = await fetch("/api/mcp/sync-kb", {
      method: "POST",
      headers,
      signal: controller.signal,
    });
    let data: KbSyncResult;
    try {
      data = (await res.json()) as KbSyncResult;
    } catch {
      data = { ok: false, error: `HTTP ${res.status}` };
    }
    if (!res.ok) {
      const detail =
        res.status === 429
          ? "Rate limited — wait about a minute and try sync again."
          : (data.error ?? `HTTP ${res.status}`);
      throw new Error(detail);
    }
    if (data.ok !== true) {
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    return data;
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("KB sync timed out");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Converts the knowledge-base freshness timestamp to milliseconds since the Unix epoch.
 *
 * @param status - Knowledge-base status containing synchronization or catalog update timestamps
 * @returns The parsed timestamp in milliseconds, or `null` when no valid timestamp is available
 */
export function kbFreshnessMs(
  status: Pick<KbStatus, "lastSync" | "lastUpdated"> | null | undefined,
): number | null {
  // Prefer lastSync, but empty strings must fall through to lastUpdated (`??` does not).
  const raw =
    [status?.lastSync, status?.lastUpdated].find((s) => typeof s === "string" && s.trim().length > 0) ?? null;
  if (!raw) return null;
  // Date-only stamps (YYYY-MM-DD) are treated as end-of-day UTC so a catalog
  // updated "today" is not immediately ~24h old at local afternoon.
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:59.999Z` : raw;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Determines whether a knowledge-base status requires synchronization.
 *
 * @param status - The status containing the most recent synchronization or update timestamp
 * @param now - The reference time in milliseconds since the Unix epoch
 * @returns `true` if the status has no valid timestamp or is older than seven days, `false` otherwise
 */
export function isKbStatusStale(
  status: Pick<KbStatus, "lastSync" | "lastUpdated"> | null | undefined,
  now = Date.now(),
): boolean {
  const syncTime = kbFreshnessMs(status);
  return syncTime == null || now - syncTime > KB_STALE_AFTER_MS;
}

/**
 * Provides knowledge base status, synchronization controls, and refresh state.
 *
 * @returns The current status, synchronization state, error message, synchronization action, and status refresh action.
 */
export function useKbSync() {
  const queryClient = useQueryClient();
  const autoSyncAttempted = useRef(false);

  // Polls on an interval and refetches on tab focus (React Query default),
  // replacing the old manual setInterval + visibilitychange listener.
  const statusQuery = useQuery({
    queryKey: KB_STATUS_QUERY_KEY,
    queryFn: fetchKbStatus,
    refetchInterval: REFRESH_INTERVAL_MS,
    retry: false,
  });
  const status = statusQuery.data ?? null;

  const syncMutation = useMutation({
    mutationFn: postKbSync,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KB_STATUS_QUERY_KEY });
    },
  });

  const syncKb = useCallback(async (): Promise<KbSyncResult | null> => {
    try {
      return await syncMutation.mutateAsync();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }, [syncMutation]);

  const refreshStatus = useCallback(async (): Promise<KbStatus | null> => {
    const result = await queryClient.fetchQuery({ queryKey: KB_STATUS_QUERY_KEY, queryFn: fetchKbStatus });
    return result ?? null;
  }, [queryClient]);

  useEffect(() => {
    if (autoSyncAttempted.current || statusQuery.isLoading) return;
    autoSyncAttempted.current = true;
    if (status?.available && isKbStatusStale(status)) {
      void syncKb();
    }
  }, [statusQuery.isLoading, status, syncKb]);

  const error = syncMutation.error
    ? (syncMutation.error instanceof Error ? syncMutation.error.message : String(syncMutation.error))
    : statusQuery.error
      ? (statusQuery.error instanceof Error ? statusQuery.error.message : String(statusQuery.error))
      : status?.available === false
        ? unavailableMessage(status)
        : null;

  return { status, syncing: syncMutation.isPending, error, syncKb, refreshStatus };
}
