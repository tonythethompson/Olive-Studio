/**
 * AI Provider Service — main entry point.
 *
 * All providers self-register via the plugin registry (./registry.ts).
 * This module re-exports the public API and side-effect imports provider
 * plugins so they register before any calls.
 *
 * OpenAI-compatible backends (mistral, xai, openrouter, groq, together,
 * kilocode, opencode, fireworks, nvidia, huggingface, copilot, openai-compat,
 * chatgpt-sub) register inside `openai.ts`. Cloudflare registers in `cloudflare.ts`.
 *
 * Adding a new provider = create a file (or extend openai.ts), call
 * `registerProvider(...)`, and import the module below if it is a new file.
 */

// Side-effect imports: register all providers.
// Order matters for env detection priority — matches old detectEnvProvider chain.
import "./gemini.ts";
import "./openai.ts"; // Also registers mistral, xai, openrouter, groq, together, kilocode, copilot, openai-compat, chatgpt-sub
import "./anthropic.ts";
import "./devin.ts";
import "./codex.ts";
import "./cloudflare.ts";

// Registry-based API
import { getRuntimeAiProvider, readAiPreference, restoreProviderFromPreference } from "./state.ts";
import { detectEnvProvider, callProvider, registeredProviderNames, getProvider } from "./registry.ts";
import type { ProviderConfig, AIChatMessage } from "../../types.ts";

/**
 * Gets the active AI provider using runtime overrides, saved preferences, or environment detection.
 *
 * @returns The active provider configuration, or `null` when no provider is available
 */
export function getAiProvider(): ProviderConfig | null {
  const runtime = getRuntimeAiProvider();
  if (runtime) return runtime;

  const pref = readAiPreference();
  if (pref) {
    const restored = restoreProviderFromPreference(pref);
    if (restored && !(restored.provider === "openai-compat" && !restored.baseUrl?.trim())) {
      return restored;
    }

    // Preference matches the env-detected provider: keep the user's model/baseUrl.
    const env = detectEnvProvider();
    if (env && env.provider === pref.provider) {
      return {
        ...env,
        model: pref.model || env.model,
        baseUrl: pref.baseUrl ?? env.baseUrl,
      };
    }
  }

  return detectEnvProvider();
}

/** Set of all registered provider identifiers (for UI allowlists, validation). */
export const ALLOWED_AI_PROVIDERS: ReadonlySet<ProviderConfig["provider"]> = registeredProviderNames();

/** Look up a provider plugin by name (for UI metadata). */
export { getProvider, detectEnvProvider, callProvider };
export { setRuntimeAiProvider } from "./state.ts";
export type { ProviderConfig, AIChatMessage };

/**
 * Sends a conversation to the configured AI provider.
 * Dispatches via the plugin registry.
 */
export async function callAI(system: string, messages: AIChatMessage[], wantJson = false): Promise<string> {
  const cfg = getAiProvider();
  if (!cfg) {
    const names = [...ALLOWED_AI_PROVIDERS].join(" / ");
    throw new Error(
      `No AI provider configured. Add an API key in Assistant → Settings, or set an env var for one of: ${names}.`,
    );
  }
  return callProvider(cfg, system, messages, wantJson);
}
