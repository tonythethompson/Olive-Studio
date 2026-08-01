/** Local vs Cloud Assistant Settings mode helpers. */

export type AssistantSettingsMode = "local" | "cloud";

/** True when base URL points at LM Studio (1234) or Ollama (11434) on loopback. */
export function isLocalEngineBaseUrl(url?: string | null): boolean {
  if (!url?.trim()) return false;
  const raw = url.trim();
  try {
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `http://${raw}`;
    const u = new URL(withScheme);
    const host = u.hostname.toLowerCase();
    const localHost = host === "127.0.0.1" || host === "localhost" || host === "::1";
    if (!localHost) return false;
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    return port === "1234" || port === "11434";
  } catch {
    const n = raw.toLowerCase();
    const localHost = n.includes("127.0.0.1") || n.includes("localhost");
    return localHost && (n.includes(":1234") || n.includes(":11434"));
  }
}

export function deriveAssistantSettingsMode(
  provider?: string | null,
  baseUrl?: string | null,
): AssistantSettingsMode {
  if (provider === "openai-compat" && isLocalEngineBaseUrl(baseUrl)) return "local";
  return "cloud";
}

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
