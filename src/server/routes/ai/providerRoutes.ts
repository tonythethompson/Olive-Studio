/**
 * AI provider management and model catalog routes:
 * GET/POST/DELETE /ai/provider, GET/POST /ai/models.
 */
import type { Router } from "express";

import { detectEnvProvider, setRuntimeAiProvider, getProvider } from "../../services/ai/index.ts";
import {
  getRuntimeAiProvider,
  readAiPreference,
  restoreProviderFromPreference,
} from "../../services/ai/state.ts";
import { listEnvCredentialStatus } from "../../services/ai/registry.ts";
import { sanitizeProviderBaseUrl, isLoopbackHostname } from "../../services/ai/security.ts";
import { ALLOWED_AI_PROVIDERS } from "../../services/ai/detect.ts";
import { readEnvApiKey } from "../../services/ai/env.ts";
import { resolveCloudflareAuth, listCloudflareModels } from "../../../lib/cloudflare/client.ts";
import { cloudflareAiBaseUrl, isValidCloudflareAccountId } from "../../../lib/cloudflare/credentials.ts";
import { getCodexAppServer } from "../../../lib/codex/CodexAppServerClient.ts";
import { listDevinModels } from "../../../lib/devin/client.ts";
import type { ProviderConfig } from "../../types.ts";
import { authActionRateLimit, heavyCommandRateLimit } from "../../middleware/rateLimit.ts";
import { studioLocalOnly } from "../../middleware/localOnly.ts";
import { isParseBodyError, parseBody } from "../../middleware/bodyGuard.ts";
import { fetchLiveModelCatalog } from "./modelCatalog.ts";
import { ensureGenaiVenv, isGenaiVenvReady } from "../../services/genai/venv.ts";
import { downloadModel, getModelStatus, DEFAULT_GENAI_MODEL } from "../../services/genai/modelDownload.ts";

/** Local openai-compat endpoints may omit API keys for model listing. */
function isLocalOpenaiCompat(provider: string, normalizedBaseUrl?: string): boolean {
  if (provider !== "openai-compat" || !normalizedBaseUrl) return false;
  try {
    return isLoopbackHostname(new URL(normalizedBaseUrl).hostname);
  } catch {
    return false;
  }
}

/** Resolve the API key for a live model catalog request: body > runtime > env. */
function resolveCatalogApiKey(provider: ProviderConfig["provider"], apiKey?: string): string {
  const explicit = typeof apiKey === "string" ? apiKey.trim() : "";
  if (explicit) return explicit;
  const runtime = getRuntimeAiProvider();
  if (runtime && runtime.provider === provider && runtime.apiKey?.trim()) {
    return runtime.apiKey.trim();
  }
  const plugin = getProvider(provider);
  return (plugin ? readEnvApiKey(...plugin.envVarNames) : undefined) ?? "";
}

/** Resolve the base URL candidate for a live model catalog request. */
function resolveCatalogBaseUrlCandidate(
  provider: ProviderConfig["provider"],
  baseUrl?: string,
): string | undefined {
  if (baseUrl) return baseUrl;
  const runtime = getRuntimeAiProvider();
  if (runtime && runtime.provider === provider && runtime.baseUrl) return runtime.baseUrl;
  return getProvider(provider)?.defaultBaseUrl;
}

/** Whether this provider may activate without an API key (local / OAuth / CF flows). */
function allowsEmptyApiKey(provider: string, normalizedBaseUrl?: string): boolean {
  if (
    provider === "openai-compat" ||
    provider === "codex" ||
    provider === "devin" ||
    provider === "cloudflare" ||
    // Bedrock can authenticate through the default AWS chain (profile, IAM
    // role, ~/.aws/credentials) without an explicit key.
    provider === "bedrock" ||
    // Built-in GenAI runs a local ONNX Runtime engine; it has no API key.
    provider === "genai"
  ) {
    return true;
  }
  if (!normalizedBaseUrl) return false;
  try {
    return isLoopbackHostname(new URL(normalizedBaseUrl).hostname);
  } catch {
    return false;
  }
}

function envCredentialsPayload() {
  const cfAccount = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";
  const cfAuth = resolveCloudflareAuth();
  const cloudflareUsable =
    Boolean(cfAuth) ||
    (Boolean(readEnvApiKey("CLOUDFLARE_API_TOKEN")) && isValidCloudflareAccountId(cfAccount));
  return listEnvCredentialStatus({ cloudflare: cloudflareUsable });
}

/**
 * Fetch model catalog for providers with dedicated auth flows (codex, devin, cloudflare).
 * Returns the catalog response or null if the provider uses the generic path.
 */
async function fetchSpecialProviderCatalog(
  provider: string,
): Promise<{ models: Array<{ id: string; label: string }>; source: string; error?: string } | null> {
  const fallback = (err: unknown) => ({
    models: [] as Array<{ id: string; label: string }>,
    source: "fallback",
    error: err instanceof Error ? err.message : String(err),
  });

  if (provider === "codex") {
    try {
      const server = getCodexAppServer();
      await server.start();
      const models = await server.listModels();
      if (models.length > 0) return { models, source: "live" };
      return {
        models: [],
        source: "fallback",
        error: "Codex returned an empty model catalog. Sign in, then Refresh.",
      };
    } catch (err: unknown) {
      return fallback(err);
    }
  }
  if (provider === "devin") {
    try {
      const catalog = await listDevinModels();
      return {
        models: catalog.models.map((m) => ({ id: m.id, label: m.name || m.id })),
        source: catalog.source,
        ...(catalog.error ? { error: catalog.error } : {}),
      };
    } catch (err: unknown) {
      return fallback(err);
    }
  }
  if (provider === "cloudflare") {
    try {
      const catalog = await listCloudflareModels();
      return {
        models: catalog.models.map((m) => ({ id: m.id, label: m.name || m.id })),
        source: catalog.source,
        ...(catalog.error ? { error: catalog.error } : {}),
      };
    } catch (err: unknown) {
      return fallback(err);
    }
  }
  return null;
}

type CredentialResult =
  { ok: true; apiKey: string; baseUrl: string | undefined } | { ok: false; error: string };

/**
 * Resolve the effective API key and base URL for a provider activation.
 * Handles env-key fallback, empty-key-allowed providers, and Cloudflare OAuth.
 */
function resolveProviderCredentials(
  provider: ProviderConfig["provider"],
  apiKey: string | undefined,
  normalizedBaseUrl: string | undefined,
): CredentialResult {
  const plugin = getProvider(provider);
  const envKey = plugin ? readEnvApiKey(...plugin.envVarNames) : undefined;
  const resolvedKey = typeof apiKey === "string" && apiKey.trim() ? apiKey.trim() : (envKey ?? "");
  const allowEmptyKey = allowsEmptyApiKey(provider, normalizedBaseUrl);
  if (!resolvedKey && !allowEmptyKey) {
    return { ok: false, error: `No API key provided and no env key found for ${provider}.` };
  }
  let finalKey = resolvedKey;
  let finalBaseUrl = normalizedBaseUrl;
  if (provider === "cloudflare") {
    const auth = resolveCloudflareAuth();
    if (auth) {
      finalKey = finalKey || auth.apiToken;
      finalBaseUrl = finalBaseUrl || cloudflareAiBaseUrl(auth.accountId);
    }
    if (!finalKey || !finalBaseUrl) {
      return {
        ok: false,
        error:
          "Cloudflare is not signed in. Use Sign in + Sync credentials, or set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.",
      };
    }
  }
  return { ok: true, apiKey: finalKey, baseUrl: finalBaseUrl };
}

export function mountProviderRoutes(router: Router): void {
  router.get("/ai/genai/status", (_req, res) => {
    return res.json({ venvReady: isGenaiVenvReady(), model: getModelStatus(DEFAULT_GENAI_MODEL) });
  });

  // Loopback-gated: these heavy endpoints trigger multi-GB disk/network work
  // and must not be reachable when Studio is bound to a LAN address.
  router.post("/ai/genai/setup", studioLocalOnly, heavyCommandRateLimit, async (_req, res) => {
    const result = await ensureGenaiVenv((line) => console.warn(line));
    return res.status(result.ok ? 200 : 500).json(result);
  });

  router.post("/ai/genai/download", studioLocalOnly, heavyCommandRateLimit, async (_req, res) => {
    const result = await downloadModel(DEFAULT_GENAI_MODEL);
    return res.status(result.ok ? 200 : 500).json(result);
  });

  router.get("/ai/provider", (_req, res) => {
    const envCredentials = envCredentialsPayload();
    const runtime = getRuntimeAiProvider();
    if (runtime) {
      return res.json({
        provider: runtime.provider,
        model: runtime.model,
        baseUrl: runtime.baseUrl ?? null,
        source: "runtime",
        envCredentials,
      });
    }

    const pref = readAiPreference();
    if (pref) {
      const restored = restoreProviderFromPreference(pref);
      if (restored) {
        return res.json({
          provider: restored.provider,
          model: restored.model,
          baseUrl: restored.baseUrl ?? null,
          source: "saved",
          envCredentials,
        });
      }
      // Still surface the last UI selection even if the env key is missing.
      let savedBaseUrl = pref.baseUrl ?? null;
      if (savedBaseUrl) {
        try {
          savedBaseUrl = sanitizeProviderBaseUrl(pref.provider, savedBaseUrl) ?? null;
        } catch {
          savedBaseUrl = null;
        }
      }
      return res.json({
        provider: pref.provider,
        model: pref.model,
        baseUrl: savedBaseUrl,
        source: "saved",
        envCredentials,
      });
    }

    const cfg = detectEnvProvider();
    if (!cfg) {
      return res.json({ provider: null, model: null, baseUrl: null, source: "none", envCredentials });
    }
    return res.json({
      provider: cfg.provider,
      model: cfg.model,
      baseUrl: cfg.baseUrl ?? null,
      source: "env",
      envCredentials,
    });
  });

  router.post("/ai/provider", authActionRateLimit, (req, res) => {
    const body = parseBody<{
      provider: ProviderConfig["provider"];
      apiKey?: string;
      model?: string;
      baseUrl?: string;
    }>(req.body, {
      provider: { type: "string", message: "Missing provider" },
      apiKey: { type: "string", required: false },
      model: { type: "string", required: false },
      baseUrl: { type: "string", required: false },
    });
    if (isParseBodyError(body)) return res.status(400).json({ error: body.error });
    const { provider, apiKey, model, baseUrl } = body.parsed;
    if (!provider) return res.status(400).json({ error: "Missing provider" });
    if (!ALLOWED_AI_PROVIDERS.has(provider))
      return res.status(400).json({ error: `Unsupported provider: ${provider}` });
    let normalizedBaseUrl: string | undefined;
    try {
      normalizedBaseUrl = sanitizeProviderBaseUrl(provider, baseUrl);
    } catch (err: unknown) {
      return res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
    const plugin = getProvider(provider);
    const creds = resolveProviderCredentials(provider, apiKey, normalizedBaseUrl);
    if (!creds.ok) return res.status(400).json({ error: creds.error });
    setRuntimeAiProvider({
      provider,
      apiKey: creds.apiKey,
      model: model || plugin?.defaultModel || "default",
      baseUrl: creds.baseUrl,
    });
    return res.json({ ok: true, provider, model: model || plugin?.defaultModel || "default" });
  });

  router.delete("/ai/provider", (_req, res) => {
    setRuntimeAiProvider(null);
    return res.json({ ok: true });
  });

  // ─── AI Models ───────────────────────────────────────────────────────────

  router.get("/ai/models", (_req, res) => {
    // Legacy static endpoint. Prefer POST /ai/models for live catalogs.
    return res.json({ models: [], source: "fallback" });
  });

  router.post("/ai/models", authActionRateLimit, async (req, res) => {
    const body = parseBody<{
      provider: ProviderConfig["provider"];
      apiKey?: string;
      baseUrl?: string;
    }>(req.body, {
      provider: { type: "string", message: "Missing provider" },
      apiKey: { type: "string", required: false },
      baseUrl: { type: "string", required: false },
    });
    if (isParseBodyError(body)) return res.status(400).json({ error: body.error });
    const { provider, apiKey, baseUrl } = body.parsed;
    if (!provider) return res.status(400).json({ error: "Missing provider" });
    if (!ALLOWED_AI_PROVIDERS.has(provider))
      return res.status(400).json({ error: `Unsupported provider: ${provider}` });
    try {
      const specialCatalog = await fetchSpecialProviderCatalog(provider);
      if (specialCatalog) return res.json(specialCatalog);

      const key = resolveCatalogApiKey(provider, apiKey);

      let safeBaseUrl: string | undefined;
      try {
        // Prefer explicit body, then runtime saved base for openai-compat / local.
        safeBaseUrl = sanitizeProviderBaseUrl(provider, resolveCatalogBaseUrlCandidate(provider, baseUrl));
      } catch (err: unknown) {
        return res.status(400).json({
          models: [],
          source: "fallback",
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const allowEmptyKey = isLocalOpenaiCompat(provider, safeBaseUrl);
      if (!key && !allowEmptyKey) {
        return res.json({
          models: [],
          source: "fallback",
          error: "No API key available. Enter a key or set the provider env var, then Refresh.",
        });
      }

      const modelCatalog = await fetchLiveModelCatalog(
        provider as ProviderConfig["provider"],
        key || "local",
        safeBaseUrl,
      );
      return res.json(modelCatalog);
    } catch (err: unknown) {
      return res
        .status(500)
        .json({ models: [], source: "fallback", error: err instanceof Error ? err.message : String(err) });
    }
  });
}
