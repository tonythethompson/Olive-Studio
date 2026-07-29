import type { ProviderConfig, AIChatMessage } from "../../types.ts";
import { readEnvApiKey } from "../../../lib/aiResponse.ts";

// ─── Plugin Interface ─────────────────────────────────────────────────────────

/**
 * A self-registering AI provider plugin.
 * Each provider file exports one of these and calls `registerProvider(plugin)`.
 */
export interface AiProviderPlugin {
  /** Unique provider identifier (matches ProviderConfig["provider"]). */
  name: ProviderConfig["provider"];
  /** Human-readable label for UI display. */
  label: string;
  /** Default model when none is specified. */
  defaultModel: string;
  /** Default API base URL. Omit if the provider doesn't use the OpenAI compat pattern. */
  defaultBaseUrl?: string;
  /**
   * Environment variable names to check for the API key.
   * First one found with a real value wins.
   */
  envVarNames: string[];
  /**
   * Build a ProviderConfig from a discovered API key.
   * Called during env detection; the key has already been verified non-placeholder.
   */
  buildConfig: (apiKey: string) => ProviderConfig;
  /**
   * Call the provider's API.
   * Receives the resolved config (from env or runtime override).
   */
  call: (
    cfg: ProviderConfig,
    system: string,
    messages: AIChatMessage[],
    wantJson: boolean,
  ) => Promise<string>;
  /**
   * Whether this provider natively supports JSON response format
   * (OpenAI-compatible `response_format: { type: "json_object" }`).
   */
  supportsJsonResponseFormat?: boolean;
}

// ─── Registry ─────────────────────────────────────────────────────────────────

const providers = new Map<ProviderConfig["provider"], AiProviderPlugin>();

/** Register an AI provider plugin. Called at module import time. */
export function registerProvider(plugin: AiProviderPlugin): void {
  if (providers.has(plugin.name)) {
    throw new Error(`Duplicate AI provider registration: ${plugin.name}`);
  }
  providers.set(plugin.name, plugin);
}

/** Get a specific registered provider by name. */
export function getProvider(name: ProviderConfig["provider"]): AiProviderPlugin | undefined {
  return providers.get(name);
}

/** Iterate all registered providers in registration order. */
export function allProviders(): IterableIterator<AiProviderPlugin> {
  return providers.values();
}

/** Set of all registered provider names. */
export function registeredProviderNames(): Set<ProviderConfig["provider"]> {
  return new Set(providers.keys());
}

// ─── Detection ────────────────────────────────────────────────────────────────

/**
 * Scan environment variables across all registered providers.
 * Returns a ProviderConfig for the first one that has a valid key set.
 * Providers are checked in registration order.
 */
export function detectEnvProvider(): ProviderConfig | null {
  for (const plugin of providers.values()) {
    const key = readEnvApiKey(...plugin.envVarNames);
    if (key) {
      return plugin.buildConfig(key);
    }
  }
  return null;
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

/**
 * Call the appropriate AI provider based on the config.
 * Looks up the registered plugin and delegates to its call handler.
 */
export async function callProvider(
  cfg: ProviderConfig,
  system: string,
  messages: AIChatMessage[],
  wantJson: boolean,
): Promise<string> {
  const plugin = providers.get(cfg.provider);
  if (!plugin) {
    throw new Error(`Unknown AI provider: ${cfg.provider}. Registered: ${[...providers.keys()].join(", ")}`);
  }
  return plugin.call(cfg, system, messages, wantJson);
}

/** Whether a registered provider supports JSON response format natively. */
export function providerSupportsJsonResponse(cfg: ProviderConfig): boolean {
  return providers.get(cfg.provider)?.supportsJsonResponseFormat ?? false;
}
