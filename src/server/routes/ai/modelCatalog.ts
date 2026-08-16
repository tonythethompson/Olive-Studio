/**
 * Live model-catalog fetching for AI providers.
 * `baseUrl` arguments must already be sanitized before reaching these helpers.
 */
import { sanitizeProviderBaseUrl, stripTrailingSlashes } from "../../services/ai/security.ts";
import { fetchWithTimeout } from "../../services/shared/http.ts";
import {
  catalogModelsFromOpenAiCompatRows,
  normalizeCatalogModels,
  type OpenAiCompatModelRow,
} from "../../../lib/modelCatalog.ts";

/** Fetch live model catalog from a provider's API. `baseUrl` must already be sanitized. */
export async function fetchLiveModelCatalog(provider: string, apiKey: string, baseUrl?: string) {
  try {
    if (provider === "gemini") {
      return await fetchGeminiModelCatalog(apiKey);
    }
    if (provider === "anthropic") {
      return await fetchAnthropicModelCatalog(apiKey);
    }
    if (provider === "copilot") {
      return await fetchCopilotModelCatalog(apiKey, baseUrl);
    }
    if (provider === "bedrock") {
      // Bedrock model availability is region/account-scoped and has no
      // OpenAI-style catalog endpoint; the static default list stands.
      return {
        models: [],
        source: "fallback" as const,
        error: "Bedrock models are region-scoped; use the default model ID or one enabled for your account.",
      };
    }
    if (provider === "genai") {
      // The built-in engine serves a single locally downloaded model; it has
      // no remote catalog endpoint. Return the static default list instead of
      // attempting an OpenAI-style fetch.
      return {
        models: [],
        source: "fallback" as const,
        error: "Built-in GenAI runs one locally downloaded model; the default is preconfigured in Settings.",
      };
    }

    const base = stripTrailingSlashes(baseUrl || defaultBaseUrl(provider));
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (provider === "openrouter") {
      headers["HTTP-Referer"] = "https://github.com/tonythethompson/Olive-Studio";
      headers["X-Title"] = "Olive Studio";
    }

    const rows: OpenAiCompatModelRow[] = [];
    let nextUrl: string | null = new URL("models", base.endsWith("/") ? base : `${base}/`).toString();
    let pages = 0;
    while (nextUrl && pages < 10) {
      pages += 1;
      const r = await fetchWithTimeout(nextUrl, { headers });
      if (!r.ok) {
        if (pages === 1) {
          return { models: [], source: "fallback" as const, error: `HTTP ${r.status}` };
        }
        break;
      }
      const data = (await r.json()) as {
        data?: OpenAiCompatModelRow[];
        has_more?: boolean;
        next?: string | null;
      };
      rows.push(...(data.data ?? []));
      if (data.has_more && typeof data.next === "string" && data.next.trim()) {
        try {
          const baseOrigin = new URL(`${base}/`).origin;
          const candidate = new URL(data.next, `${base}/`);
          // API key travels with this request; never follow pagination off-origin.
          nextUrl = candidate.origin === baseOrigin ? candidate.toString() : null;
        } catch {
          nextUrl = null;
        }
      } else {
        nextUrl = null;
      }
    }

    const models = catalogModelsFromOpenAiCompatRows(rows);
    return {
      models,
      source: models.length > 0 ? ("live" as const) : ("fallback" as const),
      ...(models.length === 0 ? { error: "Provider returned no chat-capable models." } : {}),
    };
  } catch (err: unknown) {
    return {
      models: [],
      source: "fallback" as const,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function fetchGeminiModelCatalog(apiKey: string) {
  const models: Array<{ id: string; label: string }> = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
    url.searchParams.set("key", apiKey);
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const r = await fetchWithTimeout(url);
    if (!r.ok) {
      if (page === 0) {
        return { models: [], source: "fallback" as const, error: `Gemini HTTP ${r.status}` };
      }
      break;
    }
    const data = (await r.json()) as {
      models?: Array<{ name?: string; displayName?: string; supportedGenerationMethods?: string[] }>;
      nextPageToken?: string;
    };
    for (const m of data.models ?? []) {
      if (!(m.supportedGenerationMethods ?? []).includes("generateContent")) continue;
      const raw = (m.name || "").replace(/^models\//, "").trim();
      if (!raw) continue;
      models.push({ id: raw, label: m.displayName || raw });
    }
    pageToken = data.nextPageToken?.trim() || undefined;
    if (!pageToken) break;
  }
  const normalized = normalizeCatalogModels(models);
  return {
    models: normalized,
    source: normalized.length > 0 ? ("live" as const) : ("fallback" as const),
    ...(normalized.length === 0 ? { error: "No Gemini generateContent models returned." } : {}),
  };
}

async function fetchAnthropicModelCatalog(apiKey: string) {
  const models: Array<{ id: string; label: string }> = [];
  let afterId: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const url = new URL("https://api.anthropic.com/v1/models");
    url.searchParams.set("limit", "100");
    if (afterId) url.searchParams.set("after_id", afterId);
    const r = await fetchWithTimeout(url, {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    });
    if (!r.ok) {
      if (page === 0) {
        return { models: [], source: "fallback" as const, error: `Anthropic HTTP ${r.status}` };
      }
      break;
    }
    const data = (await r.json()) as {
      data?: Array<{ id?: string; display_name?: string }>;
      has_more?: boolean;
      last_id?: string;
    };
    for (const m of data.data ?? []) {
      const id = (m.id || "").trim();
      if (!id) continue;
      models.push({ id, label: m.display_name || id });
    }
    if (!data.has_more || !data.last_id) break;
    afterId = data.last_id;
  }
  const normalized = normalizeCatalogModels(models);
  return {
    models: normalized,
    source: normalized.length > 0 ? ("live" as const) : ("fallback" as const),
    ...(normalized.length === 0 ? { error: "No Anthropic models returned." } : {}),
  };
}

async function fetchCopilotModelCatalog(apiKey: string, baseUrl?: string) {
  // Validate optional override against the Copilot allowlist, then fetch only the
  // constant allowlisted endpoint (breaks CodeQL SSRF taint from user baseUrl).
  sanitizeProviderBaseUrl("copilot", baseUrl);
  const modelsUrl = "https://api.githubcopilot.com/models";
  const r = await fetchWithTimeout(modelsUrl, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Copilot-Integration-Id": "vscode-chat",
      "Editor-Version": "vscode/1.98.2",
      "Editor-Plugin-Version": "copilot-chat/0.26.7",
      "User-Agent": "GitHubCopilotChat/0.26.7",
      "X-GitHub-Api-Version": "2025-10-01",
    },
  });
  if (!r.ok) return { models: [], source: "fallback" as const, error: `Copilot HTTP ${r.status}` };
  const data = (await r.json()) as {
    data?: Array<{ id?: string; name?: string; model_picker_enabled?: boolean }>;
  };
  const models = normalizeCatalogModels(
    (data.data ?? [])
      .filter((m) => m.model_picker_enabled !== false)
      .map((m) => {
        const id = m.id || m.name || "";
        return { id, label: m.name || id };
      }),
  );
  return {
    models,
    source: models.length > 0 ? ("live" as const) : ("fallback" as const),
    ...(models.length === 0 ? { error: "No Copilot models returned for this token." } : {}),
  };
}

export function defaultBaseUrl(provider: string): string {
  switch (provider) {
    case "openai":
    case "chatgpt-sub":
      return "https://api.openai.com/v1";
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
    case "opencode":
      return "https://opencode.ai/zen/v1";
    case "opencode-go":
      return "https://opencode.ai/zen/go/v1";
    case "fireworks":
      return "https://api.fireworks.ai/inference/v1";
    case "nvidia":
      return "https://integrate.api.nvidia.com/v1";
    case "huggingface":
      return "https://router.huggingface.co/v1";
    case "copilot":
      return "https://api.githubcopilot.com";
    default:
      return "https://api.openai.com/v1";
  }
}
