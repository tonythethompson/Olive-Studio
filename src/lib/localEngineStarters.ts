/**
 * Local LM Studio / Ollama starter catalog and install-id matching.
 * Kept outside React feature folders so server and lib code can import it safely.
 */

/** A local engine that can serve models from the user's machine. */
export type LocalEngine = "lms" | "ollama";

/**
 * Local starter recommendation.
 * - `tag`: engine download id (`lms get <tag>` or `ollama pull <tag>`). LMS uses HF URLs
 *   because bare staff-pick names often fail or resolve to huge wrong models.
 * - `enableTag`: preferred OpenAI-compat model id after download (`lms load` / chat `model`).
 * - `match`: substring used to detect an already-installed copy in `lms ls` / Ollama tags.
 */
export type LocalStarterModel = {
  tag: string;
  enableTag: string;
  match: string;
  name: string;
  desc: string;
  fallbackSize: string;
  /** Approximate on-disk / download size for disk-space gating. */
  approxBytes: number;
};

/** Minimum stem length before fuzzy contains-matching is allowed. */
export const MODEL_ID_FUZZY_MIN_LEN = 8;

/** LM Studio starter models for local AI (download via `lms get <HF url>`). */
export const LMS_STARTER_MODELS: readonly LocalStarterModel[] = [
  {
    tag: "https://huggingface.co/lmstudio-community/Qwen2.5-Coder-1.5B-Instruct-GGUF",
    enableTag: "qwen2.5-coder-1.5b-instruct",
    match: "qwen2.5-coder-1.5b",
    name: "Qwen2.5-Coder (1.5B)",
    desc: "⭐ Recommended: Best tool-calling accuracy & Olive recipe precision",
    fallbackSize: "~1.7 GB",
    approxBytes: 1_700_000_000,
  },
  {
    tag: "https://huggingface.co/lmstudio-community/Llama-3.2-1B-Instruct-GGUF",
    enableTag: "llama-3.2-1b-instruct",
    match: "llama-3.2-1b",
    name: "Llama-3.2 (1B)",
    desc: "⚡ Ultra-lightweight: Lowest RAM footprint (<1.2GB)",
    fallbackSize: "~1.3 GB",
    approxBytes: 1_300_000_000,
  },
  {
    // Point at Q4_K_M so `-y` does not auto-pick a tiny IQ2 staff option.
    tag: "https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf",
    enableTag: "phi-3.5-mini-instruct",
    match: "phi-3.5-mini",
    name: "Phi-3.5-Mini (3.8B)",
    desc: "🧠 Advanced Reasoning: Complex compiler co-design",
    fallbackSize: "~2.4 GB",
    approxBytes: 2_400_000_000,
  },
];

/** Ollama starter models for local AI. */
export const OLLAMA_STARTER_MODELS: readonly LocalStarterModel[] = [
  {
    tag: "qwen2.5-coder:1.5b",
    enableTag: "qwen2.5-coder:1.5b",
    match: "qwen2.5-coder:1.5b",
    name: "Qwen2.5-Coder (1.5B)",
    desc: "⭐ Recommended: Best tool-calling accuracy & Olive recipe precision",
    fallbackSize: "1.1 GB",
    approxBytes: 1_100_000_000,
  },
  {
    tag: "llama3.2:1b",
    enableTag: "llama3.2:1b",
    match: "llama3.2:1b",
    name: "Llama-3.2 (1B)",
    desc: "⚡ Ultra-lightweight: Lowest RAM footprint (<1.2GB)",
    fallbackSize: "800 MB",
    approxBytes: 800_000_000,
  },
  {
    tag: "phi3.5:3.8b",
    enableTag: "phi3.5:3.8b",
    match: "phi3.5:3.8b",
    name: "Phi-3.5-Mini",
    desc: "🧠 Advanced Reasoning: Complex compiler co-design",
    fallbackSize: "~2 GB",
    approxBytes: 2_200_000_000,
  },
];

/** Collapse a download URL / model id into a comparable alphanumeric stem. */
export function normalizeModelIdStem(id: string): string {
  let s = id.trim().toLowerCase();
  if (s.startsWith("http://") || s.startsWith("https://")) {
    try {
      const parts = new URL(s).pathname.split("/").filter(Boolean);
      const resolveIdx = parts.indexOf("resolve");
      const base = (resolveIdx > 0 ? parts[resolveIdx - 1] : parts[parts.length - 1]) ?? s;
      s = base.replace(/\.gguf$/i, "");
    } catch {
      /* keep s */
    }
  }
  return s.replace(/-gguf$/i, "").replace(/[^a-z0-9:]+/g, "");
}

/** True when one stem contains the other and the shorter side is long enough to be discriminating. */
export function stemsLooselyMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length < MODEL_ID_FUZZY_MIN_LEN) return false;
  return longer.includes(shorter);
}

/** Return the installed model id matching a starter, or null. */
export function findInstalledStarterId(
  starter: Pick<LocalStarterModel, "enableTag" | "match" | "tag">,
  installed: readonly string[],
): string | null {
  const exact = installed.find((i) => i === starter.enableTag || i.endsWith(`/${starter.enableTag}`));
  if (exact) return exact;

  // Ollama: `phi3.5:3.8b` starter should still resolve an installed `phi3.5:latest`.
  const enableColon = starter.enableTag.indexOf(":");
  if (enableColon > 0) {
    const base = starter.enableTag.slice(0, enableColon).toLowerCase();
    const family = installed.find((i) => {
      const colon = i.indexOf(":");
      const installedBase = (colon > 0 ? i.slice(0, colon) : i).toLowerCase();
      return installedBase === base;
    });
    if (family) return family;
  }

  const needles = [starter.match, starter.enableTag, starter.tag]
    .map(normalizeModelIdStem)
    .filter(Boolean);
  for (const id of installed) {
    const stem = normalizeModelIdStem(id);
    if (needles.some((n) => stemsLooselyMatch(stem, n))) return id;
  }
  return null;
}

/**
 * Pick the OpenAI-compat model id to enable after a local download.
 * Prefers an installed catalog hit over raw HF download URLs.
 */
export function resolveLocalEnableModelId(
  downloadTag: string,
  enableTag: string | undefined,
  installed: readonly string[],
): string {
  if (enableTag) {
    const found = findInstalledStarterId(
      { enableTag, match: enableTag, tag: downloadTag },
      installed,
    );
    if (found) return found;
  }
  const stem = normalizeModelIdStem(downloadTag);
  const hit = installed.find((i) => stemsLooselyMatch(normalizeModelIdStem(i), stem));
  return hit ?? enableTag ?? downloadTag;
}
