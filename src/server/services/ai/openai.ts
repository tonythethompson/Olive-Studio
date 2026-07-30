import type {
  ProviderConfig,
  AIChatMessage,
  OpenAIChatRequestBody,
  OpenAIChatResponse,
  ApiErrorResponse,
} from "../../types.ts";
import { registerProvider } from "./registry.ts";
import { stripTrailingSlashes } from "./security.ts";

// ─── Shared OpenAI-compatible call helper ─────────────────────────────────────

/** Call any OpenAI-compatible chat completions API. */
export async function callOpenAICompat(
  cfg: ProviderConfig,
  system: string,
  messages: AIChatMessage[],
  wantJson: boolean,
): Promise<string> {
  const base = resolveOpenAiCompatBase(cfg);
  const sysText =
    wantJson && !supportsJsonResponseFormat(cfg)
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

  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.apiKey}`,
    "Content-Type": "application/json",
  };
  if (cfg.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://github.com/tonythethompson/Olive-Studio";
    headers["X-Title"] = "Olive Studio";
  }

  const resp = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = (await resp.json().catch(() => ({}))) as ApiErrorResponse;
    throw new Error(`${cfg.provider} ${resp.status}: ${err.error?.message ?? resp.statusText}`);
  }
  const data = (await resp.json()) as OpenAIChatResponse;
  return data.choices?.[0]?.message?.content ?? "";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveOpenAiCompatBase(cfg: ProviderConfig): string {
  if (cfg.baseUrl?.trim()) return stripTrailingSlashes(cfg.baseUrl.trim());
  switch (cfg.provider) {
    case "mistral":
      return "https://api.mistral.ai/v1";
    case "xai":
      return "https://api.x.ai/v1";
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    case "groq":
      return "https://api.groq.com/openai/v1";
    case "together":
      return "https://api.together.xyz/v1";
    case "kilocode":
      return "https://api.kilo.ai/api/gateway";
    case "chatgpt-sub":
    case "openai":
    case "openai-compat":
    default:
      return "https://api.openai.com/v1";
  }
}

export function supportsJsonResponseFormat(cfg: ProviderConfig): boolean {
  return (
    cfg.provider === "openai" ||
    cfg.provider === "chatgpt-sub" ||
    cfg.provider === "mistral" ||
    cfg.provider === "xai" ||
    cfg.provider === "openrouter" ||
    cfg.provider === "groq" ||
    cfg.provider === "together"
  );
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

  const resp = await fetch(endpoint, {
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
  });

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
