import { useEffect, useState, useCallback, useRef } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface ServerConnectionBannerProps {
  /** Optional polling interval in ms (default 10000ms). */
  checkIntervalMs?: number;
}

export function ServerConnectionBanner({ checkIntervalMs = 10000 }: ServerConnectionBannerProps) {
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const consecutiveFailuresRef = useRef(0);

  const abortControllerRef = useRef<AbortController | null>(null);

  const checkHealth = useCallback(async () => {
    // Abort any previous in-flight request
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsChecking(true);
    try {
      const res = await fetch("/api/health", {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(4000)]),
      });
      if (controller.signal.aborted) return;
      if (res.ok) {
        consecutiveFailuresRef.current = 0;
        setIsDisconnected(false);
      } else {
        consecutiveFailuresRef.current += 1;
        if (consecutiveFailuresRef.current >= 2) {
          setIsDisconnected(true);
        }
      }
    } catch {
      if (controller.signal.aborted) return;
      consecutiveFailuresRef.current += 1;
      if (consecutiveFailuresRef.current >= 2) {
        setIsDisconnected(true);
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsChecking(false);
      }
    }
  }, []);

  useEffect(() => {
    // Run an initial health check immediately on mount
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: initial health poll on mount
    void checkHealth();

    const interval = window.setInterval(() => {
      void checkHealth();
    }, checkIntervalMs);

    return () => {
      window.clearInterval(interval);
      // Abort any in-flight fetch on unmount to prevent state updates after cleanup
      abortControllerRef.current?.abort();
    };
  }, [checkHealth, checkIntervalMs]);

  if (!isDisconnected) return null;

  return (
    <aside
      aria-label="Server status alert"
      className="sticky top-0 inset-x-0 z-50 bg-rose-950/90 border-b border-rose-600/50 text-rose-200 px-4 py-2 flex items-center justify-between shadow-lg backdrop-blur-md animate-in slide-in-from-top duration-300"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 animate-pulse" />
        <p className="text-xs sm:text-sm font-medium truncate">
          Backend server disconnected. The Olive Studio service is not responding.
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="outline"
          className="h-7 text-xs border-rose-500/40 text-rose-200 hover:bg-rose-900/40 hover:text-white"
          onClick={() => void checkHealth()}
          disabled={isChecking}
        >
          <RefreshCw className={`h-3 w-3 mr-1.5 ${isChecking ? "animate-spin" : ""}`} />
          {isChecking ? "Checking…" : "Reconnect"}
        </Button>
      </div>
    </aside>
  );
}
