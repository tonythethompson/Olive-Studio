---
name: add-provider
description: Add a new AI provider to Olive Studio's assistant system. Use when integrating a new LLM API, adding an OpenAI-compatible endpoint, or registering a custom inference provider.
---

# Add a New AI Provider

Complete checklist for adding a new AI provider to the Olive Studio assistant.

## Step 1: Create Provider File

**Directory:** `src/server/services/ai/`

Add the new provider id to `ProviderConfig["provider"]` in `src/server/types.ts` first.
Then create `myProvider.ts` implementing `AiProviderPlugin`:

```typescript
import type { ProviderConfig } from "../../types.ts";
import { registerProvider, type AiProviderPlugin } from "./registry.ts";
import { callOpenAICompat } from "./openai.ts";

const plugin: AiProviderPlugin = {
  name: "my-provider",
  label: "My Provider",
  defaultModel: "model-name",
  defaultBaseUrl: "https://api.myprovider.com/v1",
  envVarNames: ["MY_PROVIDER_API_KEY"],

  buildConfig: (apiKey) => ({
    provider: "my-provider",
    apiKey,
    model: "model-name",
    baseUrl: "https://api.myprovider.com/v1",
  }),

  call: (cfg, system, messages, wantJson) =>
    callOpenAICompat(cfg, system, messages, wantJson),
};

registerProvider(plugin);
```

`name` and `buildConfig().provider` must be the **new** id (add it to `ProviderConfig["provider"]` first). Reusing `"openai-compat"` throws at import: `registerProvider` rejects duplicate names. Config uses `baseUrl`, not `endpoint`. Required plugin fields: `name`, `label`, `defaultModel`, `envVarNames`, `buildConfig`, `call`.

## Step 2: Side-Effect Import

**File:** `src/server/services/ai/index.ts`

Add the import so the provider registers at module load:
```typescript
import "./myProvider.ts";
```

## Step 3: Add to UI Catalog

**File:** `src/components/features/assistant/aiProviderCatalog.ts` → `PROVIDER_OPTIONS`

Add an entry so it appears in the provider selection UI:
```typescript
{
  value: "my-provider",
  label: "My Provider",
  description: "Short description",
  envVar: "MY_PROVIDER_API_KEY",
  docsUrl: "https://docs.myprovider.com",
}
```

## Step 4: Handle Authentication

Providers detect availability via environment variables. The `envVarNames` array lists which env vars to check. The UI shows the provider as "available" when at least one is set.

For OpenAI-compatible providers, you can extend the base OpenAI handler rather than writing from scratch.

## Step 5: Test

Verify:
1. Provider appears in the settings/assistant panel
2. Environment detection works (set/unset the env var)
3. Messages route correctly through the provider
4. Error handling returns user-friendly messages

```bash
pnpm test:server   # Server unit tests
pnpm lint:quick    # Quick lint
```

## Common Patterns

### OpenAI-Compatible Providers

Most providers today are OpenAI-compatible. Use the shared OpenAI handler with custom base URL:
- Set `defaultBaseUrl` on the plugin and `baseUrl` in `buildConfig`
- Reuse `callOpenAICompat` from `openai.ts`
- Override only model names and auth headers

### Providers with Custom Auth

For non-standard auth (SigV4, OAuth, custom headers):
- Implement auth in `buildConfig` or `call`
- Store tokens/credentials via environment variables only
- Never hardcode secrets

### Streaming Support

`AiProviderPlugin.call` returns `Promise<string>` (the full assistant text).
Do not invent a `stream` option on `call`; streaming is handled by the Express chat route, not the plugin.

## Important Rules

- Never modify the registry Map directly — always use `registerProvider(plugin)`
- Provider files are side-effect imported — they self-register at load time
- The registry is a singleton — no duplicate names allowed
- Env vars are the ONLY way to configure credentials (no config files, no UI input for secrets)
