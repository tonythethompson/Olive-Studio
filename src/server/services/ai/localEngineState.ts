/** Progress event emitted while ensuring a local engine is installed/running. */
export type EnsureProgressEvt = { type: string; message: string; percent?: number };

export type OllamaEnsureResult = { ok: boolean; error?: string; steps: string[] };
export type LmsEnsureResult = { ok: boolean; error?: string; openedUrl?: string; steps: string[] };

export interface LocalEngineRuntime {
  /** Cached `lms` CLI path (`undefined` = not probed yet, `null` = probed, missing). */
  cachedLmsCli: string | null | undefined;
  /** Timestamp of the last negative `lms` CLI probe (miss-cache TTL). */
  lmsCliMissAt: number;
  /** Single-flight: concurrent Setup / pull calls must not spawn multiple Ollama processes. */
  ollamaEnsureInFlight: Promise<OllamaEnsureResult> | null;
  /** Single-flight guard for LM Studio setup. */
  lmsEnsureInFlight: Promise<LmsEnsureResult> | null;
  /** Cooldown anchor for Ollama start attempts. */
  lastOllamaStartAt: number;
  /** One active `lms get` at a time (server-side single-flight). */
  lmsPullBusyTag: string | null;
  /** One active Ollama pull at a time (server-side single-flight). */
  ollamaPullBusyTag: string | null;
  ollamaProgressSubscribers: Set<(evt: EnsureProgressEvt) => void>;
  lmsProgressSubscribers: Set<(evt: EnsureProgressEvt) => void>;
}

function createLocalEngineRuntime(): LocalEngineRuntime {
  return {
    cachedLmsCli: undefined,
    lmsCliMissAt: 0,
    ollamaEnsureInFlight: null,
    lmsEnsureInFlight: null,
    lastOllamaStartAt: 0,
    lmsPullBusyTag: null,
    ollamaPullBusyTag: null,
    ollamaProgressSubscribers: new Set(),
    lmsProgressSubscribers: new Set(),
  };
}

/**
 * Encapsulated mutable runtime state for the local AI engines (LM Studio /
 * Ollama). Centralized here so tests can reset it without module tricks and
 * hot-reloads cannot fork hidden state.
 */
export const localEngineRuntime = createLocalEngineRuntime();

/** Restore pristine runtime state (test isolation / hot-reload safety). */
export function resetLocalEngineRuntime(): void {
  Object.assign(localEngineRuntime, createLocalEngineRuntime());
}
