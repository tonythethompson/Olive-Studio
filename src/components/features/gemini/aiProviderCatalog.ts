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
  // ── Direct API Providers ─────────────────────────────────────────────
  {
    id: "gemini",
    name: "Google Gemini",
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
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
    description: "Grok models by xAI",
  },
  // ── API Routers & Aggregators ────────────────────────────────────────
  {
    id: "openrouter",
    name: "OpenRouter",
    models: [
      "openai/gpt-4o",
      "anthropic/claude-sonnet-4-6",
      "google/gemini-2.5-flash",
      "meta-llama/llama-4-scout",
      "deepseek/deepseek-r1",
      "qwen/qwen3-235b-a22b",
    ],
    keyEnvVar: "OPENROUTER_API_KEY",
    docsUrl: "openrouter.ai/keys",
    baseUrl: "https://openrouter.ai/api/v1",
    category: "router",
    description: "Access 200+ models via one API key",
  },
  {
    id: "groq",
    name: "Groq",
    models: ["llama-4-scout-17b-16e-instruct", "gemma2-9b-it", "mixtral-8x7b-32768"],
    keyEnvVar: "GROQ_API_KEY",
    docsUrl: "console.groq.com/keys",
    baseUrl: "https://api.groq.com/openai/v1",
    category: "router",
    description: "Ultra-fast inference on Groq LPU",
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
    description: "Open-source model hosting & inference",
  },
  {
    id: "fireworks",
    name: "Fireworks AI",
    models: ["accounts/fireworks/models/llama-v3p3-70b-instruct"],
    keyEnvVar: "FIREWORKS_API_KEY",
    docsUrl: "fireworks.ai/account/api-keys",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    category: "router",
    description: "Fast OpenAI-compatible inference",
  },
  {
    id: "nvidia",
    name: "NVIDIA NIM",
    models: ["meta/llama-3.1-8b-instruct"],
    keyEnvVar: "NVIDIA_API_KEY",
    docsUrl: "build.nvidia.com",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    category: "router",
    description: "NVIDIA hosted OpenAI-compatible endpoints",
  },
  {
    id: "huggingface",
    name: "Hugging Face Router",
    models: ["meta-llama/Meta-Llama-3-8B-Instruct"],
    keyEnvVar: "HF_TOKEN or HUGGINGFACE_API_KEY",
    docsUrl: "huggingface.co/settings/tokens",
    baseUrl: "https://router.huggingface.co/v1",
    category: "router",
    description: "HF Inference router (OpenAI-compatible)",
  },
  {
    id: "opencode",
    name: "OpenCode Zen",
    models: ["default"],
    keyEnvVar: "OPENCODE_API_KEY",
    docsUrl: "opencode.ai",
    baseUrl: "https://opencode.ai/zen/v1",
    category: "router",
    description: "OpenCode Zen gateway",
  },
  {
    id: "opencode-go",
    name: "OpenCode Go",
    models: ["default"],
    keyEnvVar: "OPENCODE_API_KEY",
    docsUrl: "opencode.ai",
    baseUrl: "https://opencode.ai/zen/go/v1",
    category: "router",
    description: "OpenCode Go gateway",
  },
  // ── Subscription / gateway services ─────────────────────────────────
  {
    id: "cloudflare",
    name: "Cloudflare Workers AI",
    models: ["@cf/meta/llama-3.1-8b-instruct"],
    keyEnvVar: "CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID",
    docsUrl: "developers.cloudflare.com/workers-ai",
    category: "subscription",
    description: "Account-scoped Workers AI (token + account id; base URL auto-filled from env)",
  },
  {
    id: "codex",
    name: "OpenAI Codex",
    models: ["default", "o3", "o4-mini", "gpt-5"],
    keyEnvVar: "",
    docsUrl: "developers.openai.com/codex/auth",
    category: "subscription",
    description: "ChatGPT Plus/Pro Codex allowance — Sign in with ChatGPT (local app-server)",
  },
  {
    id: "chatgpt-sub",
    name: "OpenAI API key",
    models: ["gpt-4o", "gpt-4o-mini", "o4-mini"],
    keyEnvVar: "OPENAI_API_KEY",
    docsUrl: "platform.openai.com/api-keys",
    category: "subscription",
    description: "Platform API key (usage-based). Not ChatGPT web login.",
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "claude-sonnet-4"],
    keyEnvVar: "GITHUB_COPILOT_TOKEN or GITHUB_TOKEN",
    docsUrl: "github.com/settings/copilot",
    baseUrl: "https://api.githubcopilot.com",
    category: "subscription",
    description: "Copilot chat endpoint (session/OAuth token; classic PAT often fails)",
  },
  {
    id: "kilocode",
    name: "Kilo Gateway",
    models: ["anthropic/claude-sonnet-4", "openai/gpt-4o", "google/gemini-2.5-flash", "deepseek/deepseek-r1"],
    keyEnvVar: "KILO_API_KEY or KILOCODE_API_KEY",
    docsUrl: "kilo.ai/docs/gateway",
    baseUrl: "https://api.kilo.ai/api/gateway",
    category: "subscription",
    description: "Official Kilo AI Gateway (OpenAI-compatible)",
  },
  {
    id: "devin",
    name: "Devin",
    models: ["swe-1-6", "swe-1-7", "claude-sonnet-4", "claude-opus-4", "gpt-4o", "kimi-k2"],
    keyEnvVar: "",
    docsUrl: "devin.ai",
    category: "subscription",
    description: "Devin subscription (not a model) — unlocks multiple models via Sign in with Devin",
  },
  // ── Custom / Self-Hosted ─────────────────────────────────────────────
  {
    id: "openai-compat",
    name: "OpenAI-Compatible",
    models: [],
    keyEnvVar: "",
    docsUrl: "",
    category: "custom",
    description: "Ollama, vLLM, LiteLLM, or any OpenAI-compatible endpoint",
  },
] as const;

export type ProviderId = (typeof PROVIDER_OPTIONS)[number]["id"];

/** Category labels for the dropdown optgroup headers. */
export const CATEGORY_LABELS: Record<string, string> = {
  direct: "Direct API Providers",
  router: "API Routers & Aggregators",
  subscription: "Subscription Services",
  custom: "Custom / Self-Hosted",
};

/** LM Studio starter models for local AI. */
export const LMS_STARTER_MODELS = [
  {
    tag: "qwen2.5-coder-1.5b-instruct",
    name: "Qwen2.5-Coder (1.5B)",
    desc: "⭐ Recommended: Best tool-calling accuracy & Olive recipe precision",
    fallbackSize: "1.1 GB",
  },
  {
    tag: "llama-3.2-1b-instruct",
    name: "Llama-3.2 (1B)",
    desc: "⚡ Ultra-lightweight: Lowest RAM footprint (<1.2GB)",
    fallbackSize: "800 MB",
  },
  {
    tag: "phi-3.5-mini-instruct",
    name: "Phi-3.5-Mini (3.8B)",
    desc: "🧠 Advanced Reasoning: Complex compiler co-design",
    fallbackSize: "2.2 GB",
  },
] as const;

/** Ollama starter models for local AI. */
export const OLLAMA_STARTER_MODELS = [
  {
    tag: "qwen2.5-coder:1.5b",
    name: "Qwen2.5-Coder (1.5B)",
    desc: "⭐ Recommended: Best tool-calling accuracy & Olive recipe precision",
    fallbackSize: "1.1 GB",
  },
  {
    tag: "llama3.2:1b",
    name: "Llama-3.2 (1B)",
    desc: "⚡ Ultra-lightweight: Lowest RAM footprint (<1.2GB)",
    fallbackSize: "800 MB",
  },
  {
    tag: "phi3.5",
    name: "Phi-3.5-Mini",
    desc: "🧠 Advanced Reasoning: Complex compiler co-design",
    fallbackSize: "~2 GB",
  },
] as const;

/** A local engine that can serve models from the user's machine. */
export type LocalEngine = "lms" | "ollama";
