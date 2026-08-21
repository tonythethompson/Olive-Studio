/**
 * Curated fallback Devin models when live catalog is unavailable.
 */

export const DEVIN_FALLBACK_MODELS: Array<{ id: string; name: string }> = [
  { id: "swe-1-6", name: "SWE-1.6" },
  { id: "swe-1-7", name: "SWE-1.7" },
  { id: "claude-sonnet-4", name: "Claude Sonnet 4" },
  { id: "claude-opus-4", name: "Claude Opus 4" },
  { id: "gpt-4o", name: "GPT-4o" },
  { id: "kimi-k2", name: "Kimi K2" },
];
