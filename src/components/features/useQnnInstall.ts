/**
 * QNN 2.x plugin runtime install hook for the Hardware panel.
 *
 * Streams NDJSON from POST /api/env/install-qnn and refreshes the
 * hardware probe on success. Optional Test QNN NPU hits /api/env/test-qnn-npu.
 */
import { useCallback, useRef, useState } from "react";
import { runNdjsonInstall } from "@/lib/ndjsonInstall";

export interface UseQnnInstallOptions {
  onProbeRefresh: (refresh?: boolean) => Promise<void>;
  isInstallBusy: boolean;
}

export interface QnnInstallState {
  installing: boolean;
  testing: boolean;
  error: string | null;
  log: string[];
}

/**
 * Manages QNN runtime installation UI state and the NDJSON install call.
 */
export function useQnnInstall({
  onProbeRefresh,
  isInstallBusy,
}: UseQnnInstallOptions): {
  state: QnnInstallState;
  install: () => Promise<void>;
  testNpu: () => Promise<void>;
} {
  const [installing, setInstalling] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  /** Synchronous busy guard so same-tick double clicks cannot start two requests. */
  const busyRef = useRef(false);

  const install = useCallback(async () => {
    if (isInstallBusy || busyRef.current) return;
    busyRef.current = true;
    setInstalling(true);
    setError(null);
    setLog([]);
    try {
      await runNdjsonInstall("/api/env/install-qnn", setLog);
      await onProbeRefresh(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(
        msg === "Failed to fetch"
          ? "Could not reach the Olive Studio server (or the connection dropped during install). Keep pnpm dev running, then retry."
          : msg,
      );
    } finally {
      busyRef.current = false;
      setInstalling(false);
    }
  }, [isInstallBusy, onProbeRefresh]);

  const testNpu = useCallback(async () => {
    if (isInstallBusy || busyRef.current) return;
    busyRef.current = true;
    setTesting(true);
    setError(null);
    setLog([]);
    try {
      await runNdjsonInstall("/api/env/test-qnn-npu", setLog);
      await onProbeRefresh(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(
        msg === "Failed to fetch"
          ? "Could not reach the Olive Studio server during Test QNN NPU. Keep pnpm dev running, then retry."
          : msg,
      );
    } finally {
      busyRef.current = false;
      setTesting(false);
    }
  }, [isInstallBusy, onProbeRefresh]);

  return {
    state: { installing, testing, error, log },
    install,
    testNpu,
  };
}
