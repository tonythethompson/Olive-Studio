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
    <div className="flex items-center gap-2 text-[clamp(0.625rem,0.55rem+0.3vw,0.75rem)] font-mono text-slate-400">
      <div className="flex items-center gap-1.5 min-w-0">
        <Database className="h-3 w-3 text-slate-500 shrink-0" aria-hidden />
        {status?.available ? (
          <>
            <span
              className="text-slate-400 truncate hidden wide:inline"
              title="Olive pass knowledge base used by the recipe builder"
              aria-hidden="true"
            >
              KB v{status.version}
              <span className="text-slate-600"> · {status.passCount} passes</span>
            </span>
            <span className="sr-only">
              Knowledge base available: version {status.version} with {status.passCount} passes.
            </span>
          </>
        ) : (
          <>
            <span
              className="text-amber-500"
              title={
                status?.reason
                  ? `Local Olive pass catalog unavailable (${status.reason})${status.error ? `: ${status.error}` : ""}`
                  : error || "Local Olive pass catalog could not be loaded"
              }
              aria-hidden="true"
            >
              <span className="hidden wide:inline">
                KB unavailable{status?.reason ? ` · ${status.reason}` : ""}
              </span>
              <span className="wide:hidden">KB!</span>
            </span>
            <span className="sr-only">
              Knowledge base unavailable{status?.reason ? `: ${status.reason}` : ""}.
            </span>
          </>
        )}
      </div>
      {status?.available && (
        <>
          {isStale ? (
            <>
              <span
                className="text-amber-500 flex items-center gap-1 shrink-0"
                title={staleTitle}
                aria-hidden="true"
              >
                <AlertCircle className="h-3 w-3" aria-hidden />
                <span className="hidden wide:inline">stale</span>
              </span>
              <span className="sr-only">Knowledge base is stale.</span>
            </>
          ) : (
            <>
              <span
                className="text-emerald-500 flex items-center gap-1 shrink-0"
                title={`Pass catalog synced within the last ${STALE_AFTER_DAYS} days`}
                aria-hidden="true"
              >
                <CheckCircle className="h-3 w-3" aria-hidden />
                <span className="hidden wide:inline">fresh</span>
              </span>
              <span className="sr-only">Knowledge base is fresh.</span>
            </>
          )}
          <button
            type="button"
            onClick={() => void syncKb()}
            disabled={syncing}
            className="text-electric-blue hover:text-electric-blue/80 disabled:opacity-40 flex items-center gap-0 wide:gap-1 transition-colors shrink-0"
            title="Reload Olive pass docs into the local knowledge base"
            aria-label={syncing ? "Syncing knowledge base" : "Sync knowledge base"}
          >
            <RefreshCw className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`} aria-hidden />
            <span className="hidden wide:inline">{syncing ? "syncing…" : "sync"}</span>
          </button>
        </>
      )}
      {error && <span className="text-red-400 truncate max-w-[160px]">{error}</span>}
    </div>
  );
});
