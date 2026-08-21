import { CLOUDFLARE_FALLBACK_MODELS } from "@/lib/cloudflare/fallbackModels.ts";
import { DEVIN_FALLBACK_MODELS } from "@/lib/devin/fallbackModels.ts";

export interface ProviderOption {
  readonly id: string;
  readonly name: string;
  readonly models: readonly string[];
  readonly keyEnvVar: string;
  readonly docsUrl: string;
  /** Pre-configured base URL for OpenAI-compatible providers. */
  readonly baseUrl?: string;
  /** Category for grouping in the dropdown. */
  readonly category: "direct" | "router" | "subscription" | "custom";
  /** Human-readable description shown below the provider name. */
  readonly description?: string;
}

export const PROVIDER_OPTIONS: readonly ProviderOption[] = [
  {
    id: "genai",
    name: "Built-in ONNX GenAI",
    models: ["qwen2.5-coder-1.5b-instruct-onnx"],
    keyEnvVar: "Not required",
    docsUrl: "onnxruntime.ai",
    category: "custom",
    description: "Local ONNX Runtime GenAI engine; set up the engine and download its model before use.",
  },
  // ── Direct API Providers ─────────────────────────────────────────────
  {
    id: "gemini",
    name: "Google Gemini",
    models: ["gemini-3.7-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
    keyEnvVar: "GEMINI_API_KEY or GOOGLE_API_KEY",
    docsUrl: "aistudio.google.com",
    category: "direct",
  },
  {
    id: "openai",
    name: "OpenAI",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
    keyEnvVar: "OPENAI_API_KEY",
    docsUrl: "platform.openai.com/api-keys",
    category: "direct",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    models: ["claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-opus-4-8"],
    keyEnvVar: "ANTHROPIC_API_KEY",
    docsUrl: "console.anthropic.com",
    category: "direct",
  },
  {
    id: "mistral",
    name: "Mistral AI",
    models: ["mistral-large-latest", "mistral-medium-latest", "ministral-8b-latest"],
    keyEnvVar: "MISTRAL_API_KEY",
    docsUrl: "console.mistral.ai",
    category: "direct",
  },
  {
    id: "xai",
    name: "xAI (Grok)",
    models: ["grok-3", "grok-3-mini", "grok-2"],
    keyEnvVar: "XAI_API_KEY",
    docsUrl: "console.x.ai",
    baseUrl: "https://api.x.ai/v1",
    category: "direct",
  },
  {
    id: "bedrock",
    name: "AWS Bedrock",
    models: ["anthropic.claude-3-5-haiku-20241022-v1:0"],
    keyEnvVar: "AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY",
    docsUrl: "aws.amazon.com/bedrock",
    category: "direct",
    description:
      "Converse API. Paste accessKeyId:secretAccessKey (optionally :sessionToken), or leave blank for the default AWS credential chain.",
  },
  // ── API Routers & Aggregators ────────────────────────────────────────
  {
    id: "openrouter",
    name: "OpenRouter",
    models: [
      "openai/gpt-4o",
      "anthropic/claude-sonnet-4-6",
      "google/gemini-3.7-flash",
      "meta-llama/llama-4-scout",
      "deepseek/deepseek-r1",
      "qwen/qwen3-235b-a22b",
    ],
    keyEnvVar: "OPENROUTER_API_KEY",
    docsUrl: "openrouter.ai/keys",
    baseUrl: "https://openrouter.ai/api/v1",
    category: "router",
  },
  {
    id: "groq",
    name: "Groq",
    models: ["llama-4-scout-17b-16e-instruct", "gemma2-9b-it", "mixtral-8x7b-32768"],
    keyEnvVar: "GROQ_API_KEY",
    docsUrl: "console.groq.com/keys",
    baseUrl: "https://api.groq.com/openai/v1",
    category: "router",
  },
  {
    id: "together",
    name: "Together AI",
    models: [
      "meta-llama/Llama-4-Scout-17B-16E-Instruct",
      "deepseek-ai/DeepSeek-R1",
      "Qwen/Qwen3-235B-A22B-Instruct-2507",
    ],
    keyEnvVar: "TOGETHER_API_KEY",
    docsUrl: "api.together.xyz/settings/api-keys",
    baseUrl: "https://api.together.xyz/v1",
    category: "router",
  },
  {
    id: "fireworks",
    name: "Fireworks AI",
    models: ["accounts/fireworks/models/llama-v3p3-70b-instruct"],
    keyEnvVar: "FIREWORKS_API_KEY",
    docsUrl: "fireworks.ai/account/api-keys",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    category: "router",
  },
  {
    id: "nvidia",
    name: "NVIDIA NIM",
    models: ["meta/llama-3.1-8b-instruct"],
    keyEnvVar: "NVIDIA_API_KEY",
    docsUrl: "build.nvidia.com",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    category: "router",
  },
  {
    id: "huggingface",
    name: "Hugging Face Router",
    models: ["meta-llama/Meta-Llama-3-8B-Instruct"],
    keyEnvVar: "HF_TOKEN or HUGGINGFACE_API_KEY",
    docsUrl: "huggingface.co/settings/tokens",
    baseUrl: "https://router.huggingface.co/v1",
    category: "router",
  },
  {
    id: "opencode",
    name: "OpenCode Zen",
    models: ["kimi-k2.7-code", "claude-3-5-sonnet", "deepseek-r1", "gpt-4o", "meta-llama/llama-3.3-70b-instruct"],
    keyEnvVar: "OPENCODE_API_KEY",
    docsUrl: "opencode.ai",
    baseUrl: "https://opencode.ai/zen/v1",
    category: "router",
  },
  {
    id: "opencode-go",
    name: "OpenCode Go",
    models: ["kimi-k2.7-code", "claude-3-5-sonnet", "deepseek-r1", "gpt-4o", "meta-llama/llama-3.3-70b-instruct"],
    keyEnvVar: "OPENCODE_API_KEY",
    docsUrl: "opencode.ai",
    baseUrl: "https://opencode.ai/zen/go/v1",
    category: "router",
  },
  // ── Subscription / gateway services ─────────────────────────────────
  {
    id: "cloudflare",
    name: "Cloudflare Workers AI",
    models: CLOUDFLARE_FALLBACK_MODELS.map((m) => m.id),
    keyEnvVar: "CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID",
    docsUrl: "developers.cloudflare.com/workers-ai",
    category: "subscription",
  },
  {
    id: "codex",
    name: "ChatGPT Plus/Pro OAuth",
    models: ["default", "o3", "o4-mini", "gpt-5"],
    keyEnvVar: "",
    docsUrl: "developers.openai.com/codex/auth",
    category: "subscription",
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "claude-sonnet-4"],
    keyEnvVar: "GITHUB_COPILOT_TOKEN or GITHUB_TOKEN",
    docsUrl: "github.com/settings/copilot",
    baseUrl: "https://api.githubcopilot.com",
    category: "subscription",
  },
  {
    id: "kilocode",
    name: "Kilo Gateway",
    models: ["anthropic/claude-sonnet-4", "openai/gpt-4o", "google/gemini-3.7-flash", "deepseek/deepseek-r1"],
    keyEnvVar: "KILO_API_KEY or KILOCODE_API_KEY",
    docsUrl: "kilo.ai/docs/gateway",
    baseUrl: "https://api.kilo.ai/api/gateway",
    category: "subscription",
  },
  {
    id: "devin",
    name: "Devin",
    models: DEVIN_FALLBACK_MODELS.map((m) => m.id),
    keyEnvVar: "",
    docsUrl: "devin.ai",
    category: "subscription",
  },
  // ── Custom / Self-Hosted ─────────────────────────────────────────────
  {
    id: "openai-compat",
    name: "OpenAI-Compatible",
    models: [],
    keyEnvVar: "",
    docsUrl: "",
    category: "custom",
  },
] as const;

export type ProviderId = (typeof PROVIDER_OPTIONS)[number]["id"];

/**
 * Map legacy / alias provider ids to the catalog entry shown in Settings.
 * `chatgpt-sub` was a duplicate OpenAI Platform key entry under Subscriptions.
 */
export function normalizeUiProviderId(provider: string): ProviderId | null {
  if (provider === "chatgpt-sub") return "openai";
  if (PROVIDER_OPTIONS.some((p) => p.id === provider)) return provider as ProviderId;
  return null;
}

/** Category labels for the dropdown optgroup headers. */
export const CATEGORY_LABELS: Record<string, string> = {
  direct: "Direct API Key Providers",
  router: "API Routers & Aggregators",
  subscription: "Subscription Services",
  custom: "Custom / Self-Hosted",
};

/** Re-export local engine starters from lib (server/lib safe). */
export type { LocalEngine, LocalStarterModel } from "../../../lib/localEngineStarters.ts";
export {
  LMS_STARTER_MODELS,
  OLLAMA_STARTER_MODELS,
  MODEL_ID_FUZZY_MIN_LEN,
  normalizeModelIdStem,
  stemsLooselyMatch,
  findInstalledStarterId,
  resolveLocalEnableModelId,
} from "../../../lib/localEngineStarters.ts";
