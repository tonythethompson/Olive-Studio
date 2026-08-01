/**
 * Unified application configuration module.
 *
 * Consolidates all config sources into a single typed module:
 *   1. On-disk config  — .olive-studio/config.json  (StudioConfig)
 *   2. Runtime overrides — AI provider, HF token, etc. (in-memory singletons)
 *   3. Environment      — process.env (API keys, flags)
 *
 * Usage:
 *   import { appConfig } from "../config.ts";
 *
 *   appConfig.aiProvider = { provider: "gemini", apiKey: "...", model: "..." };
 *   const py = appConfig.systemPython;  // reads from disk
 */

import path from "path";
import fs from "fs";
import type { ProviderConfig, StudioConfig } from "./types.ts";
import { getRuntimeAiProvider, setRuntimeAiProvider, clearRuntimeAiProvider } from "./services/ai/state.ts";

export type { StudioConfig };

export interface AppConfig {
  /** On-disk config persisted to .olive-studio/config.json. */
  systemPython?: string;
  /** Runtime AI provider override (cleared on restart). */
  aiProvider: ProviderConfig | null;
  /** Runtime HuggingFace token (cleared on restart). */
  hfToken: string | null;
}

// ─── Paths ────────────────────────────────────────────────────────────────────

const CONFIG_DIR = path.join(process.cwd(), ".olive-studio");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

// ─── On-disk persistence ─────────────────────────────────────────────────────

function readDiskConfig(): StudioConfig {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {};
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as StudioConfig;
  } catch {
    return {};
  }
}

function writeDiskConfig(patch: Partial<StudioConfig>): StudioConfig {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const next = { ...readDiskConfig(), ...patch };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), "utf-8");
  return next;
}

// ─── Runtime state (in-memory, cleared on restart) ────────────────────────────

let _hfToken: string | null = null;

// ─── Validation ───────────────────────────────────────────────────────────────

function isValidProvider(cfg: unknown): cfg is ProviderConfig {
  if (!cfg || typeof cfg !== "object") return false;
  const c = cfg as Record<string, unknown>;
  return typeof c.provider === "string" && typeof c.apiKey === "string" && typeof c.model === "string";
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Singleton application config with live getters/setters.
 * Read/write properties immediately persist to disk where applicable.
 */
export const appConfig = {
  // --- systemPython (disk-persisted) ---

  get systemPython(): string | undefined {
    return readDiskConfig().systemPython;
  },
  set systemPython(value: string | undefined) {
    writeDiskConfig({ systemPython: value });
    if (value) process.env.OLIVE_STUDIO_PYTHON = value;
  },

  // --- aiProvider (delegates to ai/state.ts singleton for consistency) ---

  get aiProvider(): ProviderConfig | null {
    return getRuntimeAiProvider();
  },
  set aiProvider(value: ProviderConfig | null) {
    if (value !== null && !isValidProvider(value)) {
      throw new Error(`Invalid ProviderConfig: ${JSON.stringify(value)}`);
    }
    setRuntimeAiProvider(value);
  },

  // --- hfToken (runtime, in-memory) ---

  get hfToken(): string | null {
    return _hfToken;
  },
  set hfToken(value: string | null) {
    if (value !== null && typeof value !== "string") {
      throw new Error("hfToken must be a string or null");
    }
    _hfToken = value;
  },

  // --- disk Persistence helpers (for backward compat) ---

  /** Read the full on-disk config. */
  readDisk(): StudioConfig {
    return readDiskConfig();
  },

  /** Merge a patch into the on-disk config and persist. */
  writeDisk(patch: Partial<StudioConfig>): StudioConfig {
    return writeDiskConfig(patch);
  },

  /** Clear all runtime state (disk config unaffected). */
  resetRuntime(): void {
    clearRuntimeAiProvider();
    _hfToken = null;
  },

  /** Return a snapshot of all config values. */
  snapshot(): AppConfig {
    return {
      systemPython: readDiskConfig().systemPython,
      aiProvider: getRuntimeAiProvider(),
      hfToken: _hfToken,
    };
  },
};

// Re-export for backward compatibility.
export const readStudioConfig = (): StudioConfig => readDiskConfig();
export const writeStudioConfig = (patch: Partial<StudioConfig>): StudioConfig => writeDiskConfig(patch);
