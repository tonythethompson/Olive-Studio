import type { ProviderConfig, AIChatMessage, AnthropicResponse, ApiErrorResponse } from "../../types.ts";
import { registerProvider } from "./registry.ts";
import { fetchWithTimeout } from "../shared/http.ts";

async function call(
  cfg: ProviderConfig,
  system: string,
  messages: AIChatMessage[],
  wantJson: boolean,
): Promise<string> {
  const sysText = wantJson
    ? `${system}\n\nIMPORTANT: Respond with valid JSON only. No markdown, no text outside the JSON object.`
    : system;
  const resp = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 4096,
      system: sysText,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  if (!resp.ok) {
    const err = (await resp.json().catch(() => ({}))) as ApiErrorResponse;
    throw new Error(`Anthropic ${resp.status}: ${err.error?.message ?? resp.statusText}`);
  }
  const data = (await resp.json()) as AnthropicResponse;
  const text = data.content?.[0]?.text ?? "";
  // Match gemini/copilot: surface an empty response instead of silently returning "".
  if (!text.trim()) throw new Error("Anthropic returned an empty response.");
  return text;
}

registerProvider({
  name: "anthropic",
  label: "Anthropic Claude",
  defaultModel: "claude-haiku-4-5-20251001",
  envVarNames: ["ANTHROPIC_API_KEY"],
  buildConfig: (apiKey) => ({ provider: "anthropic", apiKey, model: "claude-haiku-4-5-20251001" }),
  call,
});
