import type { ProviderConfig } from "../../types.ts";

/** Runtime AI provider override (set via /api/ai/provider endpoint). */
let runtimeAiProvider: ProviderConfig | null = null;

export function getRuntimeAiProvider(): ProviderConfig | null {
  return runtimeAiProvider;
}

export function setRuntimeAiProvider(cfg: ProviderConfig | null): void {
  runtimeAiProvider = cfg;
}
