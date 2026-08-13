import { AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface StalenessIndicatorProps {
  /** Whether the current review findings are stale (fingerprint mismatch). */
  isStale: boolean;
  /** Callback to trigger a new review cycle. */
  onRefresh: () => void;
  /** Optional additional className for the wrapper element. */
  className?: string;
}

/**
 * Visual badge indicating that review findings are outdated relative to the
 * current workspace state. Renders nothing when findings are fresh.
 *
 * Displays a warning icon, "Results outdated" text, and a "Re-run review"
 * button that triggers a fresh review cycle via the provided callback.
 *
 * @see Requirements 3.3, 3.4
 */
export function StalenessIndicator({
  isStale,
  onRefresh,
  className,
}: StalenessIndicatorProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2",
        !isStale && "hidden",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      {isStale ? (
        <>
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
          <span className="text-xs font-medium text-amber-300">Results outdated</span>
          <button
            type="button"
            onClick={onRefresh}
            className="ml-auto inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-300 transition-colors hover:bg-amber-500/20 hover:text-amber-200 cursor-pointer"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            Re-run review
          </button>
        </>
      ) : null}
    </div>
  );
}
