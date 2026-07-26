import { memo } from "react";
import { RefreshCw, Database, CheckCircle, AlertCircle } from "lucide-react";
import { useKbSync } from "@/lib/hooks/useKbSync";

export const KbSyncIndicator = memo(function KbSyncIndicator() {
  const { status, syncing, error, syncKb } = useKbSync();

  if (!status && !error) return null;

  const isStale = status?.lastSync
    ? Date.now() - new Date(status.lastSync).getTime() > 7 * 24 * 60 * 60 * 1000
    : true;

  return (
    <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400">
      <Database className="h-3 w-3 text-slate-500" />
      {status && !error ? (
        <>
          <span className="text-slate-500">
            KB v{status.version} · {status.passCount} passes
          </span>
          {isStale ? (
            <span className="text-amber-500 flex items-center gap-0.5" title="Knowledge base may be outdated">
              <AlertCircle className="h-3 w-3" />
              stale
            </span>
          ) : (
            <span className="text-emerald-500 flex items-center gap-0.5" title="Knowledge base is up to date">
              <CheckCircle className="h-3 w-3" />
              fresh
            </span>
          )}
        </>
      ) : (
        <span className="text-amber-500">KB unavailable</span>
      )}
      <button
        onClick={() => void syncKb()}
        disabled={syncing}
        className="ml-1 text-electric-blue hover:text-electric-blue/80 disabled:opacity-40 flex items-center gap-1 transition-colors"
        title="Sync knowledge base from official Olive docs"
      >
        <RefreshCw className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`} />
        {syncing ? "syncing…" : "sync"}
      </button>
      {error && <span className="text-red-400 truncate max-w-[200px]">{error}</span>}
    </div>
  );
});
