/**
 * DirectML (onnxruntime-directml) install hook for the Hardware panel.
 *
 * Streams NDJSON from POST /api/env/install-directml and refreshes the
 * hardware probe on success. Mirrors useOpenVinoInstall for the default
 * Windows runtime family.
 */
import { useCallback, useState } from "react";
import { runNdjsonInstall } from "@/lib/ndjsonInstall";

export interface UseDirectMlInstallOptions {
  /** Called after a successful install (typically refresh=true hardware probe). */
  onProbeRefresh: (refresh?: boolean) => Promise<void>;
  /** True when another hardware install is already running. */
  isInstallBusy: boolean;
}

export interface DirectMlInstallState {
  installing: boolean;
  error: string | null;
  log: string[];
}

/**
 * Manages DirectML wheel installation UI state and the NDJSON install call.
 */
export function useDirectMlInstall({
  onProbeRefresh,
  isInstallBusy,
}: UseDirectMlInstallOptions): {
  state: DirectMlInstallState;
  install: () => Promise<void>;
} {
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const install = useCallback(async () => {
    if (isInstallBusy || installing) return;
    setInstalling(true);
    setError(null);
    setLog([]);
    try {
      await runNdjsonInstall("/api/env/install-directml", setLog);
      await onProbeRefresh(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(
        msg === "Failed to fetch"
          ? "Could not reach the Olive Studio server (or the connection dropped during install). Keep pnpm dev running, then retry."
          : msg,
      );
    } finally {
      setInstalling(false);
    }
  }, [isInstallBusy, installing, onProbeRefresh]);

  return {
    state: { installing, error, log },
    install,
  };
}
