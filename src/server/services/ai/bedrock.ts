/**
 * AWS Bedrock AI provider — Converse API.
 *
 * Supports dual credential mode:
 *  1. UI-entered: user pastes AWS access key + secret key + region in the settings panel.
 *     These are passed via ProviderConfig.apiKey as a packed string:
 *     `<accessKeyId>:<secretAccessKey>` (region comes from baseUrl field as the region string).
 *  2. Auto-detect: if no explicit keys are provided, falls back to the default AWS credential
 *     chain (env vars, ~/.aws/credentials, IAM role, etc.) via @aws-sdk/credential-providers.
 *
 * The Converse API provides a unified interface to all Bedrock models (Claude, Llama,
 * Mistral, Cohere, Titan, etc.) without provider-specific request/response formatting.
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
  type ContentBlock,
  type SystemContentBlock,
} from "@aws-sdk/client-bedrock-runtime";
import { fromIni } from "@aws-sdk/credential-providers";
import type { ProviderConfig, AIChatMessage } from "../../types.ts";
import { registerProvider } from "./registry.ts";
import { AWS_REGION_PATTERN } from "./security.ts";

// ─── Credential Resolution ────────────────────────────────────────────────────

/**
 * Resolves the AWS region from provider config or environment.
 *
 * Priority: baseUrl field (used as region in Bedrock config) → AWS_REGION env →
 * AWS_DEFAULT_REGION env → us-east-1 fallback.
 */
function resolveRegion(cfg: ProviderConfig): string {
  // The UI stores the region in the baseUrl field (repurposed for Bedrock).
  const regionFromConfig = cfg.baseUrl?.trim();
  if (regionFromConfig && AWS_REGION_PATTERN.test(regionFromConfig)) {
    return regionFromConfig;
  }
  return process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim() || "us-east-1";
}

/**
 * Determines whether the provider config contains explicit UI-entered AWS credentials.
 *
 * The apiKey field packs access key and secret as `accessKeyId:secretAccessKey`.
 * AWS access key IDs are always 20 characters starting with "AKIA" or "ASIA".
 */
function hasExplicitCredentials(cfg: ProviderConfig): boolean {
  if (!cfg.apiKey?.trim()) return false;
  // A packed credential looks like: AKIAIOSFODNN7EXAMPLE:wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
  if (!cfg.apiKey.includes(":") || !/^A[KS]IA/.test(cfg.apiKey)) return false;
  // Reject half-packed keys (missing secret) so the default credential chain
  // is used instead of sending an empty secret to AWS.
  return cfg.apiKey.slice(cfg.apiKey.indexOf(":") + 1).trim().length > 0;
}

/**
 * Detects a half-packed credential (access key present, secret missing). These
 * must surface an error instead of silently falling back to the default
 * chain, which would authenticate as an entirely different account.
 */
function hasHalfPackedCredentials(cfg: ProviderConfig): boolean {
  if (!cfg.apiKey?.trim() || !cfg.apiKey.includes(":") || !/^A[KS]IA/.test(cfg.apiKey)) return false;
  return cfg.apiKey.slice(cfg.apiKey.indexOf(":") + 1).trim().length === 0;
}

/**
 * Creates a BedrockRuntimeClient with appropriate credentials.
 *
 * When explicit credentials are packed in apiKey, uses them directly.
 * Otherwise falls back to the default credential provider chain which checks:
 * env vars → shared credentials file (~/.aws/credentials) → IAM role → SSO.
 */
function createBedrockClient(cfg: ProviderConfig): BedrockRuntimeClient {
  if (hasHalfPackedCredentials(cfg)) {
    throw new Error(
      "Bedrock credentials are incomplete: an access key was provided without a secret key. " +
        "Enter both as accessKeyId:secretAccessKey, or clear the key to use the default AWS credential chain.",
    );
  }

  const region = resolveRegion(cfg);

  if (hasExplicitCredentials(cfg)) {
    const colonIdx = cfg.apiKey.indexOf(":");
    const accessKeyId = cfg.apiKey.slice(0, colonIdx);
    const secretAccessKey = cfg.apiKey.slice(colonIdx + 1);
    return new BedrockRuntimeClient({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  // Auto-detect: use the default chain. If AWS_PROFILE is set, use that profile.
  const profile = process.env.AWS_PROFILE?.trim();
  if (profile) {
    return new BedrockRuntimeClient({
      region,
      credentials: fromIni({ profile }),
    });
  }

  // Default credential chain (env vars, ~/.aws/credentials default profile, instance role, etc.)
  return new BedrockRuntimeClient({ region });
}

// ─── Converse API Call ────────────────────────────────────────────────────────

async function call(
  cfg: ProviderConfig,
  system: string,
  messages: AIChatMessage[],
  wantJson: boolean,
): Promise<string> {
  const client = createBedrockClient(cfg);

  const sysText = wantJson
    ? `${system}\n\nIMPORTANT: Respond with valid JSON only. No markdown fences, no text outside the JSON object.`
    : system;

  const systemContent: SystemContentBlock[] = [{ text: sysText }];

  const converseMessages: Message[] = messages.map((m) => ({
    role: m.role,
    content: [{ text: m.content }] as ContentBlock[],
  }));

  const command = new ConverseCommand({
    modelId: cfg.model,
    system: systemContent,
    messages: converseMessages,
    inferenceConfig: {
      maxTokens: 4096,
    },
  });

  // Bound the request so a hung connection cannot block the caller forever.
  const response = await client.send(command, {
    abortSignal: AbortSignal.timeout(120_000),
  });

  const outputMessage = response.output?.message;
  if (!outputMessage?.content?.length) {
    throw new Error("Bedrock returned an empty response.");
  }

  // Extract text from content blocks
  const textParts: string[] = [];
  for (const block of outputMessage.content) {
    if ("text" in block && block.text) {
      textParts.push(block.text);
    }
  }

  const text = textParts.join("");
  if (!text.trim()) {
    throw new Error("Bedrock returned an empty response.");
  }

  // Surface stop reason errors
  if (response.stopReason === "max_tokens") {
    console.warn("[bedrock] Response was truncated due to max_tokens limit.");
  }

  return text;
}

// ─── Registration ─────────────────────────────────────────────────────────────

/**
 * Detects whether AWS credentials are available via environment or shared config.
 * Used during env detection to determine if Bedrock can be auto-configured.
 */
registerProvider({
  name: "bedrock",
  label: "AWS Bedrock",
  defaultModel: "anthropic.claude-3-5-haiku-20241022-v1:0",
  // No defaultBaseUrl — Bedrock uses the AWS SDK, not HTTP endpoints directly.
  // The baseUrl field is repurposed to store the AWS region.
  // AWS_PROFILE alone is enough for the default chain, so detect it too.
  envVarNames: ["AWS_ACCESS_KEY_ID", "AWS_PROFILE"],
  buildConfig: (apiKey) => {
    const secretKey = process.env.AWS_SECRET_ACCESS_KEY?.trim() ?? "";
    return {
      provider: "bedrock",
      apiKey: `${apiKey}:${secretKey}`,
      model: "anthropic.claude-3-5-haiku-20241022-v1:0",
      baseUrl: process.env.AWS_REGION?.trim() || "us-east-1",
    };
  },
  call,
  supportsJsonResponseFormat: false,
});
