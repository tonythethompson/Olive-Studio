/**
 * Feature flag infrastructure for gating experimental features.
 * Flags are read from Vite env vars, URL query params (?flagName=1), and localStorage.
 * Zero runtime cost when flags are off — checks are simple boolean reads.
 */

export type FlagKey = "multiLora" | "lazyCatalog" | "batchComparison" | "reportExport";

// ─── Named Flag Constants ────────────────────────────────────────────────────

/** Constant for the MultiLoRA feature flag key. */
export const FEATURE_FLAG_MULTI_LORA: FlagKey = "multiLora";

interface FlagDefinition {
  key: FlagKey;
  description: string;
  defaultEnabled: boolean;
}

const FLAG_DEFINITIONS: FlagDefinition[] = [
  {
    key: "multiLora",
    description: "Multi-LoRA UI and docs visibility (experimental; Olive >= 0.3.0 required for execution)",
    defaultEnabled: false,
  },
  {
    key: "lazyCatalog",
    description: "Lazy-load recipe catalog from server instead of static bundle",
    defaultEnabled: false,
  },
  {
    key: "batchComparison",
    description: "Multi-model batch comparison view with charts",
    defaultEnabled: true,
  },
  { key: "reportExport", description: "Export optimization reports as Markdown/PDF", defaultEnabled: true },
];

const STORAGE_PREFIX = "olive:flag:";

/**
 * Maps FlagKey → Vite env var name (VITE_FEATURE_<SCREAMING_SNAKE>).
 * Only flags with an env-var mapping are listed here.
 */
const FLAG_ENV_VARS: Partial<Record<FlagKey, string>> = {
  multiLora: "VITE_FEATURE_MULTI_LORA",
};

function readEnvVar(key: FlagKey): boolean | null {
  try {
    const envKey = FLAG_ENV_VARS[key];
    if (!envKey) return null;
    // Vite exposes env vars on import.meta.env at build time.
    if (typeof import.meta !== "undefined" && import.meta.env) {
      const val = import.meta.env[envKey];
      // Vite may inline boolean values directly (e.g. VITE_FEATURE_X=true in .env)
      if (typeof val === "boolean") return val;
      if (val === "true" || val === "1") return true;
      if (val === "false" || val === "0") return false;
    }
  } catch {
    // SSR / non-browser / env not available
  }
  return null;
}

function readUrlParam(key: string): boolean | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const val = params.get(key);
    if (val === "1" || val === "true") return true;
    if (val === "0" || val === "false") return false;
  } catch {
    // SSR / non-browser
  }
  return null;
}

function readStorage(key: string): boolean | null {
  try {
    const val = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (val === "1") return true;
    if (val === "0") return false;
  } catch {
    // noop
  }
  return null;
}

/**
 * Check if a feature flag is enabled.
 * Priority: URL param > localStorage > env var (build-time) > default.
 *
 * The env var is the lowest-priority fallback so that runtime overrides
 * (URL param, localStorage) take precedence over build-time settings,
 * preserving runtime overrides when the environment flag is false.
 */
export function isFeatureEnabled(key: FlagKey): boolean {
  const urlVal = readUrlParam(key);
  if (urlVal !== null) return urlVal;

  const storageVal = readStorage(key);
  if (storageVal !== null) return storageVal;

  const envVal = readEnvVar(key);
  if (envVal !== null) return envVal;

  const def = FLAG_DEFINITIONS.find((d) => d.key === key);
  return def?.defaultEnabled ?? false;
}

/**
 * Convenience check for the MultiLoRA feature flag.
 *
 * Enabled via:
 * - Build-time env var: `VITE_FEATURE_MULTI_LORA=true`
 * - URL param: `?multiLora=1`
 * - localStorage key: `olive:flag:multiLora` set to `"1"`
 *
 * Defaults to `false` (disabled).
 */
export function isMultiLoraEnabled(): boolean {
  return isFeatureEnabled(FEATURE_FLAG_MULTI_LORA);
}

/**
 * Persist a feature flag override to localStorage.
 * Pass null to clear the localStorage override and fall back to the URL override or default.
 */
export function setFeatureFlag(key: FlagKey, enabled: boolean | null): void {
  try {
    if (enabled === null) {
      localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
    } else {
      localStorage.setItem(`${STORAGE_PREFIX}${key}`, enabled ? "1" : "0");
    }
  } catch {
    // noop
  }
}

/** Get all flag definitions with their current resolved state. */
export function getAllFlags(): { key: FlagKey; description: string; enabled: boolean }[] {
  return FLAG_DEFINITIONS.map((def) => ({
    key: def.key,
    description: def.description,
    enabled: isFeatureEnabled(def.key),
  }));
}
