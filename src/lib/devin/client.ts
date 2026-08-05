/**
 * Olive Studio Devin subscription client.
 *
 * Devin is a multi-model subscription for Assistant audit/chat (not a single
 * model id). Auth: browser sign-in + token paste.
 * Chat: cloud-direct Connect-RPC (adapted from pi-devin-auth / opencode-windsurf-auth, MIT).
 */

import { buildDevinSignInUrl, completeDevinLogin } from "./oauth/login.ts";
import { DEFAULT_REGION } from "./oauth/types.ts";
import {
  clearDevinCredentials,
  loadDevinCredentials,
  saveDevinCredentials,
  getDevinCredPath,
} from "./credentials.ts";
import { streamChat, type ChatHistoryItem } from "./cloud-direct/chat.ts";
import { getCachedCatalog, type ModelCatalogEntry } from "./cloud-direct/catalog.ts";

/** Curated fallback models when live catalog is unavailable. */
export const DEVIN_FALLBACK_MODELS: Array<{ id: string; name: string }> = [
  { id: "swe-1-6", name: "SWE-1.6" },
  { id: "swe-1-7", name: "SWE-1.7" },
  { id: "claude-sonnet-4", name: "Claude Sonnet 4" },
  { id: "claude-opus-4", name: "Claude Opus 4" },
  { id: "gpt-4o", name: "GPT-4o" },
  { id: "kimi-k2", name: "Kimi K2" },
];

export function getDevinSignInUrl(): string {
  return buildDevinSignInUrl(DEFAULT_REGION);
}

export function getDevinAccountStatus(): {
  signedIn: boolean;
  name?: string;
  apiServerUrl?: string;
  issuedAt?: string;
  credPath: string;
} {
  const creds = loadDevinCredentials();
  if (!creds) {
    return { signedIn: false, credPath: getDevinCredPath() };
  }
  return {
    signedIn: true,
    name: creds.name,
    apiServerUrl: creds.apiServerUrl,
    issuedAt: creds.issuedAt,
    credPath: getDevinCredPath(),
  };
}

export async function finishDevinLogin(pastedToken: string): Promise<{
  name: string;
  apiServerUrl: string;
}> {
  const result = await completeDevinLogin(pastedToken, DEFAULT_REGION);
  saveDevinCredentials(result);
  return { name: result.name, apiServerUrl: result.apiServerUrl };
}

export function logoutDevin(): void {
  clearDevinCredentials();
}

/**
 * Loads the available Devin models for the signed-in account.
 *
 * @returns The model list, its source (`live` or `fallback`), and an error message when the live catalog is unavailable.
 */
export async function listDevinModels(): Promise<{
  models: Array<{ id: string; name: string; disabled?: boolean }>;
  source: "live" | "fallback";
  error?: string;
}> {
  const creds = loadDevinCredentials();
  if (!creds) {
    return {
      models: [],
      source: "fallback",
      error: "Sign in to Devin to load models for your plan.",
    };
  }
  try {
    const catalog = await getCachedCatalog(creds.apiKey, creds.apiServerUrl || "https://server.codeium.com");
    const entries: ModelCatalogEntry[] = catalog ? [...catalog.byUid.values()] : [];
    if (entries.length === 0) {
      return {
        models: [],
        source: "fallback",
        error: "Devin returned an empty model catalog.",
      };
    }
    // Prefer enabled models; keep a reasonable list for the dropdown
    const enabled = entries.filter((e) => !e.disabled);
    const source = enabled.length > 0 ? enabled : entries;
    const models = source
      .map((e) => ({
        id: e.modelUid,
        name: e.label || e.modelUid,
        disabled: e.disabled,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 80);
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
 * Non-streaming Devin chat: collect all text deltas from the cloud stream.
 */
export async function devinChat(options: {
  model: string;
  system?: string;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
}): Promise<string> {
  const creds = loadDevinCredentials();
  if (!creds) {
    throw new Error(
      "Not signed in to Devin. Use Assistant → Settings → Devin → Sign in, paste the token from the browser page.",
    );
  }

  const history: ChatHistoryItem[] = [];
  if (options.system?.trim()) {
    history.push({ role: "system", content: options.system.trim() });
  }
  for (const m of options.messages) {
    history.push({ role: m.role, content: m.content });
  }

  const parts: string[] = [];
  for await (const delta of streamChat({
    apiKey: creds.apiKey,
    apiServerUrl: creds.apiServerUrl || "https://server.codeium.com",
    modelUid: options.model,
    messages: history,
  })) {
    parts.push(delta);
  }
  const text = parts.join("");
  if (!text.trim()) {
    throw new Error("Devin returned an empty response. Check your subscription model access.");
  }
  return text;
}
