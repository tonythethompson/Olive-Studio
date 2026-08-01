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

/**
 * Reads the configured Cloudflare account ID from the environment.
 *
 * @returns The trimmed account ID if it is valid, or `undefined` when no valid account ID is configured.
 */
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

/**
 * Reports the current Cloudflare authentication status and account details.
 *
 * @returns Authentication state, account metadata when available, login progress, and the credential file path
 */
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

/**
 * Starts Cloudflare browser authentication through Wrangler.
 *
 * @returns The login result, including a completion message when started successfully or an error message when it fails.
 */
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

/** Prefer preferred / whoami / env / saved account id with validation. */
export function resolveAccountId(
  preferred: string | undefined,
  whoAmIAccounts: Array<{ id: string; name?: string }>,
  fallbacks: {
    envAccountId?: string;
    savedAccountId?: string;
    savedAccountName?: string;
  },
): { accountId: string; accountName?: string } | null {
  const preferredTrimmed = preferred?.trim();
  const preferredMatch = preferredTrimmed ? whoAmIAccounts.find((a) => a.id === preferredTrimmed) : undefined;
  const picked =
    preferredMatch ??
    (preferredTrimmed
      ? undefined
      : (whoAmIAccounts.find((a) => isValidCloudflareAccountId(a.id)) ?? whoAmIAccounts[0]));
  if (picked && isValidCloudflareAccountId(picked.id)) {
    return { accountId: picked.id, accountName: picked.name };
  }
  if (preferredTrimmed && isValidCloudflareAccountId(preferredTrimmed)) {
    return { accountId: preferredTrimmed };
  }
  if (fallbacks.envAccountId && isValidCloudflareAccountId(fallbacks.envAccountId)) {
    return { accountId: fallbacks.envAccountId };
  }
  if (fallbacks.savedAccountId && isValidCloudflareAccountId(fallbacks.savedAccountId)) {
    return {
      accountId: fallbacks.savedAccountId,
      accountName: fallbacks.savedAccountName,
    };
  }
  return null;
}

/**
 * Synchronizes Wrangler authentication with a Cloudflare account and saves the resulting credentials.
 *
 * @param preferredAccountId - Optional account ID to use when resolving the Cloudflare account.
 * @returns The saved Cloudflare credentials.
 * @throws If Wrangler does not provide a usable bearer token or no valid Cloudflare account ID can be resolved.
 */
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
  let whoAmIAccounts: Array<{ id: string; name?: string }> = [];
  let email = tokenInfo.email;

  // Limited dashboard tokens often break `wrangler whoami` account listing even though
  // `wrangler auth token` works. Fall back to preferred / env / previously saved id.
  try {
    const who = await wranglerWhoAmI();
    email = who.email ?? email;
    whoAmIAccounts = who.accounts ?? [];
  } catch {
    /* whoami optional when we already know the account id */
  }

  const existing = loadCloudflareCredentials();
  const resolved = resolveAccountId(preferred, whoAmIAccounts, {
    envAccountId: envAccountId(),
    savedAccountId: existing?.accountId,
    savedAccountName: existing?.accountName,
  });
  if (!resolved) {
    throw new Error(
      "Could not resolve a Cloudflare account id. Set CLOUDFLARE_ACCOUNT_ID, paste it with your API token, or re-run wrangler login with an account that can list accounts.",
    );
  }

  const whoMatch = whoAmIAccounts.find((a) => a.id === resolved.accountId);
  const accountName = whoMatch?.name ?? resolved.accountName;

  return saveCloudflareCredentials({
    apiToken,
    accountId: resolved.accountId,
    accountName,
    email: email ?? existing?.email,
    authType,
  });
}

/**
 * Saves manually supplied Cloudflare API credentials.
 *
 * @param input - The API token and Cloudflare account ID to save
 * @returns The saved Cloudflare credentials
 */
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

/**
 * Removes the saved Cloudflare credentials.
 */
export function logoutCloudflare(): void {
  clearCloudflareCredentials();
}

/**
 * Loads the available Cloudflare Workers AI chat models.
 *
 * @returns The chat models and their source, with an error message when fallback data is used.
 */
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
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 80);
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

/**
 * Builds authenticated provider settings for Cloudflare Workers AI calls.
 *
 * @param model - The model to use; defaults to the configured Cloudflare model when omitted or blank.
 * @returns The API key, account-specific base URL, and selected model.
 */
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
