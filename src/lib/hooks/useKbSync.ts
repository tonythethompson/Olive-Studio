import { useState, useCallback, useEffect, useRef } from "react";

export interface KbStatus {
  available: boolean;
  version?: string;
  lastUpdated?: string | null;
  lastSync?: string | null;
  passCount?: number;
  error?: string;
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

/**
 * Converts the knowledge-base freshness timestamp to milliseconds since the Unix epoch.
 *
 * @param status - Knowledge-base status containing synchronization or catalog update timestamps
 * @returns The parsed timestamp in milliseconds, or `null` when no valid timestamp is available
 */
export function kbFreshnessMs(
  status: Pick<KbStatus, "lastSync" | "lastUpdated"> | null | undefined,
): number | null {
  const raw = status?.lastSync ?? status?.lastUpdated ?? null;
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
  const [status, setStatus] = useState<KbStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoSyncAttempted = useRef(false);

  const fetchStatus = useCallback(async (): Promise<KbStatus | null> => {
    try {
      const res = await fetch("/api/mcp/kb-status");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as KbStatus;
      setStatus(data);
      if (data.available === false) {
        setError(data.error ?? "Knowledge base unavailable");
      } else {
        setError(null);
      }
      return data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      return null;
    }
  }, []);

  const syncKb = useCallback(async (): Promise<KbSyncResult | null> => {
    setSyncing(true);
    setError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {};
      // Optional: set VITE_SYNC_KB_TOKEN when the server requires SYNC_KB_TOKEN.
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
        setError(detail);
        return { ...data, error: detail };
      }
      // Refresh status after successful sync
      await fetchStatus();
      return data;
    } catch (err: unknown) {
      const msg =
        err instanceof DOMException && err.name === "AbortError"
          ? "KB sync timed out"
          : err instanceof Error
            ? err.message
            : String(err);
      setError(msg);
      return { ok: false, error: msg };
    } finally {
      clearTimeout(timeout);
      setSyncing(false);
    }
  }, [fetchStatus]);

  useEffect(() => {
     
    void (async () => {
      const initial = await fetchStatus();
      if (autoSyncAttempted.current) return;
      autoSyncAttempted.current = true;
      if (initial?.available && isKbStatusStale(initial)) {
        await syncKb();
      }
    })();
    const interval = setInterval(() => void fetchStatus(), REFRESH_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void fetchStatus();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchStatus, syncKb]);

  return { status, syncing, error, syncKb, refreshStatus: fetchStatus };
}
