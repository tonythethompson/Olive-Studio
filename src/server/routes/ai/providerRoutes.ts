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
import { readEnvApiKey } from "../../../lib/aiResponse.ts";
import { resolveCloudflareAuth, listCloudflareModels } from "../../../lib/cloudflare/client.ts";
import { cloudflareAiBaseUrl, isValidCloudflareAccountId } from "../../../lib/cloudflare/credentials.ts";
import { getCodexAppServer } from "../../../lib/codex/CodexAppServerClient.ts";
import { listDevinModels } from "../../../lib/devin/client.ts";
import type { ProviderConfig } from "../../types.ts";
import { authActionRateLimit } from "../../middleware/rateLimit.ts";
import { fetchLiveModelCatalog } from "./modelCatalog.ts";

/** Local openai-compat endpoints may omit API keys for model listing. */
function isLocalOpenaiCompat(provider: string, normalizedBaseUrl?: string): boolean {
  if (provider !== "openai-compat" || !normalizedBaseUrl) return false;
  try {
    return isLoopbackHostname(new URL(normalizedBaseUrl).hostname);
  } catch {
    return false;
  }
}

/** Whether this provider may activate without an API key (local / OAuth / CF flows). */
function allowsEmptyApiKey(provider: string, normalizedBaseUrl?: string): boolean {
  if (
    provider === "openai-compat" ||
    provider === "codex" ||
    provider === "devin" ||
    provider === "cloudflare"
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

export function mountProviderRoutes(router: Router): void {
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
    const { provider, apiKey, model, baseUrl } = req.body ?? {};
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
    const envKey = plugin ? readEnvApiKey(...plugin.envVarNames) : undefined;
    const resolvedKey = typeof apiKey === "string" && apiKey.trim() ? apiKey.trim() : (envKey ?? "");
    const allowEmptyKey = allowsEmptyApiKey(provider, normalizedBaseUrl);
    if (!resolvedKey && !allowEmptyKey) {
      return res.status(400).json({
        error: `No API key provided and no env key found for ${provider}.`,
      });
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
        return res.status(400).json({
          error:
            "Cloudflare is not signed in. Use Sign in + Sync credentials, or set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.",
        });
      }
    }
    setRuntimeAiProvider({
      provider,
      apiKey: finalKey,
      model: model || plugin?.defaultModel || "default",
      baseUrl: finalBaseUrl,
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

  router.post("/ai/models", async (req, res) => {
    const { provider, apiKey, baseUrl } = req.body ?? {};
    if (!provider) return res.status(400).json({ error: "Missing provider" });
    if (!ALLOWED_AI_PROVIDERS.has(provider))
      return res.status(400).json({ error: `Unsupported provider: ${provider}` });
    try {
      if (provider === "codex") {
        try {
          const server = getCodexAppServer();
          await server.start();
          const models = await server.listModels();
          if (models.length > 0) {
            return res.json({ models, source: "live" });
          }
          return res.json({
            models: [],
            source: "fallback",
            error: "Codex returned an empty model catalog. Sign in, then Refresh.",
          });
        } catch (err: unknown) {
          return res.json({
            models: [],
            source: "fallback",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (provider === "devin") {
        try {
          const catalog = await listDevinModels();
          return res.json({
            models: catalog.models.map((m) => ({ id: m.id, label: m.name || m.id })),
            source: catalog.source,
            ...(catalog.error ? { error: catalog.error } : {}),
          });
        } catch (err: unknown) {
          return res.json({
            models: [],
            source: "fallback",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (provider === "cloudflare") {
        try {
          const catalog = await listCloudflareModels();
          return res.json({
            models: catalog.models.map((m) => ({ id: m.id, label: m.name || m.id })),
            source: catalog.source,
            ...(catalog.error ? { error: catalog.error } : {}),
          });
        } catch (err: unknown) {
          return res.json({
            models: [],
            source: "fallback",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const plugin = getProvider(provider);
      const runtime = getRuntimeAiProvider();
      const runtimeKey =
        runtime && runtime.provider === provider && runtime.apiKey?.trim()
          ? runtime.apiKey.trim()
          : undefined;
      const envKey = plugin ? readEnvApiKey(...plugin.envVarNames) : undefined;
      const key =
        (typeof apiKey === "string" && apiKey.trim() ? apiKey.trim() : "") || runtimeKey || envKey || "";

      let safeBaseUrl: string | undefined;
      try {
        // Prefer explicit body, then runtime saved base for openai-compat / local.
        const candidate =
          baseUrl ||
          (runtime && runtime.provider === provider ? runtime.baseUrl : undefined) ||
          plugin?.defaultBaseUrl;
        safeBaseUrl = sanitizeProviderBaseUrl(provider, candidate);
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
