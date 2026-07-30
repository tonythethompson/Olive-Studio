import type { ProviderConfig } from "../../types.ts";

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
};

/** Strip trailing `/` without a regex (avoids ReDoS on long slash runs). */
export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47 /* / */) end -= 1;
  return value.slice(0, end);
}

export function isIpLiteralHost(hostname: string): boolean {
  if (!hostname) return false;
  if (hostname.includes(":")) return true; // IPv6 literal
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
}

export function isPrivateOrLocalHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
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

export function sanitizeProviderBaseUrl(provider: string, rawBaseUrl?: string): string | undefined {
  const trimmed = rawBaseUrl?.trim();
  if (!trimmed) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Invalid baseUrl");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("baseUrl must use https");
  }
  if (parsed.username || parsed.password) {
    throw new Error("baseUrl must not include credentials");
  }
  if (isIpLiteralHost(parsed.hostname) || isPrivateOrLocalHostname(parsed.hostname)) {
    throw new Error("baseUrl host is not allowed");
  }
  const normalized = stripTrailingSlashes(parsed.toString());
  const allowed = ALLOWED_BASE_URL_PREFIX_BY_PROVIDER[provider as ProviderConfig["provider"]];
  if (allowed && !allowed.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`))) {
    throw new Error(`baseUrl is not allowed for provider: ${provider}`);
  }
  return normalized;
}
