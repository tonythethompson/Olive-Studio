---
name: add-provider
description: Add a new AI provider to Olive Studio's assistant system. Use when integrating a new LLM API, adding an OpenAI-compatible endpoint, or registering a custom inference provider.
---

# Add a New AI Provider

Complete checklist for adding a new AI provider to the Olive Studio assistant.

## Step 1: Create Provider File

**Directory:** `src/server/services/ai/`

Create `myProvider.ts` implementing the `AiProviderPlugin` interface:

```typescript
import { registerProvider, type AiProviderPlugin } from "./registry.js";

const plugin: AiProviderPlugin = {
  name: "my-provider",
  label: "My Provider",
  defaultModel: "model-name",
  envVarNames: ["MY_PROVIDER_API_KEY"],

  buildConfig(env) {
    return {
      apiKey: env.MY_PROVIDER_API_KEY,
      baseUrl: "https://api.myprovider.com/v1",
    };
  },

  async call(messages, config, options) {
    // Implement the chat completion call
    // Return { content: string, usage?: { ... } }
  },
};

registerProvider(plugin);
```

## Step 2: Side-Effect Import

**File:** `src/server/services/ai/index.ts`

Add the import so the provider registers at module load:
```typescript
import "./myProvider.js";
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
- Set `baseUrl` in `buildConfig`
- Reuse the standard chat completion call path
- Override only model names and auth headers

### Providers with Custom Auth

For non-standard auth (SigV4, OAuth, custom headers):
- Implement auth in `buildConfig` or `call`
- Store tokens/credentials via environment variables only
- Never hardcode secrets

### Streaming Support

If the provider supports streaming:
- Return an async iterator from `call` when `options.stream` is true
- The Express route handles SSE framing automatically

## Important Rules

- Never modify the registry Map directly — always use `registerProvider(plugin)`
- Provider files are side-effect imported — they self-register at load time
- The registry is a singleton — no duplicate names allowed
- Env vars are the ONLY way to configure credentials (no config files, no UI input for secrets)
