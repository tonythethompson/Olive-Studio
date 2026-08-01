import type { ProviderConfig } from "../../types.ts";
import { isValidCloudflareAccountId } from "../../../lib/cloudflare/credentials.ts";

/** Allowed base URL prefixes per provider (SSRF protection). */
export const ALLOWED_BASE_URL_PREFIX_BY_PROVIDER: Partial<Record<ProviderConfig["provider"], string[]>> = {
  openai: ["https://api.openai.com/v1"],
  "chatgpt-sub": ["https://api.openai.com/v1"],
  mistral: ["https://api.mistral.ai/v1"],
  copilot: ["https://api.githubcopilot.com"],
  kilocode: ["https://api.kilo.ai/api/gateway"],
  xai: ["https://api.x.ai/v1"],
  openrouter: ["https://openrouter.ai/api/v1"],
  groq: ["https://api.groq.com/openai/v1"],
  together: ["https://api.together.xyz/v1"],
  opencode: ["https://opencode.ai/zen/v1"],
  "opencode-go": ["https://opencode.ai/zen/go/v1"],
  fireworks: ["https://api.fireworks.ai/inference/v1"],
  nvidia: ["https://integrate.api.nvidia.com/v1"],
  huggingface: ["https://router.huggingface.co/v1"],
  // Account id is path segment: …/accounts/{32hex}/ai/v1 (validated in sanitizeProviderBaseUrl)
  cloudflare: ["https://api.cloudflare.com/client/v4/accounts"],
};

/** Strip trailing `/` without a regex (avoids ReDoS on long slash runs). */
export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47 /* / */) end -= 1;
  return value.slice(0, end);
}

/** WHATWG URL.hostname keeps brackets on IPv6 literals; strip before comparisons. */
export function normalizeHostname(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
}

/**
 * Determines whether a hostname has the shape of an IP address literal.
 *
 * @param hostname - The hostname to inspect
 * @returns `true` if the hostname contains an IPv6 separator or matches an IPv4-shaped format, `false` otherwise.
 */
export function isIpLiteralHost(hostname: string): boolean {
  if (!hostname) return false;
  if (hostname.includes(":")) return true; // IPv6 literal
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
}

/**
 * Identifies HTTP loopback URLs that use the Ollama or LM Studio ports.
 *
 * @param parsed - The URL to inspect
 * @returns `true` if the URL targets a loopback host on port 11434 or 1234, `false` otherwise.
 */
export function isKnownLocalOpenAiCompatUrl(parsed: URL): boolean {
  const host = normalizeHostname(parsed.hostname);
  const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (!isLoopback || parsed.protocol !== "http:") return false;
  const port = parsed.port ? Number(parsed.port) : 80;
  return port === 11434 || port === 1234;
}

/**
 * Determines whether a hostname identifies a local or private network address.
 *
 * @param hostname - The hostname to evaluate
 * @returns `true` for localhost variants, local domains, loopback or unspecified addresses, private IPv4 ranges, or invalid IPv4-shaped values; `false` otherwise.
 */
export function isPrivateOrLocalHostname(hostname: string): boolean {
  const h = normalizeHostname(hostname);
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "0.0.0.0" ||
    h.endsWith(".local")
  ) {
    return true;
  }
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h)) return false;
  const octets = h.split(".").map((n) => Number(n));
  if (octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = octets;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/**
 * Validates and normalizes a provider base URL.
 *
 * @param provider - The provider associated with the base URL
 * @param rawBaseUrl - The untrusted base URL to validate
 * @returns The normalized base URL, or `undefined` when no URL is provided
 * @throws If the URL is invalid, contains credentials, violates protocol or host restrictions, or is not allowed for the provider
 */
export function sanitizeProviderBaseUrl(provider: string, rawBaseUrl?: string): string | undefined {
  const trimmed = rawBaseUrl?.trim();
  if (!trimmed) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Invalid baseUrl");
  }
  if (parsed.username || parsed.password) {
    throw new Error("baseUrl must not include credentials");
  }

  const host = normalizeHostname(parsed.hostname);
  const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
  // Local engines (Ollama / LM Studio) are openai-compat over plain HTTP on loopback only.
  const allowLocalEngine =
    provider === "openai-compat" &&
    isLoopback &&
    (process.env.OLIVE_ALLOW_LOOPBACK_HTTP === "1" || isKnownLocalOpenAiCompatUrl(parsed));

  if (parsed.protocol !== "https:" && !(allowLocalEngine && parsed.protocol === "http:")) {
    throw new Error("baseUrl must use https");
  }
  if (!allowLocalEngine && (isIpLiteralHost(host) || isPrivateOrLocalHostname(host))) {
    throw new Error("baseUrl host is not allowed");
  }
  const normalized = stripTrailingSlashes(parsed.toString());
  const allowed = ALLOWED_BASE_URL_PREFIX_BY_PROVIDER[provider as ProviderConfig["provider"]];
  if (allowed && !allowed.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`))) {
    throw new Error(`baseUrl is not allowed for provider: ${provider}`);
  }
  if (provider === "cloudflare") {
    const parts = parsed.pathname.split("/").filter(Boolean);
    const accountsIdx = parts.indexOf("accounts");
    const accountId = accountsIdx >= 0 ? parts[accountsIdx + 1] : undefined;
    if (!accountId || !isValidCloudflareAccountId(accountId)) {
      throw new Error("baseUrl is not allowed for provider: cloudflare");
    }
  }
  return normalized;
}
