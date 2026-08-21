/**
 * Curated fallback Cloudflare Workers AI models when live catalog is unavailable.
 */

export const CLOUDFLARE_FALLBACK_MODELS: Array<{ id: string; name: string }> = [
  { id: "@cf/meta/llama-3.1-8b-instruct", name: "Llama 3.1 8B Instruct" },
  { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", name: "Llama 3.3 70B Instruct (fast)" },
  { id: "@cf/qwen/qwen3-30b-a3b-fp8", name: "Qwen3 30B A3B" },
  { id: "@cf/openai/gpt-oss-120b", name: "GPT-OSS 120B" },
  { id: "@cf/google/gemma-3-12b-it", name: "Gemma 3 12B" },
];

export const DEFAULT_CLOUDFLARE_MODEL = CLOUDFLARE_FALLBACK_MODELS[0]!.id;
