/**
 * Cloudflare Workers AI / AI Gateway client for Olive Studio Assistant.
 *
 * Auth: Wrangler browser OAuth (`wrangler login` → sync token) or paste API token + account id.
 * Chat: OpenAI-compatible `…/ai/v1/chat/completions`.
 */

import { readEnvApiKey } from "../aiResponse.ts";
import {
  clearCloudflareCredentials,
  cloudflareAiBaseUrl,
  getCloudflareCredPath,
  isValidCloudflareAccountId,
  loadCloudflareCredentials,
  saveCloudflareCredentials,
  type CloudflareCredentials,
} from "./credentials.ts";
import {
  isWranglerLoginInProgress,
  startWranglerLogin,
  wranglerAuthToken,
  wranglerWhoAmI,
} from "./wrangler.ts";

export const CLOUDFLARE_FALLBACK_MODELS: Array<{ id: string; name: string }> = [
  { id: "@cf/meta/llama-3.1-8b-instruct", name: "Llama 3.1 8B Instruct" },
  { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", name: "Llama 3.3 70B Instruct (fast)" },
  { id: "@cf/qwen/qwen3-30b-a3b-fp8", name: "Qwen3 30B A3B" },
  { id: "@cf/openai/gpt-oss-120b", name: "GPT-OSS 120B" },
  { id: "@cf/google/gemma-3-12b-it", name: "Gemma 3 12B" },
];

export const DEFAULT_CLOUDFLARE_MODEL = CLOUDFLARE_FALLBACK_MODELS[0]!.id;

function envAccountId(): string | undefined {
  const id = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  return id && isValidCloudflareAccountId(id) ? id : undefined;
}

/** Resolve token + account from saved creds, else CLOUDFLARE_* env vars. */
export function resolveCloudflareAuth(): {
  apiToken: string;
  accountId: string;
  source: "file" | "env";
  accountName?: string;
  email?: string;
} | null {
  const file = loadCloudflareCredentials();
  if (file) {
    return {
      apiToken: file.apiToken,
      accountId: file.accountId,
      source: "file",
      accountName: file.accountName,
      email: file.email,
    };
  }
  const token = readEnvApiKey("CLOUDFLARE_API_TOKEN");
  const accountId = envAccountId();
  if (token && accountId) {
    return { apiToken: token, accountId, source: "env" };
  }
  return null;
}

export function getCloudflareAccountStatus(): {
  signedIn: boolean;
  accountId?: string;
  accountName?: string;
  email?: string;
  source?: "file" | "env";
  loginInProgress: boolean;
  credPath: string;
  error?: string;
} {
  const auth = resolveCloudflareAuth();
  if (!auth) {
    return {
      signedIn: false,
      loginInProgress: isWranglerLoginInProgress(),
      credPath: getCloudflareCredPath(),
    };
  }
  return {
    signedIn: true,
    accountId: auth.accountId,
    accountName: auth.accountName,
    email: auth.email,
    source: auth.source,
    loginInProgress: isWranglerLoginInProgress(),
    credPath: getCloudflareCredPath(),
  };
}

export async function startCloudflareLogin(): Promise<{ ok: boolean; message: string; detail?: string }> {
  try {
    const started = await startWranglerLogin();
    return {
      ok: true,
      message: "Complete Cloudflare sign-in in the browser, then click Sync credentials.",
      detail: started.detail,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Pull OAuth/API token from Wrangler and persist with an account id. */
export async function syncCloudflareFromWrangler(
  preferredAccountId?: string,
): Promise<CloudflareCredentials> {
  const tokenInfo = await wranglerAuthToken();
  const apiToken = tokenInfo.token?.trim() ?? "";
  const authType: CloudflareCredentials["authType"] = tokenInfo.type === "oauth" ? "oauth" : "api_token";
  if (!apiToken && tokenInfo.type === "api_key" && tokenInfo.key) {
    // Global API key is not ideal for Bearer Workers AI; prefer API tokens / OAuth.
    throw new Error(
      "Wrangler is using API key + email auth. Create an API token (Workers AI / Account read) or run wrangler login, then sync again.",
    );
  }
  if (!apiToken) {
    throw new Error(
      "wrangler auth token did not return a usable Bearer token. Run wrangler login, then sync.",
    );
  }

  const preferred = preferredAccountId?.trim();
  let accountId: string | undefined;
  let accountName: string | undefined;
  let email = tokenInfo.email;

  // Limited dashboard tokens often break `wrangler whoami` account listing even though
  // `wrangler auth token` works. Fall back to preferred / env / previously saved id.
  try {
    const who = await wranglerWhoAmI();
    email = who.email ?? email;
    const accounts = who.accounts ?? [];
    const picked =
      (preferred ? accounts.find((a) => a.id === preferred) : undefined) ??
      accounts.find((a) => isValidCloudflareAccountId(a.id)) ??
      accounts[0];
    if (picked && isValidCloudflareAccountId(picked.id)) {
      accountId = picked.id;
      accountName = picked.name;
    }
  } catch {
    /* whoami optional when we already know the account id */
  }

  if (!accountId && preferred && isValidCloudflareAccountId(preferred)) {
    accountId = preferred;
  }
  if (!accountId) {
    accountId = envAccountId();
  }
  if (!accountId) {
    const existing = loadCloudflareCredentials();
    if (existing && isValidCloudflareAccountId(existing.accountId)) {
      accountId = existing.accountId;
      accountName = accountName ?? existing.accountName;
      email = email ?? existing.email;
    }
  }
  if (!accountId || !isValidCloudflareAccountId(accountId)) {
    throw new Error(
      "Could not resolve a Cloudflare account id. Set CLOUDFLARE_ACCOUNT_ID, paste it with your API token, or re-run wrangler login with an account that can list accounts.",
    );
  }

  return saveCloudflareCredentials({
    apiToken,
    accountId,
    accountName,
    email,
    authType,
  });
}

export function saveManualCloudflareCredentials(input: {
  apiToken: string;
  accountId: string;
}): CloudflareCredentials {
  return saveCloudflareCredentials({
    apiToken: input.apiToken,
    accountId: input.accountId,
    authType: "manual",
  });
}

export function logoutCloudflare(): void {
  clearCloudflareCredentials();
}

export async function listCloudflareModels(): Promise<{
  models: Array<{ id: string; name: string }>;
  source: "live" | "fallback";
  error?: string;
}> {
  const auth = resolveCloudflareAuth();
  if (!auth) {
    return {
      models: [],
      source: "fallback",
      error: "Sign in to Cloudflare to load Workers AI models.",
    };
  }

  const base = cloudflareAiBaseUrl(auth.accountId);
  try {
    const resp = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${auth.apiToken}`, Accept: "application/json" },
    });
    if (!resp.ok) {
      return {
        models: [],
        source: "fallback",
        error: `Cloudflare models HTTP ${resp.status}`,
      };
    }
    const data = (await resp.json()) as {
      data?: Array<{ id?: string; name?: string }>;
      result?: Array<{ id?: string; name?: string }>;
    };
    const rows = data.data ?? data.result ?? [];
    const models = rows
      .map((m) => {
        const id = (m.id ?? "").trim();
        if (!id) return null;
        return { id, name: (m.name ?? id).trim() || id };
      })
      .filter((m): m is { id: string; name: string } => Boolean(m))
      .filter((m) => !/embed|whisper|tts|asr|diffusion|image/i.test(m.id))
      .slice(0, 120)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (models.length === 0) {
      return {
        models: [],
        source: "fallback",
        error: "Cloudflare returned no chat-capable models.",
      };
    }
    return { models, source: "live" };
  } catch (err: unknown) {
    return {
      models: [],
      source: "fallback",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Build ProviderConfig fields for runtime / OpenAI-compat calls. */
export function cloudflareProviderExtras(model?: string): {
  apiKey: string;
  baseUrl: string;
  model: string;
} {
  const auth = resolveCloudflareAuth();
  if (!auth) {
    throw new Error(
      "Not signed in to Cloudflare. Use Assistant → Settings → Cloudflare → Sign in (Wrangler), then Sync credentials.",
    );
  }
  return {
    apiKey: auth.apiToken,
    baseUrl: cloudflareAiBaseUrl(auth.accountId),
    model: model?.trim() || DEFAULT_CLOUDFLARE_MODEL,
  };
}
