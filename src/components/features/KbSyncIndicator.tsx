import { memo } from "react";
import { RefreshCw, Database, CheckCircle, AlertCircle } from "lucide-react";
import { KB_STALE_AFTER_MS, isKbStatusStale, kbFreshnessMs, useKbSync } from "@/lib/hooks/useKbSync";

const STALE_AFTER_DAYS = Math.round(KB_STALE_AFTER_MS / 86_400_000);

export const KbSyncIndicator = memo(function KbSyncIndicator() {
  const { status, syncing, error, syncKb } = useKbSync();

  if (!status && !error) return null;

  const syncTime = kbFreshnessMs(status);
  const isStale = isKbStatusStale(status);

  const staleTitle =
    syncTime == null
      ? "Pass catalog age unknown. Sync to refresh Olive pass docs from the local knowledge base."
      : `Pass catalog last updated ${new Date(syncTime).toLocaleString()}. Older than ${STALE_AFTER_DAYS} days; sync to reload the local Olive docs.`;

  return (
    <div className="flex items-center gap-3 text-[11px] font-mono text-slate-400">
      <div className="flex items-center gap-1.5 min-w-0">
        <Database className="h-3 w-3 text-slate-500 shrink-0" aria-hidden />
        {status?.available ? (
          <span
            className="text-slate-400 truncate"
            title="Olive pass knowledge base used by the recipe builder"
          >
            KB v{status.version}
            <span className="text-slate-600"> · {status.passCount} passes</span>
          </span>
        ) : (
          <span className="text-amber-500" title="Local Olive pass catalog could not be loaded">
            KB unavailable
          </span>
        )}
      </div>
      {status?.available && (
        <>
          {isStale ? (
            <span className="text-amber-500 flex items-center gap-1 shrink-0" title={staleTitle}>
              <AlertCircle className="h-3 w-3" aria-hidden />
              <span>stale</span>
            </span>
          ) : (
            <span
              className="text-emerald-500 flex items-center gap-1 shrink-0"
              title={`Pass catalog synced within the last ${STALE_AFTER_DAYS} days`}
            >
              <CheckCircle className="h-3 w-3" aria-hidden />
              <span>fresh</span>
            </span>
          )}
          <button
            type="button"
            onClick={() => void syncKb()}
            disabled={syncing}
            className="text-electric-blue hover:text-electric-blue/80 disabled:opacity-40 flex items-center gap-1 transition-colors shrink-0"
            title="Reload Olive pass docs into the local knowledge base"
            aria-label={syncing ? "Syncing knowledge base" : "Sync knowledge base"}
          >
            <RefreshCw className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`} aria-hidden />
            {syncing ? "syncing…" : "sync"}
          </button>
        </>
      )}
      {error && <span className="text-red-400 truncate max-w-[160px]">{error}</span>}
    </div>
  );
});
