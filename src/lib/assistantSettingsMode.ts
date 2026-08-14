/** Local vs Cloud Assistant Settings mode helpers. */

export type AssistantSettingsMode = "local" | "cloud";

/**
 * Determines whether a base URL targets a supported local engine.
 *
 * @param url - The engine base URL to inspect
 * @returns `true` if the URL targets loopback on port `1234` or `11434`, `false` otherwise
 */
export function isLocalEngineBaseUrl(url?: string | null): boolean {
  if (!url?.trim()) return false;
  const raw = url.trim();
  try {
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `http://${raw}`;
    const u = new URL(withScheme);
    const host = u.hostname.toLowerCase().replace(/^\[|]$/g, "");
    const localHost = host === "127.0.0.1" || host === "localhost" || host === "::1";
    if (!localHost) return false;
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    return port === "1234" || port === "11434";
  } catch {
    // Strict URL parsing only: malformed inputs are not local engines.
    return false;
  }
}

/**
 * Determines whether assistant settings use a local or cloud mode.
 *
 * @param provider - The assistant provider identifier
 * @param baseUrl - The provider's base URL
 * @returns `"local"` for the OpenAI-compatible provider with a recognized local engine URL, otherwise `"cloud"`
 */
export function deriveAssistantSettingsMode(
  provider?: string | null,
  baseUrl?: string | null,
): AssistantSettingsMode {
  if (provider === "openai-compat" && isLocalEngineBaseUrl(baseUrl)) return "local";
  return "cloud";
}

/**
 * Identifies the preferred local engine from a base URL.
 *
 * @param baseUrl - The base URL used to identify the local engine
 * @returns `"ollama"` for port `11434`, `"lms"` for port `1234`, or `null` when no supported local engine is identified
 */
export function preferredEngineFromBaseUrl(baseUrl?: string | null): "lms" | "ollama" | null {
  if (!isLocalEngineBaseUrl(baseUrl)) return null;
  try {
    const raw = baseUrl!.trim();
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `http://${raw}`;
    const port = new URL(withScheme).port || "80";
    if (port === "11434") return "ollama";
    if (port === "1234") return "lms";
  } catch {
    /* fall through */
  }
  return null;
}
