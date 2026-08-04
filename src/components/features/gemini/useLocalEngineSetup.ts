import { useState, useEffect, useCallback, useRef } from "react";
import type { LocalEngine } from "./aiProviderCatalog";
import {
  LMS_STARTER_MODELS,
  OLLAMA_STARTER_MODELS,
  findInstalledStarterId,
  resolveLocalEnableModelId,
} from "./aiProviderCatalog";

interface UseLocalEngineSetupOptions {
  isOpen: boolean;
  /** Called after a 1-click pull finishes so the provider status / audit can refresh. */
  onModelActivated: (modelTag: string, source: LocalEngine) => void | Promise<void>;
}

type InstallStreamEvent = {
  type?: string;
  message?: string;
  percent?: number;
  error?: string;
  openedUrl?: string;
  ok?: boolean;
};

type PullStreamEvent = {
  type?: string;
  message?: string;
  percent?: number;
  error?: string;
  hint?: string;
  ok?: boolean;
};

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

const clampPercent = (percent: number) => Math.max(0, Math.min(100, percent));

const joinErrorParts = (...parts: Array<string | undefined>) => parts.filter(Boolean).join(" - ");

async function readNdjsonLines(
  body: ReadableStream<Uint8Array>,
  onLine: (line: string) => void | Promise<void>,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      await onLine(line);
    }
  }
  return buf;
}

function describeInstallFetchError(err: unknown): string {
  if (err instanceof TypeError && /fetch/i.test(err.message)) {
    return "Failed to reach Olive Studio server. Keep pnpm dev / tauri:dev running, then retry.";
  }
  return err instanceof Error ? err.message : "Install failed";
}

function describePullFetchError(err: unknown, opts?: { userCancelled?: boolean }): string {
  if (opts?.userCancelled) return "Download cancelled.";
  if (err instanceof Error && err.name === "AbortError") {
    return "Download timed out or was cancelled. Large pulls can take several minutes — retry if needed.";
  }
  if (err instanceof TypeError && /fetch/i.test(err.message)) {
    return "Failed to reach Olive Studio server (Failed to fetch). Keep pnpm dev / tauri:dev running, then retry.";
  }
  return err instanceof Error ? err.message : "Failed to pull local model.";
}

async function fetchInstalledModelIds(engine: LocalEngine): Promise<string[]> {
  const endpoint = engine === "ollama" ? "/api/ai/ollama-models" : "/api/ai/local-models";
  try {
    const r = await fetch(endpoint);
    if (!r.ok) return [];
    const d = (await r.json()) as { installedModels?: string[] };
    return Array.isArray(d.installedModels) ? d.installedModels : [];
  } catch {
    return [];
  }
}

function starterForTag(downloadTag: string, source: LocalEngine) {
  const list = source === "ollama" ? OLLAMA_STARTER_MODELS : LMS_STARTER_MODELS;
  return list.find((m) => m.tag === downloadTag);
}

function preferredEnableTag(downloadTag: string, source: LocalEngine): string | undefined {
  return starterForTag(downloadTag, source)?.enableTag;
}

/**
 * Manages local AI engine selection, availability checks, installation, and model downloads.
 *
 * @param isOpen - Whether the local engine setup interface is open and should refresh engine status.
 * @param onModelActivated - Callback invoked with the model tag and engine source after a successful model download.
 */
export function useLocalEngineSetup({ isOpen, onModelActivated }: UseLocalEngineSetupOptions) {
  const [pullingModel, setPullingModel] = useState<string | null>(null);
  const [localPullError, setLocalPullError] = useState<string>("");
  const [localInstallInfo, setLocalInstallInfo] = useState<string | null>(null);
  /** 0–100 while 1-click pull streams progress; null when idle. */
  const [localPullPercent, setLocalPullPercent] = useState<number | null>(null);
  const [localPullLog, setLocalPullLog] = useState<string[]>([]);
  const [modelSizes, setModelSizes] = useState<Record<string, number>>({});
  const [installedModels, setInstalledModels] = useState<string[]>([]);
  const [ollamaHealthy, setOllamaHealthy] = useState<boolean | null>(null);
  const [lmsHealthy, setLmsHealthy] = useState<boolean | null>(null);
  const [lmsInstalled, setLmsInstalled] = useState<boolean | null>(null);
  const [installingEngine, setInstallingEngine] = useState<LocalEngine | null>(null);
  const [preferredEngine, setPreferredEngine] = useState<LocalEngine>(readStoredEngine);
  const pullAbortRef = useRef<AbortController | null>(null);
  const pullUserCancelledRef = useRef(false);

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

  const refreshInstalledModels = useCallback(
    async (engine: LocalEngine = preferredEngine) => {
      const ids = await fetchInstalledModelIds(engine);
      setInstalledModels(ids);
      return ids;
    },
    [preferredEngine],
  );

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
    void refreshInstalledModels(preferredEngine);
  }, [isOpen, preferredEngine, refreshInstalledModels]);

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

  const appendPullLog = (message: string) => {
    setLocalPullLog((prev) => [...prev.slice(-12), message]);
  };

  const handleInstallStreamEvent = (
    evt: InstallStreamEvent,
    state: { openedUrl?: string; ok: boolean; finalMsg: string },
  ) => {
    if (typeof evt.percent === "number") {
      setLocalPullPercent(clampPercent(evt.percent));
    }
    if (evt.message) {
      setLocalInstallInfo(evt.message);
      appendPullLog(evt.message);
    }
    if (evt.openedUrl) state.openedUrl = evt.openedUrl;
    if (evt.type === "error") {
      if (state.openedUrl || evt.openedUrl) {
        window.open(state.openedUrl || evt.openedUrl, "_blank", "noopener,noreferrer");
      }
      throw new Error(evt.error || evt.message || "Setup failed");
    }
    if (evt.type === "done") {
      state.ok = true;
      state.finalMsg = evt.message || state.finalMsg;
      setLocalPullPercent(100);
    }
  };

  const consumeInstallStream = async (body: ReadableStream<Uint8Array>, response: Response) => {
    const state = { openedUrl: undefined as string | undefined, ok: false, finalMsg: "Engine ready." };
    await readNdjsonLines(body, (line) => {
      try {
        handleInstallStreamEvent(JSON.parse(line) as InstallStreamEvent, state);
      } catch (e) {
        if (e instanceof Error && e.message !== "Setup failed" && !e.message.includes("JSON")) {
          throw e;
        }
      }
    });
    if (!state.ok && !response.ok) throw new Error(`Setup failed (HTTP ${response.status})`);
    setLocalInstallInfo(state.finalMsg);
  };

  const handleInstallJsonFallback = async (r: Response) => {
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
        await handleInstallJsonFallback(r);
      } else {
        await consumeInstallStream(r.body, r);
      }
      markEngineReady(engine);
    } catch (err: unknown) {
      setLocalPullError(describeInstallFetchError(err));
      setLocalInstallInfo(null);
    } finally {
      setInstallingEngine(null);
    }
  };

  const handlePullStreamEvent = (evt: PullStreamEvent, state: { gotDone: boolean; finalMessage: string }) => {
    if (typeof evt.percent === "number" && Number.isFinite(evt.percent)) {
      setLocalPullPercent(clampPercent(evt.percent));
    }
    if (evt.message) {
      setLocalInstallInfo(evt.message);
      if (evt.type === "log" || evt.type === "step" || evt.type === "progress") {
        appendPullLog(evt.message);
      }
    }
    if (evt.type === "error") {
      throw new Error(joinErrorParts(evt.error || "Pull failed", evt.hint));
    }
    if (evt.type === "done") {
      state.gotDone = true;
      state.finalMessage = evt.message || "Model ready.";
      setLocalPullPercent(100);
    }
  };

  const consumePullStream = async (r: Response) => {
    if (!r.ok && !r.body) {
      const data = (await r.json().catch(() => ({}))) as { error?: string; hint?: string };
      throw new Error(joinErrorParts(data.error || `HTTP ${r.status}`, data.hint));
    }
    if (!r.body) throw new Error(`Empty response (HTTP ${r.status})`);

    const state = { gotDone: false, finalMessage: "" };
    const buf = await readNdjsonLines(r.body, (line) => {
      try {
        handlePullStreamEvent(JSON.parse(line) as PullStreamEvent, state);
      } catch (e) {
        if (e instanceof SyntaxError) return;
        throw e;
      }
    });

    // Legacy JSON body (non-stream) if server ever falls back
    if (!state.gotDone && r.headers.get("content-type")?.includes("application/json") && buf.trim()) {
      const data = JSON.parse(buf) as { ok?: boolean; error?: string; message?: string };
      if (data.error) throw new Error(data.error);
      if (data.ok) {
        state.gotDone = true;
        state.finalMessage = data.message || "Model ready.";
      }
    }
    if (!state.gotDone && !r.ok) {
      throw new Error(`Pull failed (HTTP ${r.status})`);
    }

    setLocalInstallInfo(state.finalMessage || "Model ready.");
  };

  const cancelLocalPull = () => {
    pullUserCancelledRef.current = true;
    pullAbortRef.current?.abort();
    setLocalInstallInfo("Cancelling download…");
  };

  const pullLocalModel = async (modelTag: string, source: LocalEngine = "lms") => {
    if (pullAbortRef.current) {
      setLocalPullError("A download is already in progress. Cancel it first, or wait for it to finish.");
      return;
    }

    setPullingModel(modelTag);
    setLocalPullError("");
    setLocalPullPercent(null);
    setLocalPullLog([]);
    pullUserCancelledRef.current = false;

    try {
      const starter = starterForTag(modelTag, source);
      const installed = await refreshInstalledModels(source);
      const existing = findInstalledStarterId(
        {
          tag: modelTag,
          enableTag: starter?.enableTag ?? preferredEnableTag(modelTag, source) ?? modelTag,
          match: starter?.match ?? starter?.enableTag ?? modelTag,
        },
        installed,
      );
      if (existing) {
        setLocalPullPercent(100);
        setLocalInstallInfo(`Already installed — enabling ${existing}…`);
        await onModelActivated(existing, source);
        setLocalInstallInfo(`Ready: ${existing}`);
        return;
      }

      setLocalPullPercent(0);
      setLocalInstallInfo(
        source === "ollama"
          ? "Starting: ensure Ollama → serve → download…"
          : "Starting: ensure LM Studio → serve → download…",
      );

      const endpoint = source === "ollama" ? "/api/ai/ollama-pull" : "/api/ai/local-pull";
      const controller = new AbortController();
      pullAbortRef.current = controller;
      const timeout = setTimeout(() => controller.abort(), 12 * 60 * 1000);
      try {
        const r = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/x-ndjson, application/json",
          },
          body: JSON.stringify({ modelTag }),
          signal: controller.signal,
        });
        await consumePullStream(r);
      } finally {
        clearTimeout(timeout);
      }

      markEngineReady(source);
      const after = await refreshInstalledModels(source);
      const enableId = resolveLocalEnableModelId(
        modelTag,
        preferredEnableTag(modelTag, source),
        after,
      );
      setLocalInstallInfo(`Enabling ${enableId}…`);
      await onModelActivated(enableId, source);
      setLocalInstallInfo(`Ready: ${enableId}`);
    } catch (err: unknown) {
      setLocalPullError(
        describePullFetchError(err, { userCancelled: pullUserCancelledRef.current }),
      );
      setLocalInstallInfo(null);
    } finally {
      pullAbortRef.current = null;
      pullUserCancelledRef.current = false;
      setPullingModel(null);
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
    cancelLocalPull,
    localPullError,
    localInstallInfo,
    localPullPercent,
    localPullLog,
    modelSizes,
    installedModels,
    refreshInstalledModels,
  };
}

export type LocalEngineSetup = ReturnType<typeof useLocalEngineSetup>;
