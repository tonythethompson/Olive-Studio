import { useState, useEffect } from "react";
import type { LocalEngine } from "./aiProviderCatalog";

interface UseLocalEngineSetupOptions {
  isOpen: boolean;
  /** Called after a 1-click pull finishes so the provider status / audit can refresh. */
  onModelActivated: () => void | Promise<void>;
}

function readStoredEngine(): LocalEngine {
  try {
    const stored = localStorage.getItem("localEngine");
    if (stored === "lms" || stored === "ollama") {
      return stored;
    }
    return "lms";
  } catch {
    return "lms";
  }
}

/**
 * Owns the "1-Click Local AI Setup" flows: engine preference, engine health,
 * installing LM Studio / Ollama, and streaming model pulls.
 */
export function useLocalEngineSetup({ isOpen, onModelActivated }: UseLocalEngineSetupOptions) {
  const [pullingModel, setPullingModel] = useState<string | null>(null);
  const [localPullError, setLocalPullError] = useState<string>("");
  const [localInstallInfo, setLocalInstallInfo] = useState<string | null>(null);
  /** 0–100 while 1-click pull streams progress; null when idle. */
  const [localPullPercent, setLocalPullPercent] = useState<number | null>(null);
  const [localPullLog, setLocalPullLog] = useState<string[]>([]);
  const [modelSizes, setModelSizes] = useState<Record<string, number>>({});
  const [ollamaHealthy, setOllamaHealthy] = useState<boolean | null>(null);
  const [lmsHealthy, setLmsHealthy] = useState<boolean | null>(null);
  const [lmsInstalled, setLmsInstalled] = useState<boolean | null>(null);
  const [installingEngine, setInstallingEngine] = useState<LocalEngine | null>(null);
  const [preferredEngine, setPreferredEngine] = useState<LocalEngine>(readStoredEngine);

  const selectPreferredEngine = (engine: LocalEngine) => {
    setPreferredEngine(engine);
    setLocalPullError("");
    setLocalInstallInfo(null);
    try {
      localStorage.setItem("localEngine", engine);
    } catch {
      /* ignore */
    }
  };

  // Engine health when sidebar opens (only surface the active tab's status)
  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/ai/ollama-health")
      .then((r) => r.json())
      .then((d) => setOllamaHealthy(d.healthy ?? false))
      .catch(() => setOllamaHealthy(false));
    fetch("/api/ai/local-health")
      .then((r) => r.json())
      .then((d: { healthy?: boolean; lmsInstalled?: boolean }) => {
        setLmsHealthy(d.healthy ?? false);
        setLmsInstalled(d.lmsInstalled ?? false);
      })
      .catch(() => {
        setLmsHealthy(false);
        setLmsInstalled(false);
      });
  }, [isOpen, preferredEngine]);

  // Fetch model sizes from both LM Studio and Ollama on mount
  useEffect(() => {
    Promise.allSettled([
      fetch("/api/ai/local-model-sizes").then((r) => r.json()),
      fetch("/api/ai/ollama-model-sizes").then((r) => r.json()),
    ])
      .then(([lmsRes, ollamaRes]) => {
        const merged: Record<string, number> = {};
        if (lmsRes.status === "fulfilled") {
          const d = lmsRes.value as { sizes?: Record<string, number> };
          if (d.sizes) Object.assign(merged, d.sizes);
        }
        if (ollamaRes.status === "fulfilled") {
          const d = ollamaRes.value as { sizes?: Record<string, number> };
          if (d.sizes) Object.assign(merged, d.sizes);
        }
        setModelSizes(merged);
      })
      .catch(() => {});
  }, []);

  const markEngineReady = (engine: LocalEngine) => {
    if (engine === "ollama") setOllamaHealthy(true);
    else {
      setLmsHealthy(true);
      setLmsInstalled(true);
    }
  };

  const installEngine = async (engine: LocalEngine) => {
    setInstallingEngine(engine);
    setLocalPullError("");
    setLocalPullPercent(0);
    setLocalPullLog([]);
    setLocalInstallInfo(
      engine === "ollama"
        ? "Installing/starting Ollama automatically…"
        : "Installing/starting LM Studio automatically…",
    );
    try {
      const r = await fetch("/api/ai/install-engine", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson, application/json",
        },
        body: JSON.stringify({ engine }),
      });
      if (!r.body) {
        const data = (await r.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          message?: string;
          openedUrl?: string;
        };
        if (!r.ok || !data.ok) {
          if (data.openedUrl) window.open(data.openedUrl, "_blank", "noopener,noreferrer");
          throw new Error(data.error || data.message || `HTTP ${r.status}`);
        }
        setLocalInstallInfo(data.message || "Engine ready.");
      } else {
        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let ok = false;
        let finalMsg = "Engine ready.";
        let openedUrl: string | undefined;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const evt = JSON.parse(line) as {
                type?: string;
                message?: string;
                percent?: number;
                error?: string;
                openedUrl?: string;
                ok?: boolean;
              };
              if (typeof evt.percent === "number") {
                setLocalPullPercent(Math.max(0, Math.min(100, evt.percent)));
              }
              if (evt.message) {
                setLocalInstallInfo(evt.message);
                setLocalPullLog((prev) => [...prev.slice(-12), evt.message!]);
              }
              if (evt.openedUrl) openedUrl = evt.openedUrl;
              if (evt.type === "error") {
                if (openedUrl || evt.openedUrl) {
                  window.open(openedUrl || evt.openedUrl, "_blank", "noopener,noreferrer");
                }
                throw new Error(evt.error || evt.message || "Setup failed");
              }
              if (evt.type === "done") {
                ok = true;
                finalMsg = evt.message || finalMsg;
                setLocalPullPercent(100);
              }
            } catch (e) {
              if (e instanceof Error && e.message !== "Setup failed" && !e.message.includes("JSON")) {
                throw e;
              }
            }
          }
        }
        if (!ok && !r.ok) throw new Error(`Setup failed (HTTP ${r.status})`);
        setLocalInstallInfo(finalMsg);
      }
      markEngineReady(engine);
    } catch (err: unknown) {
      if (err instanceof TypeError && /fetch/i.test(err.message)) {
        setLocalPullError(
          "Failed to reach Olive Studio server. Keep pnpm dev / tauri:dev running, then retry.",
        );
      } else {
        setLocalPullError(err instanceof Error ? err.message : "Install failed");
      }
      setLocalInstallInfo(null);
    } finally {
      setInstallingEngine(null);
    }
  };

  const pullLocalModel = async (modelTag: string, source: LocalEngine = "lms") => {
    setPullingModel(modelTag);
    setLocalPullError("");
    setLocalPullPercent(0);
    setLocalPullLog([]);
    setLocalInstallInfo(
      source === "ollama"
        ? "Starting: ensure Ollama → serve → download…"
        : "Starting: ensure LM Studio → serve → download…",
    );
    try {
      const endpoint = source === "ollama" ? "/api/ai/ollama-pull" : "/api/ai/local-pull";
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12 * 60 * 1000);
      let r: Response;
      try {
        r = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/x-ndjson, application/json",
          },
          body: JSON.stringify({ modelTag }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!r.ok && !r.body) {
        const data = (await r.json().catch(() => ({}))) as { error?: string; hint?: string };
        throw new Error([data.error || `HTTP ${r.status}`, data.hint].filter(Boolean).join(" — "));
      }
      if (!r.body) throw new Error(`Empty response (HTTP ${r.status})`);

      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let gotDone = false;
      let finalMessage = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt: {
            type?: string;
            message?: string;
            percent?: number;
            error?: string;
            hint?: string;
            ok?: boolean;
          };
          try {
            evt = JSON.parse(line) as typeof evt;
          } catch {
            continue;
          }
          if (typeof evt.percent === "number" && Number.isFinite(evt.percent)) {
            setLocalPullPercent(Math.max(0, Math.min(100, evt.percent)));
          }
          if (evt.message) {
            setLocalInstallInfo(evt.message);
            if (evt.type === "log" || evt.type === "step" || evt.type === "progress") {
              setLocalPullLog((prev) => [...prev.slice(-12), evt.message!]);
            }
          }
          if (evt.type === "error") {
            throw new Error([evt.error || "Pull failed", evt.hint].filter(Boolean).join(" — "));
          }
          if (evt.type === "done") {
            gotDone = true;
            finalMessage = evt.message || "Model ready.";
            setLocalPullPercent(100);
          }
        }
      }

      // Legacy JSON body (non-stream) if server ever falls back
      if (!gotDone && r.headers.get("content-type")?.includes("application/json") && buf.trim()) {
        const data = JSON.parse(buf) as { ok?: boolean; error?: string; message?: string };
        if (data.error) throw new Error(data.error);
        if (data.ok) {
          gotDone = true;
          finalMessage = data.message || "Model ready.";
        }
      }
      if (!gotDone && !r.ok) {
        throw new Error(`Pull failed (HTTP ${r.status})`);
      }

      setLocalInstallInfo(finalMessage || "Model ready.");
      markEngineReady(source);
      await onModelActivated();
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        setLocalPullError(
          "Download timed out (install + pull can take several minutes). Retry once the engine is installed.",
        );
      } else if (err instanceof TypeError && /fetch/i.test(err.message)) {
        setLocalPullError(
          "Failed to reach Olive Studio server (Failed to fetch). Keep pnpm dev / tauri:dev running, then retry.",
        );
      } else {
        setLocalPullError(err instanceof Error ? err.message : "Failed to pull local model.");
      }
      setLocalInstallInfo(null);
    } finally {
      setPullingModel(null);
      // Keep last percent visible briefly when done; clear on next pull
    }
  };

  return {
    preferredEngine,
    selectPreferredEngine,
    ollamaHealthy,
    lmsHealthy,
    lmsInstalled,
    installingEngine,
    installEngine,
    pullingModel,
    pullLocalModel,
    localPullError,
    localInstallInfo,
    localPullPercent,
    localPullLog,
    modelSizes,
  };
}

export type LocalEngineSetup = ReturnType<typeof useLocalEngineSetup>;
