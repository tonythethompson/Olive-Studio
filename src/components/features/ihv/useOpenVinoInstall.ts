/**
 * OpenVINO stack install hook for the Hardware panel.
 *
 * Streams NDJSON from POST /api/env/install-openvino and refreshes the
 * hardware probe on success. Extracted from IHVIntegrationPanel so the
 * panel stays thinner and the install path is unit-testable in isolation.
 */
import { useCallback, useState } from "react";
import { runNdjsonInstall } from "@/lib/ndjsonInstall";

export interface UseOpenVinoInstallOptions {
  /** Called after a successful install (typically refresh=true hardware probe). */
  onProbeRefresh: (refresh?: boolean) => Promise<void>;
  /** True when another hardware install (TensorRT / TRT RTX) is already running. */
  isInstallBusy: boolean;
}

export interface OpenVinoInstallState {
  installing: boolean;
  error: string | null;
  log: string[];
}

/**
 * Manages OpenVINO stack installation UI state and the NDJSON install call.
 */
export function useOpenVinoInstall({
  onProbeRefresh,
  isInstallBusy,
}: UseOpenVinoInstallOptions): {
  state: OpenVinoInstallState;
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
      await runNdjsonInstall("/api/env/install-openvino", setLog);
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
