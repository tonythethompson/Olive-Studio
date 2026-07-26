import { useState, useCallback, useEffect } from "react";

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

export function useKbSync() {
  const [status, setStatus] = useState<KbStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/mcp/kb-status");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as KbStatus;
      setStatus(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  }, []);

  const syncKb = useCallback(async (): Promise<KbSyncResult | null> => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/mcp/sync-kb", { method: "POST" });
      const data = (await res.json()) as KbSyncResult;
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return data;
      }
      // Refresh status after successful sync
      await fetchStatus();
      return data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      return { ok: false, error: msg };
    } finally {
      setSyncing(false);
    }
  }, [fetchStatus]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  return { status, syncing, error, syncKb, refreshStatus: fetchStatus };
}
