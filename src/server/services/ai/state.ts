import type { ProviderConfig } from "../../types.ts";
import { readStudioConfig, writeStudioConfig } from "../../config.ts";
import { getProvider } from "./registry.ts";
import { readEnvApiKey } from "../../../lib/aiResponse.ts";

/** Runtime AI provider override (set via /api/ai/provider endpoint). */
let runtimeAiProvider: ProviderConfig | null = null;

export type AiPreference = {
  provider: ProviderConfig["provider"];
  model: string;
  baseUrl?: string;
};

export function getRuntimeAiProvider(): ProviderConfig | null {
  return runtimeAiProvider;
}

/** Clear in-memory runtime override without touching persisted aiPreference on disk. */
export function clearRuntimeAiProvider(): void {
  runtimeAiProvider = null;
}

/** Persist non-secret provider/model/baseUrl so restarts keep the last selection. */
export function persistAiPreference(
  cfg: Pick<ProviderConfig, "provider" | "model" | "baseUrl"> | null,
): void {
  if (!cfg) {
    writeStudioConfig({ aiPreference: undefined });
    return;
  }
  const pref: AiPreference = {
    provider: cfg.provider,
    model: cfg.model,
    ...(cfg.baseUrl ? { baseUrl: cfg.baseUrl } : {}),
  };
  writeStudioConfig({ aiPreference: pref });
}

export function readAiPreference(): AiPreference | null {
  const pref = readStudioConfig().aiPreference;
  if (!pref?.provider || !pref.model) return null;
  return pref;
}

/**
 * Rebuild a usable ProviderConfig from a saved preference + env key for that provider.
 * Does not invent keys for cloud providers; returns null if the preferred provider
 * cannot be called yet (except openai-compat / local-style empty-key cases).
 */
export function restoreProviderFromPreference(pref: AiPreference): ProviderConfig | null {
  const plugin = getProvider(pref.provider);
  if (!plugin) return null;

  const envKey = readEnvApiKey(...plugin.envVarNames);
  const allowEmptyKey =
    pref.provider === "openai-compat" ||
    pref.provider === "codex" ||
    pref.provider === "devin" ||
    Boolean(pref.baseUrl && /localhost|127\.0\.0\.1/i.test(pref.baseUrl));

  if (pref.provider === "cloudflare") {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
    if (!envKey || !accountId) return null;
  } else if (!envKey && !allowEmptyKey) {
    return null;
  }

  return {
    provider: pref.provider,
    apiKey: envKey ?? "",
    model: pref.model || plugin.defaultModel,
    baseUrl: pref.baseUrl ?? plugin.defaultBaseUrl,
  };
}

export function setRuntimeAiProvider(cfg: ProviderConfig | null): void {
  runtimeAiProvider = cfg;
  if (cfg) {
    persistAiPreference(cfg);
  } else {
    persistAiPreference(null);
  }
}
