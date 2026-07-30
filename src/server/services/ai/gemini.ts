import type {
  ProviderConfig,
  AIChatMessage,
  GeminiRequestBody,
  GeminiResponse,
  ApiErrorResponse,
} from "../../types.ts";
import { registerProvider } from "./registry.ts";
import { fetchWithTimeout } from "../shared/http.ts";

async function call(
  cfg: ProviderConfig,
  system: string,
  messages: AIChatMessage[],
  wantJson: boolean,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent?key=${cfg.apiKey}`;
  const body: GeminiRequestBody = {
    system_instruction: { parts: [{ text: system }] },
    contents: messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
  };
  if (wantJson) body.generationConfig = { responseMimeType: "application/json" };
  const resp = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    cfg.timeoutMs,
  );
  if (!resp.ok) {
    const err = (await resp.json().catch(() => ({}))) as ApiErrorResponse;
    throw new Error(`Gemini ${resp.status}: ${err.error?.message ?? resp.statusText}`);
  }
  const data = (await resp.json()) as GeminiResponse;
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text.trim()) throw new Error("Gemini returned an empty response.");
  return text;
}

registerProvider({
  name: "gemini",
  label: "Google Gemini",
  defaultModel: "gemini-2.5-flash",
  envVarNames: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_API_KEY"],
  buildConfig: (apiKey) => ({ provider: "gemini", apiKey, model: "gemini-2.5-flash" }),
  call,
});
