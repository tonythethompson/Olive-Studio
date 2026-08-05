import type { ProviderConfig } from "../../types.ts";
import { readStudioConfig, writeStudioConfig } from "../../config.ts";
import { getProvider } from "./registry.ts";
import { readEnvApiKey } from "./env.ts";
import { sanitizeProviderBaseUrl } from "./security.ts";

/** Runtime AI provider override (set via /api/ai/provider endpoint). */
let runtimeAiProvider: ProviderConfig | null = null;

export type AiPreference = {
  provider: ProviderConfig["provider"];
  model: string;
  baseUrl?: string;
};

/**
 * Retrieves the current in-memory AI provider configuration.
 *
 * @returns The runtime provider configuration, or `null` when no override is set.
 */
export function getRuntimeAiProvider(): ProviderConfig | null {
  return runtimeAiProvider;
}

/** Clear in-memory runtime override without touching persisted aiPreference on disk. */
export function clearRuntimeAiProvider(): void {
  runtimeAiProvider = null;
}

/**
 * Persists the selected AI provider, model, and optional base URL for restoration after restart.
 *
 * @param cfg - The provider configuration to persist, or `null` to remove the saved preference
 */
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

/**
 * Reads the persisted AI provider preference.
 *
 * @returns The preference when both the provider and model are configured, or `null` otherwise.
 */
export function readAiPreference(): AiPreference | null {
  const pref = readStudioConfig().aiPreference;
  if (!pref?.provider || !pref.model) return null;
  return pref;
}

/**
 * Reconstructs a usable provider configuration from a saved preference and available environment credentials.
 *
 * @param pref - The saved provider, model, and optional base URL preference
 * @returns A provider configuration, or `null` when the provider is unavailable or has invalid configuration
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

  let baseUrl = pref.baseUrl ?? plugin.defaultBaseUrl;
  if (baseUrl) {
    try {
      baseUrl = sanitizeProviderBaseUrl(pref.provider, baseUrl);
    } catch {
      if (pref.provider === "openai-compat") {
        return null;
      }
      baseUrl = undefined;
    }
  }

  return {
    provider: pref.provider,
    apiKey: envKey ?? "",
    model: pref.model || plugin.defaultModel,
    baseUrl,
  };
}

/**
 * Sets the in-memory AI provider override and persists its preference.
 *
 * Clearing the provider also removes the persisted preference.
 *
 * @param cfg - The provider configuration to use, or `null` to clear it
 */
export function setRuntimeAiProvider(cfg: ProviderConfig | null): void {
  runtimeAiProvider = cfg;
  if (cfg) {
    persistAiPreference(cfg);
  } else {
    persistAiPreference(null);
  }
}
