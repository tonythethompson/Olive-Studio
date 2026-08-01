import type { ProviderConfig, AIChatMessage } from "../../types.ts";
import { registerProvider } from "./registry.ts";
import { callOpenAICompat } from "./openai.ts";
import {
  cloudflareProviderExtras,
  DEFAULT_CLOUDFLARE_MODEL,
  resolveCloudflareAuth,
} from "../../../lib/cloudflare/client.ts";
import { cloudflareAiBaseUrl, isValidCloudflareAccountId } from "../../../lib/cloudflare/credentials.ts";

/**
 * Sends a chat completion request through the Cloudflare Workers AI provider.
 *
 * @param cfg - Provider configuration, including optional credentials, model, base URL, and timeout
 * @param system - System prompt for the request
 * @param messages - Chat messages to send
 * @param wantJson - Whether to request a JSON-formatted response
 * @returns The generated response text
 */
async function call(
  cfg: ProviderConfig,
  system: string,
  messages: AIChatMessage[],
  wantJson: boolean,
): Promise<string> {
  const extras = cloudflareProviderExtras(cfg.model);
  const cfgKey = cfg.apiKey?.trim();
  const cfgBase = cfg.baseUrl?.trim();
  const useCfgAuth = Boolean(cfgKey && cfgBase);
  return callOpenAICompat(
    {
      provider: "cloudflare",
      apiKey: useCfgAuth ? cfgKey! : cfgKey || extras.apiKey,
      model: cfg.model || extras.model,
      baseUrl: useCfgAuth ? cfgBase! : cfgBase || extras.baseUrl,
      timeoutMs: cfg.timeoutMs,
    },
    system,
    messages,
    wantJson,
  );
}

registerProvider({
  name: "cloudflare",
  label: "Cloudflare Workers AI",
  defaultModel: DEFAULT_CLOUDFLARE_MODEL,
  envVarNames: ["CLOUDFLARE_API_TOKEN"],
  buildConfig: (apiKey) => {
    const envAccount = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
    const auth = resolveCloudflareAuth();
    const accountId =
      (envAccount && isValidCloudflareAccountId(envAccount) ? envAccount : undefined) ?? auth?.accountId;
    return {
      provider: "cloudflare",
      apiKey: apiKey || auth?.apiToken || "",
      model: DEFAULT_CLOUDFLARE_MODEL,
      ...(accountId ? { baseUrl: cloudflareAiBaseUrl(accountId) } : {}),
    };
  },
  call,
  supportsJsonResponseFormat: true,
});
