/**
 * Feature flag infrastructure for gating experimental features.
 * Flags are read from URL query params (?flagName=1) and localStorage.
 * Zero runtime cost when flags are off — checks are simple boolean reads.
 */

type FlagKey = "multiLora" | "lazyCatalog" | "batchComparison" | "reportExport";

interface FlagDefinition {
  key: FlagKey;
  description: string;
  defaultEnabled: boolean;
}

const FLAG_DEFINITIONS: FlagDefinition[] = [
  {
    key: "multiLora",
    description: "Multi-LoRA adapter support (requires Olive >= 0.3.0)",
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
 * Priority: URL param > localStorage > default.
 */
export function isFeatureEnabled(key: FlagKey): boolean {
  const urlVal = readUrlParam(key);
  if (urlVal !== null) return urlVal;

  const storageVal = readStorage(key);
  if (storageVal !== null) return storageVal;

  const def = FLAG_DEFINITIONS.find((d) => d.key === key);
  return def?.defaultEnabled ?? false;
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
