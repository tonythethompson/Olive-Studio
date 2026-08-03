/**
 * Arena Assistant cloud-snapshot helpers (Req 18).
 *
 * Pure client/server-shareable gates + mappers. Outbound URL policy mirrors
 * `assertUrlPolicy` in ssrfGuard (protocol / credentials / private literals /
 * loopback-http override) without Node-only DNS pinning.
 */

import type { ArenaSlotConfig } from "@/lib/stores/playgroundStore";

/** Providers that are not OpenAI chat-completions shaped for Arena cloud runs. */
const NON_OPENAI_COMPAT = new Set(["gemini", "anthropic", "devin", "codex"]);

/** Catalog defaults when the active config omits baseUrl. */
const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  mistral: "https://api.mistral.ai/v1",
  xai: "https://api.x.ai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  groq: "https://api.groq.com/openai/v1",
  together: "https://api.together.xyz/v1",
  kilocode: "https://api.kilo.ai/api/gateway",
  opencode: "https://opencode.ai/zen/v1",
  "opencode-go": "https://opencode.ai/zen/go/v1",
  fireworks: "https://api.fireworks.ai/inference/v1",
  nvidia: "https://integrate.api.nvidia.com/v1",
  huggingface: "https://router.huggingface.co/v1",
  copilot: "https://api.githubcopilot.com",
  "chatgpt-sub": "https://api.openai.com/v1",
};

export type AssistantCloudSnapshotEligible = {
  eligible: true;
  endpointUrl: string;
  apiKey: string;
  modelId: string;
  providerLabel: string;
};

export type AssistantCloudSnapshotIneligible = {
  eligible: false;
  reason: string;
};

export type AssistantCloudSnapshotResponse =
  | AssistantCloudSnapshotEligible
  | AssistantCloudSnapshotIneligible;

export type ArenaProviderDescriptor = {
  provider: string;
  baseUrl?: string | null;
  apiKey?: string | null;
  model?: string | null;
  /** Optional human label; falls back to provider id. */
  label?: string | null;
};

function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

function stripBrackets(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

function isLoopbackHostname(hostname: string): boolean {
  const host = stripBrackets(hostname);
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function isBlockedIpv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if ([a, b, c, Number(m[4])].some((n) => n > 255)) return true;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

function isLoopbackIp(ip: string): boolean {
  const host = stripBrackets(ip);
  return host === "127.0.0.1" || host === "::1" || host.startsWith("127.");
}

/**
 * Shape-level outbound policy aligned with Arena `assertUrlPolicy`
 * (no DNS resolve — literal hosts only).
 */
export function assertArenaEndpointUrlPolicy(
  rawUrl: string,
  opts?: { allowLoopbackHttp?: boolean },
): void {
  const allowLoopbackHttp = opts?.allowLoopbackHttp ?? process.env.OLIVE_ALLOW_LOOPBACK_HTTP === "true";
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Invalid endpointUrl");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http/https endpoints are supported");
  }
  if (url.username || url.password) {
    throw new Error("Credentialed endpoints are not supported");
  }
  const host = stripBrackets(url.hostname);
  if (!host) throw new Error("Invalid endpointUrl");

  if (host === "metadata.google.internal" || host.endsWith(".local")) {
    if (!(allowLoopbackHttp && isLoopbackHostname(host))) {
      throw new Error("Private endpoints are not supported");
    }
  }

  const loopbackName = isLoopbackHostname(host);
  const allowLoopback = allowLoopbackHttp && loopbackName && url.protocol === "http:";

  if (url.protocol !== "https:" && !allowLoopback) {
    throw new Error("HTTPS endpoints are required");
  }

  // Literal IPv4
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    if (isBlockedIpv4(host) && !(allowLoopback && isLoopbackIp(host))) {
      throw new Error("Private endpoints are not supported");
    }
  }
}

/**
 * True when the provider can feed Arena cloud inference (OpenAI chat shape +
 * outbound URL policy). Does not require a non-empty apiKey — local engines
 * may omit keys.
 */
export function isArenaOpenAiCompatProvider(provider: {
  provider: string;
  baseUrl?: string | null;
}): boolean {
  if (!provider.provider || NON_OPENAI_COMPAT.has(provider.provider)) return false;
  const endpoint = resolveArenaSnapshotEndpointUrl(provider);
  return endpoint !== null;
}

/**
 * Resolves the chat base URL for a snapshot, or null when policy/missing fields fail.
 */
export function resolveArenaSnapshotEndpointUrl(provider: {
  provider: string;
  baseUrl?: string | null;
}): string | null {
  if (!provider.provider || NON_OPENAI_COMPAT.has(provider.provider)) return null;

  const explicit = provider.baseUrl?.trim() ?? "";
  if (provider.provider === "openai-compat" && !explicit) return null;

  const raw = explicit || DEFAULT_BASE_URLS[provider.provider] || "";
  if (!raw) return null;

  try {
    assertArenaEndpointUrlPolicy(raw);
    return stripTrailingSlashes(raw);
  } catch {
    return null;
  }
}

/**
 * Build a client-facing snapshot response from an active provider descriptor.
 * Ineligible responses omit credential fields entirely (not null).
 */
export function buildAssistantCloudSnapshot(
  provider: ArenaProviderDescriptor | null | undefined,
): AssistantCloudSnapshotResponse {
  if (!provider?.provider) {
    return { eligible: false, reason: "No Assistant provider configured" };
  }

  if (NON_OPENAI_COMPAT.has(provider.provider)) {
    return {
      eligible: false,
      reason:
        "Active provider is not OpenAI-compatible; use Custom / openai-compat, or enter endpoint fields manually",
    };
  }

  const endpointUrl = resolveArenaSnapshotEndpointUrl(provider);
  if (!endpointUrl) {
    return {
      eligible: false,
      reason:
        "Active provider endpoint is missing or not allowed for Arena outbound calls (private/loopback without override)",
    };
  }

  const modelId = (provider.model ?? "").trim();
  if (!modelId) {
    return { eligible: false, reason: "Active provider has no model id to snapshot" };
  }

  return {
    eligible: true,
    endpointUrl,
    apiKey: provider.apiKey ?? "",
    modelId,
    providerLabel: (provider.label ?? provider.provider).trim() || provider.provider,
  };
}

/**
 * Pure mapper: eligible snapshot → Arena cloud slot patch (Property 22).
 * Does not touch local `file` / `tokenizerId` fields.
 */
export function toCloudSlotPatch(
  snapshot: AssistantCloudSnapshotEligible,
): Pick<ArenaSlotConfig, "type" | "endpointUrl" | "apiKey" | "modelId"> {
  return {
    type: "cloud",
    endpointUrl: snapshot.endpointUrl,
    apiKey: snapshot.apiKey,
    modelId: snapshot.modelId,
  };
}
