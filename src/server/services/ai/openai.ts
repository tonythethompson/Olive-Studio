import type {
  ProviderConfig,
  AIChatMessage,
  OpenAIChatRequestBody,
  OpenAIChatResponse,
  ApiErrorResponse,
} from "../../types.ts";
import { registerProvider, getProvider, providerSupportsJsonResponse } from "./registry.ts";
import { stripTrailingSlashes } from "./security.ts";
import { fetchWithTimeout } from "../shared/http.ts";

// ─── Shared OpenAI-compatible call helper ─────────────────────────────────────

/**
 * Sends a chat completion request to an OpenAI-compatible API.
 *
 * @param cfg - Provider configuration, including the model, credentials, endpoint, and timeout.
 * @param system - System instruction for the model.
 * @param messages - Conversation messages to include in the request.
 * @param wantJson - Whether to request a JSON-only response.
 * @returns The assistant's response text.
 * @throws If the API request fails or returns an empty response.
 */
export async function callOpenAICompat(
  cfg: ProviderConfig,
  system: string,
  messages: AIChatMessage[],
  wantJson: boolean,
): Promise<string> {
  const base = resolveOpenAiCompatBase(cfg);
  const sysText = wantJson
    ? `${system}\n\nIMPORTANT: Respond with valid JSON only. No markdown fences, no text outside the JSON object.`
    : system;
  const body: OpenAIChatRequestBody = {
    model: cfg.model,
    messages: [
      { role: "system", content: sysText },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
  };
  if (wantJson && supportsJsonResponseFormat(cfg)) {
    body.response_format = { type: "json_object" };
  }
  // Small Cloudflare / local models often truncate mid-JSON without an explicit cap.
  if (wantJson) {
    body.max_tokens = 2048;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.apiKey}`,
    "Content-Type": "application/json",
  };
  if (cfg.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://github.com/tonythethompson/Olive-Studio";
    headers["X-Title"] = "Olive Studio";
  }

  const resp = await fetchWithTimeout(
    `${base}/chat/completions`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
    cfg.timeoutMs,
  );
  if (!resp.ok) {
    const err = (await resp.json().catch(() => ({}))) as ApiErrorResponse;
    const detail = err.error?.message ?? resp.statusText;
    if (resp.status === 404) {
      throw new Error(
        `${cfg.provider} 404: model "${cfg.model}" was not found on this endpoint. Pick another model from the provider list (NVIDIA catalogs change; some IDs are unavailable for a given API key).${detail ? ` Upstream: ${detail}` : ""}`,
      );
    }
    throw new Error(`${cfg.provider} ${resp.status}: ${detail}`);
  }
  const data = (await resp.json()) as OpenAIChatResponse;
  const text = data.choices?.[0]?.message?.content ?? "";
  // Match gemini/copilot/anthropic: surface an empty response instead of returning "".
  if (!text.trim()) throw new Error(`${cfg.provider} returned an empty response.`);
  return text;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve the API base URL for an OpenAI-compatible provider.
 * Single source of truth: an explicit `baseUrl` override, else the provider's
 * registered `defaultBaseUrl`, else OpenAI. No per-provider table duplicated here.
 */
function resolveOpenAiCompatBase(cfg: ProviderConfig): string {
  if (cfg.baseUrl?.trim()) return stripTrailingSlashes(cfg.baseUrl.trim());
  // The generic "openai-compat" provider has no canonical host — require an
  // explicit baseUrl rather than silently sending keys to api.openai.com.
  if (cfg.provider === "openai-compat") {
    throw new Error("openai-compat provider requires an explicit baseUrl.");
  }
  const registered = getProvider(cfg.provider)?.defaultBaseUrl;
  return stripTrailingSlashes(registered ?? "https://api.openai.com/v1");
}

/** Delegates to the registry's `supportsJsonResponseFormat` flag (no duplicated switch). */
export function supportsJsonResponseFormat(cfg: ProviderConfig): boolean {
  return providerSupportsJsonResponse(cfg);
}

// ─── GitHub Copilot (special OpenAI-compat with extra headers) ────────────────

async function callGitHubCopilot(
  cfg: ProviderConfig,
  system: string,
  messages: AIChatMessage[],
  wantJson: boolean,
): Promise<string> {
  const base = stripTrailingSlashes(cfg.baseUrl?.trim() || "https://api.githubcopilot.com");
  const endpoint = base.endsWith("/v1")
    ? `${base.slice(0, -3)}/chat/completions`
    : `${base}/chat/completions`;

  const sysText = wantJson
    ? `${system}\n\nIMPORTANT: Respond with valid JSON only. No markdown fences, no text outside the JSON object.`
    : system;

  const body: OpenAIChatRequestBody = {
    model: cfg.model || "gpt-4o",
    messages: [
      { role: "system", content: sysText },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
  };

  const resp = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Copilot-Integration-Id": "vscode-chat",
        "Editor-Version": "vscode/1.98.2",
        "Editor-Plugin-Version": "copilot-chat/0.26.7",
        "User-Agent": "GitHubCopilotChat/0.26.7",
        "Openai-Intent": "conversation-panel",
        "X-Request-Id": crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    },
    cfg.timeoutMs,
  );

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    let detail = resp.statusText;
    try {
      const err = JSON.parse(errText) as ApiErrorResponse;
      detail = err.error?.message ?? (errText.slice(0, 400) || detail);
    } catch {
      if (errText) detail = errText.slice(0, 400);
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new Error(
        `GitHub Copilot ${resp.status}: ${detail}. Use a Copilot session/OAuth token (not a plain classic PAT). Export from a logged-in IDE flow or set GITHUB_COPILOT_TOKEN / GITHUB_TOKEN with Copilot access.`,
      );
    }
    throw new Error(`GitHub Copilot ${resp.status}: ${detail}`);
  }

  const data = (await resp.json()) as OpenAIChatResponse;
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) throw new Error("GitHub Copilot returned an empty response.");
  return text;
}

// ─── Plugin Registrations ─────────────────────────────────────────────────────

// OpenAI
registerProvider({
  name: "openai",
  label: "OpenAI",
  defaultModel: "gpt-4o-mini",
  defaultBaseUrl: "https://api.openai.com/v1",
  envVarNames: ["OPENAI_API_KEY"],
  buildConfig: (apiKey) => ({ provider: "openai", apiKey, model: "gpt-4o-mini" }),
  call: callOpenAICompat,
  supportsJsonResponseFormat: true,
});

// ChatGPT subscription (using same API key as OpenAI)
registerProvider({
  name: "chatgpt-sub",
  label: "ChatGPT Plus/Pro Subscription",
  defaultModel: "gpt-4o-mini",
  defaultBaseUrl: "https://api.openai.com/v1",
  envVarNames: [], // Only available via runtime override
  buildConfig: (apiKey) => ({ provider: "chatgpt-sub", apiKey, model: "gpt-4o-mini" }),
  call: callOpenAICompat,
  supportsJsonResponseFormat: true,
});

// Mistral
registerProvider({
  name: "mistral",
  label: "Mistral AI",
  defaultModel: "mistral-large-latest",
  defaultBaseUrl: "https://api.mistral.ai/v1",
  envVarNames: ["MISTRAL_API_KEY"],
  buildConfig: (apiKey) => ({ provider: "mistral", apiKey, model: "mistral-large-latest" }),
  call: callOpenAICompat,
  supportsJsonResponseFormat: true,
});

// xAI / Grok
registerProvider({
  name: "xai",
  label: "xAI Grok",
  defaultModel: "grok-3",
  defaultBaseUrl: "https://api.x.ai/v1",
  envVarNames: ["XAI_API_KEY"],
  buildConfig: (apiKey) => ({ provider: "xai", apiKey, model: "grok-3", baseUrl: "https://api.x.ai/v1" }),
  call: callOpenAICompat,
  supportsJsonResponseFormat: true,
});

// OpenRouter
registerProvider({
  name: "openrouter",
  label: "OpenRouter",
  defaultModel: "openai/gpt-4o",
  defaultBaseUrl: "https://openrouter.ai/api/v1",
  envVarNames: ["OPENROUTER_API_KEY"],
  buildConfig: (apiKey) => ({
    provider: "openrouter",
    apiKey,
    model: "openai/gpt-4o",
    baseUrl: "https://openrouter.ai/api/v1",
  }),
  call: callOpenAICompat,
  supportsJsonResponseFormat: true,
});

// Groq
registerProvider({
  name: "groq",
  label: "Groq",
  defaultModel: "llama-4-scout-17b-16e-instruct",
  defaultBaseUrl: "https://api.groq.com/openai/v1",
  envVarNames: ["GROQ_API_KEY"],
  buildConfig: (apiKey) => ({
    provider: "groq",
    apiKey,
    model: "llama-4-scout-17b-16e-instruct",
    baseUrl: "https://api.groq.com/openai/v1",
  }),
  call: callOpenAICompat,
  supportsJsonResponseFormat: true,
});

// Together AI
registerProvider({
  name: "together",
  label: "Together AI",
  defaultModel: "meta-llama/Llama-4-Scout-17B-16E-Instruct",
  defaultBaseUrl: "https://api.together.xyz/v1",
  envVarNames: ["TOGETHER_API_KEY"],
  buildConfig: (apiKey) => ({
    provider: "together",
    apiKey,
    model: "meta-llama/Llama-4-Scout-17B-16E-Instruct",
    baseUrl: "https://api.together.xyz/v1",
  }),
  call: callOpenAICompat,
  supportsJsonResponseFormat: true,
});

// Kilo Code
registerProvider({
  name: "kilocode",
  label: "Kilo Code",
  defaultModel: "anthropic/claude-sonnet-4",
  defaultBaseUrl: "https://api.kilo.ai/api/gateway",
  envVarNames: ["KILO_API_KEY", "KILOCODE_API_KEY"],
  buildConfig: (apiKey) => ({
    provider: "kilocode",
    apiKey,
    model: "anthropic/claude-sonnet-4",
    baseUrl: "https://api.kilo.ai/api/gateway",
  }),
  call: callOpenAICompat,
});

// OpenCode Zen (pay-per-use gateway).
// Defaults to a /chat/completions model: Claude uses /messages and GPT uses /responses.
registerProvider({
  name: "opencode",
  label: "OpenCode Zen",
  defaultModel: "kimi-k2.7-code",
  defaultBaseUrl: "https://opencode.ai/zen/v1",
  envVarNames: ["OPENCODE_API_KEY"],
  buildConfig: (apiKey) => ({
    provider: "opencode",
    apiKey,
    model: "kimi-k2.7-code",
    baseUrl: "https://opencode.ai/zen/v1",
  }),
  call: callOpenAICompat,
  supportsJsonResponseFormat: true,
});

// OpenCode Go (subscription gateway for curated open models)
registerProvider({
  name: "opencode-go",
  label: "OpenCode Go",
  defaultModel: "kimi-k2.7-code",
  defaultBaseUrl: "https://opencode.ai/zen/go/v1",
  envVarNames: ["OPENCODE_API_KEY"],
  buildConfig: (apiKey) => ({
    provider: "opencode-go",
    apiKey,
    model: "kimi-k2.7-code",
    baseUrl: "https://opencode.ai/zen/go/v1",
  }),
  call: callOpenAICompat,
  supportsJsonResponseFormat: true,
});

// Fireworks AI
registerProvider({
  name: "fireworks",
  label: "Fireworks AI",
  defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
  defaultBaseUrl: "https://api.fireworks.ai/inference/v1",
  envVarNames: ["FIREWORKS_API_KEY"],
  buildConfig: (apiKey) => ({
    provider: "fireworks",
    apiKey,
    model: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    baseUrl: "https://api.fireworks.ai/inference/v1",
  }),
  call: callOpenAICompat,
  supportsJsonResponseFormat: true,
});

// NVIDIA NIM (build.nvidia.com / integrate.api.nvidia.com)
registerProvider({
  name: "nvidia",
  label: "NVIDIA NIM",
  defaultModel: "meta/llama-3.1-8b-instruct",
  defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
  envVarNames: ["NVIDIA_API_KEY"],
  buildConfig: (apiKey) => ({
    provider: "nvidia",
    apiKey,
    model: "meta/llama-3.1-8b-instruct",
    baseUrl: "https://integrate.api.nvidia.com/v1",
  }),
  call: callOpenAICompat,
  supportsJsonResponseFormat: true,
});

// Hugging Face Inference Providers (OpenAI-compatible router)
registerProvider({
  name: "huggingface",
  label: "Hugging Face",
  defaultModel: "moonshotai/Kimi-K2.5",
  defaultBaseUrl: "https://router.huggingface.co/v1",
  envVarNames: ["HF_TOKEN", "HUGGINGFACE_API_KEY"],
  buildConfig: (apiKey) => ({
    provider: "huggingface",
    apiKey,
    model: "moonshotai/Kimi-K2.5",
    baseUrl: "https://router.huggingface.co/v1",
  }),
  call: callOpenAICompat,
  supportsJsonResponseFormat: true,
});

// GitHub Copilot
registerProvider({
  name: "copilot",
  label: "GitHub Copilot",
  defaultModel: "gpt-4o",
  defaultBaseUrl: "https://api.githubcopilot.com",
  envVarNames: ["GITHUB_COPILOT_TOKEN", "COPILOT_GITHUB_TOKEN", "GITHUB_TOKEN"],
  buildConfig: (apiKey) => ({
    provider: "copilot",
    apiKey,
    model: "gpt-4o",
    baseUrl: "https://api.githubcopilot.com",
  }),
  call: callGitHubCopilot,
});

// Generic OpenAI-compatible (user sets base URL)
registerProvider({
  name: "openai-compat",
  label: "OpenAI-Compatible API",
  defaultModel: "gpt-4o-mini",
  envVarNames: ["OPENAI_COMPAT_API_KEY"],
  buildConfig: (apiKey) => ({
    provider: "openai-compat",
    apiKey,
    model: "gpt-4o-mini",
  }),
  call: callOpenAICompat,
});
