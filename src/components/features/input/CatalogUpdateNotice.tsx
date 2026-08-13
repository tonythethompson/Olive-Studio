import { Info, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CatalogUpdateNoticeProps {
  /** Whether the catalog is stale (upstream SHA differs from stored). */
  isStale: boolean;
  /** Whether a catalog refresh is currently in progress. */
  isRefreshing: boolean;
  /** Callback to trigger a catalog refresh. */
  onRefresh: () => void;
  /** Optional current commit SHA (first 7 chars displayed). */
  currentSha?: string;
  /** Optional additional className for the wrapper element. */
  className?: string;
}

/**
 * Inline notification displayed when newer recipes are available in the
 * upstream catalog repository. Shows an "Update" button to trigger a refresh,
 * with a loading indicator while the refresh is in progress.
 *
 * Renders nothing when the catalog is up to date (`isStale` is false).
 *
 * @see Requirements 10.3, 10.4, 10.6
 */
export function CatalogUpdateNotice({
  isStale,
  isRefreshing,
  onRefresh,
  currentSha,
  className,
}: CatalogUpdateNoticeProps) {
  if (!isStale) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <Info className="h-4 w-4 shrink-0 text-blue-400" aria-hidden="true" />
      <span className="text-xs font-medium text-blue-300">
        New recipes available
      </span>
      {currentSha && (
        <span className="text-[10px] text-blue-400/70 font-mono">
          ({currentSha.slice(0, 7)})
        </span>
      )}
      {isRefreshing ? (
        <Loader2
          className="ml-auto h-3.5 w-3.5 animate-spin text-blue-400"
          aria-label="Refreshing catalog"
        />
      ) : (
        <button
          type="button"
          onClick={onRefresh}
          className="ml-auto inline-flex items-center gap-1 rounded border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[11px] font-bold text-blue-300 transition-colors hover:bg-blue-500/20 hover:text-blue-200 cursor-pointer"
        >
          <RefreshCw className="h-3 w-3" aria-hidden="true" />
          Update
        </button>
      )}
    </div>
  );
}
