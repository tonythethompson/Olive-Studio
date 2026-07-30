import type { ProviderConfig, AIChatMessage } from "../../types.ts";
import { registerProvider } from "./registry.ts";
import { buildCodexPrompt, codexAsk } from "../../../lib/codex/codexAgent.ts";

async function call(
  cfg: ProviderConfig,
  system: string,
  messages: AIChatMessage[],
  wantJson: boolean,
): Promise<string> {
  const prompt = buildCodexPrompt(
    wantJson ? `${system}\n\nIMPORTANT: Respond with valid JSON only. No markdown fences.` : system,
    messages,
  );
  return codexAsk(prompt, {
    workingDirectory: process.cwd(),
    model: cfg.model && cfg.model !== "default" ? cfg.model : undefined,
  });
}

registerProvider({
  name: "codex",
  label: "OpenAI Codex CLI",
  defaultModel: "default",
  envVarNames: [], // Only available via runtime override
  buildConfig: (apiKey) => ({ provider: "codex", apiKey, model: "default" }),
  call,
});
