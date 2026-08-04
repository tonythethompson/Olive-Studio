/**
 * OpenVINO stack install hook for the Hardware panel.
 *
 * Streams NDJSON from POST /api/env/install-openvino and refreshes the
 * hardware probe on success. Extracted from IHVIntegrationPanel so the
 * panel stays thinner and the install path is unit-testable in isolation.
 */
import { useCallback, useState } from "react";

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

async function runNdjsonInstall(
  url: string,
  setLog: (updater: string[] | ((prev: string[]) => string[])) => void,
): Promise<void> {
  const res = await fetch(url, { method: "POST" });
  const contentType = res.headers.get("content-type") ?? "";

  let ok = false;
  let error: string | undefined;

  if (contentType.includes("ndjson") && res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const line of parts) {
        if (!line.trim()) continue;
        let evt: { type?: string; message?: string; ok?: boolean; error?: string };
        try {
          evt = JSON.parse(line) as typeof evt;
        } catch {
          continue;
        }
        if (evt.type === "log" && evt.message) {
          setLog((prev) => [...prev, evt.message!]);
        } else if (evt.type === "done") {
          ok = res.ok && evt.ok === true;
          error = evt.error;
        }
      }
    }
  } else {
    const data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      lines?: string[];
      log?: string[];
    };
    const lines = data.lines ?? data.log;
    if (Array.isArray(lines)) setLog(lines);
    ok = res.ok && data.ok === true;
    error = data.error;
  }

  if (!ok) {
    throw new Error(error ?? `Install failed (HTTP ${res.status})`);
  }
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
