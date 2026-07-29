import type { ProviderConfig, AIChatMessage } from "../../types.ts";
import { registerProvider } from "./registry.ts";
import { devinChat } from "../../../lib/devin/client.ts";

async function call(
  cfg: ProviderConfig,
  system: string,
  messages: AIChatMessage[],
  wantJson: boolean,
): Promise<string> {
  return devinChat({
    model: cfg.model || "swe-1-6",
    system: wantJson ? `${system}\n\nIMPORTANT: Respond with valid JSON only. No markdown fences.` : system,
    messages: messages.map((m) => ({
      role: m.role === "assistant" ? "assistant" : m.role === "user" ? "user" : "system",
      content: m.content,
    })),
  });
}

registerProvider({
  name: "devin",
  label: "Devin (Cognition AI)",
  defaultModel: "swe-1-6",
  envVarNames: [], // Only available via runtime override
  buildConfig: (apiKey) => ({ provider: "devin", apiKey, model: "swe-1-6" }),
  call,
});
