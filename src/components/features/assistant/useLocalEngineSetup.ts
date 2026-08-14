import { useState, useEffect, useCallback, useRef } from "react";
import { openExternal } from "@/lib/openExternal";
import {
  LMS_STARTER_MODELS,
  OLLAMA_STARTER_MODELS,
  findInstalledStarterId,
  resolveLocalEnableModelId,
  type LocalEngine,
} from "./aiProviderCatalog";

interface UseLocalEngineSetupOptions {
  isOpen: boolean;
  /** Called after a 1-click pull finishes so the provider status / audit can refresh. */
  onModelActivated: (modelTag: string, source: LocalEngine, signal?: AbortSignal) => void | Promise<void>;
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
  modelId?: string;
  verified?: boolean;
};

type PullState = {
  gotDone: boolean;
  finalMessage: string;
  modelId?: string;
  verified?: boolean;
};

type PullMeta = Pick<PullState, "modelId" | "verified">;

function isPullDownloadPhaseEvent(evt: PullStreamEvent): boolean {
  return (
    evt.type === "progress" ||
    evt.type === "log" ||
    (evt.type === "step" && /download|pulling/i.test(evt.message ?? ""))
  );
}

function isPullLogEvent(evt: PullStreamEvent): boolean {
  return evt.type === "log" || evt.type === "step" || evt.type === "progress";
}

function isCurrentPullController(
  controller: AbortController,
  activeController: AbortController | null,
): boolean {
  return !controller.signal.aborted && activeController === controller;
}

function applyPullCompletion(evt: PullStreamEvent, state: PullState): void {
  state.gotDone = true;
  state.finalMessage = evt.message || "Model ready.";
  if (typeof evt.modelId === "string" && evt.modelId.trim()) state.modelId = evt.modelId.trim();
  if (typeof evt.verified === "boolean") state.verified = evt.verified;
}

function applyLegacyPullBody(
  body: string,
  response: Response,
  state: PullState,
  onDownloadPhase?: () => void,
): void {
  if (!state.gotDone && response.headers.get("content-type")?.includes("application/json") && body.trim()) {
    const data = JSON.parse(body) as {
      ok?: boolean;
      error?: string;
      message?: string;
      modelId?: string;
      verified?: boolean;
    };
    if (data.error) throw new Error(data.error);
    if (data.ok) {
      state.gotDone = true;
      state.finalMessage = data.message || "Model ready.";
      if (data.modelId) state.modelId = data.modelId;
      if (typeof data.verified === "boolean") state.verified = data.verified;
      onDownloadPhase?.();
    }
  }
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
  const pullCompletionRef = useRef<Promise<void> | null>(null);
  const resolvePullCompletionRef = useRef<(() => void) | null>(null);
  const pullUserCancelledRef = useRef(false);

  /**
   * Returns true when this controller is no longer the active pull — either
   * because the user cancelled it (abort) or a newer pull superseded it.
   * All async continuations must bail when stale to avoid overwriting
   * the newer pull's UI state.
   */
  const isStale = (controller: AbortController): boolean =>
    !isCurrentPullController(controller, pullAbortRef.current);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      const urlToOpen = state.openedUrl || evt.openedUrl;
      if (urlToOpen) {
        void openExternal(urlToOpen);
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
      if (data.openedUrl) void openExternal(data.openedUrl);
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

  const handlePullStreamEvent = (
    evt: PullStreamEvent,
    state: PullState,
    onDownloadPhase?: () => void,
    controller?: AbortController,
  ) => {
    if (controller && isStale(controller)) return;
    // Server only starts its 20m lms get / ollama timer after ensure*; arm ours then too.
    if (isPullDownloadPhaseEvent(evt)) onDownloadPhase?.();
    if (typeof evt.percent === "number" && Number.isFinite(evt.percent)) {
      setLocalPullPercent(clampPercent(evt.percent));
    }
    if (evt.message) {
      setLocalInstallInfo(evt.message);
      if (isPullLogEvent(evt)) appendPullLog(evt.message);
    }
    if (evt.type === "error") {
      throw new Error(joinErrorParts(evt.error || "Pull failed", evt.hint));
    }
    if (evt.type === "done") {
      applyPullCompletion(evt, state);
      setLocalPullPercent(100);
    }
  };

  const consumePullStream = async (
    r: Response,
    controller: AbortController,
    onDownloadPhase?: () => void,
  ): Promise<PullMeta> => {
    if (!r.ok && !r.body) {
      const data = (await r.json().catch(() => ({}))) as { error?: string; hint?: string };
      throw new Error(joinErrorParts(data.error || `HTTP ${r.status}`, data.hint));
    }
    if (!r.body) throw new Error(`Empty response (HTTP ${r.status})`);

    const state: PullState = {
      gotDone: false,
      finalMessage: "",
    };
    const buf = await readNdjsonLines(r.body, (line) => {
      try {
        handlePullStreamEvent(JSON.parse(line) as PullStreamEvent, state, onDownloadPhase, controller);
      } catch (e) {
        if (e instanceof SyntaxError) return;
        throw e;
      }
    });

    // Bail early if this controller became stale while the stream was being consumed.
    if (isStale(controller)) return {};

    // Legacy JSON body (non-stream) if server ever falls back.
    applyLegacyPullBody(buf, r, state, onDownloadPhase);
    if (!state.gotDone && !r.ok) {
      throw new Error(`Pull failed (HTTP ${r.status})`);
    }

    if (isStale(controller)) return {};
    setLocalInstallInfo(state.finalMessage || "Model ready.");
    return { modelId: state.modelId, verified: state.verified };
  };

  const runModelPull = async (
    modelTag: string,
    source: LocalEngine,
    controller: AbortController,
  ): Promise<PullMeta> => {
    const endpoint = source === "ollama" ? "/api/ai/ollama-pull" : "/api/ai/local-pull";
    // Align the 20m abort with the server's lms get / ollama pull timer (starts after ensure*).
    const DOWNLOAD_MAX_MS = 20 * 60 * 1000;
    // Cap hung ensure/install so a stuck startup cannot stream forever.
    const ENSURE_PHASE_MAX_MS = 15 * 60 * 1000;
    let downloadTimer: ReturnType<typeof setTimeout> | undefined;
    const ensureTimer = setTimeout(() => {
      if (!downloadTimer) controller.abort();
    }, ENSURE_PHASE_MAX_MS);
    const armDownloadTimeout = () => {
      if (downloadTimer) return;
      clearTimeout(ensureTimer);
      downloadTimer = setTimeout(() => controller.abort(), DOWNLOAD_MAX_MS);
    };

    try {
      if (isStale(controller)) return {};
      const r = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson, application/json",
        },
        body: JSON.stringify({ modelTag }),
        signal: controller.signal,
      });
      if (isStale(controller)) return {};
      return await consumePullStream(r, controller, armDownloadTimeout);
    } finally {
      clearTimeout(ensureTimer);
      if (downloadTimer) clearTimeout(downloadTimer);
    }
  };

  const cancelLocalPull = () => {
    pullUserCancelledRef.current = true;
    pullAbortRef.current?.abort();
    // Keep the controller until the aborted request has fully unwound. A retry
    // requested during that window waits for server-side process teardown, so
    // it cannot be rejected by the LM Studio busy gate or overlap the old pull.
    setPullingModel(null);
    setLocalPullPercent(null);
    setLocalInstallInfo(null);
    setLocalPullError("Download cancelled.");
  };

  const waitForPullSlot = async (): Promise<boolean> => {
    if (!pullAbortRef.current) return true;
    if (pullUserCancelledRef.current && pullCompletionRef.current) {
      await pullCompletionRef.current;
      return !pullAbortRef.current;
    }
    setLocalPullError("A download is already in progress. Cancel it first, or wait for it to finish.");
    return false;
  };

  const activateExistingPull = async (
    modelId: string,
    source: LocalEngine,
    controller: AbortController,
  ): Promise<void> => {
    // Skip activation — a newer pull has started or this one was cancelled.
    if (isStale(controller)) return;
    setLocalPullPercent(100);
    setLocalInstallInfo(`Already installed — enabling ${modelId}…`);
    await onModelActivated(modelId, source, controller.signal);
    // A newer pull may have started while activation was in flight — don't overwrite its state.
    if (isStale(controller)) return;
    setLocalInstallInfo(`Ready: ${modelId}`);
  };

  const activateDownloadedPull = async (
    modelTag: string,
    source: LocalEngine,
    starter: ReturnType<typeof starterForTag>,
    pullMeta: PullMeta,
    controller: AbortController,
  ): Promise<void> => {
    if (isStale(controller)) return;
    markEngineReady(source);
    const after = await refreshInstalledModels(source);
    if (isStale(controller)) return;
    const found = findInstalledStarterId(
      {
        tag: modelTag,
        enableTag: starter?.enableTag ?? preferredEnableTag(modelTag, source) ?? modelTag,
        match: starter?.match ?? starter?.enableTag ?? modelTag,
      },
      after,
    );
    const enableId =
      found ??
      (pullMeta.modelId && after.includes(pullMeta.modelId) ? pullMeta.modelId : undefined) ??
      (pullMeta.verified && pullMeta.modelId ? pullMeta.modelId : undefined);
    if (!enableId) {
      const expected =
        pullMeta.modelId ||
        preferredEnableTag(modelTag, source) ||
        resolveLocalEnableModelId(modelTag, preferredEnableTag(modelTag, source), after);
      throw new Error(
        joinErrorParts(
          `Download finished but the model did not appear in ${source === "ollama" ? "Ollama" : "LM Studio"}`,
          `Expected something like "${expected}". Click Refresh under Installed models, then Enable.`,
        ),
      );
    }
    setLocalInstallInfo(`Enabling ${enableId}…`);
    // Skip activation — a newer pull superseded this one or it was cancelled.
    if (isStale(controller)) return;
    await onModelActivated(enableId, source, controller.signal);
    // A newer pull may have started while activation was in flight — don't overwrite its state.
    if (isStale(controller)) return;
    setLocalInstallInfo(`Ready: ${enableId}`);
  };

  const executePullLocalModel = async (
    modelTag: string,
    source: LocalEngine,
    controller: AbortController,
  ): Promise<void> => {
    const starter = starterForTag(modelTag, source);
    const installed = await refreshInstalledModels(source);
    if (isStale(controller)) return;
    const existing = findInstalledStarterId(
      {
        tag: modelTag,
        enableTag: starter?.enableTag ?? preferredEnableTag(modelTag, source) ?? modelTag,
        match: starter?.match ?? starter?.enableTag ?? modelTag,
      },
      installed,
    );
    if (existing) {
      await activateExistingPull(existing, source, controller);
      return;
    }

    setLocalPullPercent(0);
    setLocalInstallInfo(
      source === "ollama"
        ? "Starting: ensure Ollama → serve → download…"
        : "Starting: ensure LM Studio → serve → download…",
    );
    const pullMeta = await runModelPull(modelTag, source, controller);
    await activateDownloadedPull(modelTag, source, starter, pullMeta, controller);
  };

  const pullLocalModel = async (modelTag: string, source: LocalEngine = "lms") => {
    if (!(await waitForPullSlot())) return;

    const controller = new AbortController();
    pullAbortRef.current = controller;
    pullCompletionRef.current = new Promise<void>((resolve) => {
      resolvePullCompletionRef.current = resolve;
    });

    setPullingModel(modelTag);
    setLocalPullError("");
    setLocalPullPercent(null);
    setLocalPullLog([]);
    pullUserCancelledRef.current = false;

    try {
      await executePullLocalModel(modelTag, source, controller);
    } catch (err: unknown) {
      // Suppress only when a *newer* pull superseded this controller, or the user
      // explicitly cancelled (cancelLocalPull already set error state synchronously).
      // An internal timeout (ensure/download timer) aborts the signal but this
      // controller is still active — let the error surface so the user sees guidance.
      const superseded = pullAbortRef.current !== controller;
      if (superseded || pullUserCancelledRef.current) return;
      setLocalPullError(
        describePullFetchError(err, { userCancelled: false }),
      );
      setLocalInstallInfo(null);
    } finally {
      if (pullAbortRef.current === controller) {
        pullAbortRef.current = null;
        pullCompletionRef.current = null;
        pullUserCancelledRef.current = false;
        setPullingModel(null);
      }
      if (resolvePullCompletionRef.current) {
        resolvePullCompletionRef.current();
        resolvePullCompletionRef.current = null;
      }
    }
  };

  /** Load an already-installed model into the engine, then activate it for chat. */
  const enableInstalledModel = async (modelTag: string, source: LocalEngine = preferredEngine) => {
    setLocalPullError("");
    setLocalInstallInfo(`Loading ${modelTag}…`);
    try {
      const endpoint = source === "ollama" ? "/api/ai/ollama-load" : "/api/ai/local-load";
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelTag }),
      });
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      setLocalInstallInfo(`Enabling ${modelTag}…`);
      await onModelActivated(modelTag, source);
      await refreshInstalledModels(source);
      setLocalInstallInfo(`Ready: ${modelTag}`);
    } catch (err: unknown) {
      setLocalPullError(err instanceof Error ? err.message : String(err));
      setLocalInstallInfo(null);
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
    enableInstalledModel,
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
