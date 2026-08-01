import { memo } from "react";
import { RefreshCw, Database, CheckCircle, AlertCircle } from "lucide-react";
import { useKbSync } from "@/lib/hooks/useKbSync";

export const KbSyncIndicator = memo(function KbSyncIndicator() {
  const { status, syncing, error, syncKb } = useKbSync();

  if (!status && !error) return null;

  // Prefer last successful network sync; fall back to catalog last_updated so a
  // bundled KB is not forever "stale" before the first manual sync.
  const freshnessSource = status?.lastSync ?? status?.lastUpdated ?? null;
  const syncTime = freshnessSource ? new Date(freshnessSource).getTime() : null;
  const isStale =
    syncTime == null || !Number.isFinite(syncTime) || Date.now() - syncTime > 7 * 24 * 60 * 60 * 1000;

  const staleTitle =
    syncTime == null
      ? "Pass catalog age unknown. Sync to refresh Olive pass docs from the official knowledge base."
      : `Pass catalog last updated ${new Date(syncTime).toLocaleString()}. Older than 7 days; sync to pull the latest Olive docs.`;

  return (
    <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400">
      <Database className="h-3 w-3 text-slate-500" aria-hidden />
      {status?.available ? (
        <>
          <span className="text-slate-400" title="Olive pass knowledge base used by the recipe builder">
            KB v{status.version} · {status.passCount} passes
          </span>
          {isStale ? (
            <span className="text-amber-500 flex items-center gap-0.5" title={staleTitle}>
              <AlertCircle className="h-3 w-3" aria-hidden />
              <span>KB stale</span>
            </span>
          ) : (
            <span
              className="text-emerald-500 flex items-center gap-0.5"
              title="Pass catalog synced within the last 7 days"
            >
              <CheckCircle className="h-3 w-3" aria-hidden />
              <span>KB fresh</span>
            </span>
          )}
          <button
            type="button"
            onClick={() => void syncKb()}
            disabled={syncing}
            className="ml-1 text-electric-blue hover:text-electric-blue/80 disabled:opacity-40 flex items-center gap-1 transition-colors"
            title="Pull the latest Olive pass docs into the local knowledge base"
            aria-label={syncing ? "Syncing knowledge base" : "Sync knowledge base"}
          >
            <span className={syncing ? "animate-spin" : ""}>
              <RefreshCw className="h-3 w-3" aria-hidden />
            </span>
            {syncing ? "syncing…" : "sync"}
          </button>
        </>
      ) : (
        <span className="text-amber-500" title="Local Olive pass catalog could not be loaded">
          KB unavailable
        </span>
      )}
      {error && <span className="text-red-400 truncate max-w-[200px]">{error}</span>}
    </div>
  );
});
