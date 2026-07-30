// Re-exports from the registry-based provider system for backward compatibility.
export { detectEnvProvider, getProvider, callProvider, registeredProviderNames } from "./registry.ts";
export { getAiProvider, ALLOWED_AI_PROVIDERS, callAI } from "./index.ts";
export { setRuntimeAiProvider } from "./state.ts";
export type { ProviderConfig, AIChatMessage } from "../../types.ts";
