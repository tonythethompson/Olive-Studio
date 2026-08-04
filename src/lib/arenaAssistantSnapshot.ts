/**
 * Arena Assistant cloud-snapshot helpers (Req 18).
 *
 * Pure client/server-shareable gates + mappers. Outbound URL policy lives in
 * `arenaEndpointPolicy.ts` (shared with server ssrfGuard for IPv4 ranges).
 *
 * Browser-safe: this module never reads `process.env`. Callers that need the
 * loopback-HTTP override (server route only) pass `{ allowLoopbackHttp: true }`.
 */

import type { ArenaSlotConfig } from "@/lib/stores/playgroundStore";
import {
  assertArenaEndpointUrlPolicy,
  type ArenaEndpointPolicyOpts,
} from "@/lib/arenaEndpointPolicy";

/** Providers that are not OpenAI chat-completions shaped for Arena cloud runs. */
// copilot: Arena cloud-inference only sends Authorization + Content-Type; Copilot
// needs provider-specific headers, so one-click snapshot cannot work.
const NON_OPENAI_COMPAT = new Set(["gemini", "anthropic", "devin", "codex", "copilot"]);

/**
 * Catalog defaults when the active config omits baseUrl.
 * Server snapshot prefers `plugin.defaultBaseUrl` first; this table is the
 * pure-helper fallback used by unit tests and offline resolution.
 * Kept in sync with `src/server/services/ai/openai.ts` registerProvider defaults
 * via `src/server/services/ai/arenaSnapshotCatalog.test.ts`.
 */
export const DEFAULT_BASE_URLS: Record<string, string> = {
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

/**
 * True when the provider can feed Arena cloud inference (OpenAI chat shape +
 * outbound URL policy). Does not require a non-empty apiKey — local engines
 * may omit keys.
 *
 * Never reads `process.env` (browser-safe). Pass `allowLoopbackHttp` from the
 * server when `OLIVE_ALLOW_LOOPBACK_HTTP` is set.
 */
export function isArenaOpenAiCompatProvider(
  provider: {
    provider: string;
    baseUrl?: string | null;
  },
  opts?: ArenaEndpointPolicyOpts,
): boolean {
  if (!provider.provider || NON_OPENAI_COMPAT.has(provider.provider)) return false;
  return resolveArenaSnapshotEndpointUrl(provider, opts) !== null;
}

/**
 * Resolves the chat base URL for a snapshot, or null when policy/missing fields fail.
 */
export function resolveArenaSnapshotEndpointUrl(
  provider: { provider: string; baseUrl?: string | null },
  opts?: ArenaEndpointPolicyOpts,
): string | null {
  if (!provider.provider || NON_OPENAI_COMPAT.has(provider.provider)) return null;

  const explicit = provider.baseUrl?.trim() ?? "";
  if (provider.provider === "openai-compat" && !explicit) return null;

  const raw = explicit || DEFAULT_BASE_URLS[provider.provider] || "";
  if (!raw) return null;

  try {
    assertArenaEndpointUrlPolicy(raw, opts);
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
  opts?: ArenaEndpointPolicyOpts,
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

  const endpointUrl = resolveArenaSnapshotEndpointUrl(provider, opts);
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
