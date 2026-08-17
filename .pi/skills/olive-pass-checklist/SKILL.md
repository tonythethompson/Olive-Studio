---
name: olive-pass-checklist
description: Add a new optimization pass or a new AI provider to Olive Studio. Use when implementing a new Olive pass type / quantizer / graph transformation, or integrating a new LLM API / OpenAI-compatible endpoint / custom inference provider.
---

# Add a Pass or Provider — Checklists

Two complete checklists, ported from `.kiro/powers/olive-studio-dev/skills/`. Every step is required.

---

## Part A — Add a New Optimization Pass

A new pass touches types, defaults, the recipe builder, validation, the catalog (client + MCP KB), the UI, and tests.

### 1. UIState fields — `src/types.ts` → `passes`
Add toggle and config fields:
```typescript
myNewPass: boolean;
myNewPassConfig?: string;
```

### 2. Defaults — `src/lib/defaultPasses.ts`
```typescript
myNewPass: false,
myNewPassConfig: "default_value",
```

### 3. Builder function — `src/lib/oliveRecipeBuilder.ts`
```typescript
function buildMyNewPass(state: UIState, ctx: RecipeBuildContext): PassSpec | undefined {
  if (!state.passes.myNewPass) return undefined;
  return { type: "MyNewOlivePass", config: { /* map UIState → Olive config */ } };
}

const PASS_BUILDERS = { /* ... */ my_new_pass: buildMyNewPass };
```

### 4. Pass ordering — `oliveRecipeBuilder.ts` → `preferredPassOrder()`
Insert at the correct position relative to dependencies:
- Needs ONNX conversion first? → place **after** `conversion`
- Torch-native operation? → place **before** `conversion`
- Conflicts with quantization? → check both orderings

Standard ONNX path: `peft → pruning → conversion → transformer_opt → quantization → splitting`
PyTorch-native quant: `peft → pruning → quantization → conversion → transformer_opt → splitting`

### 5. Cross-pass rules — `src/lib/pipelineValidation.ts` → `CROSS_PASS_RULES`
Add a rule if the pass conflicts with others:
```typescript
{
  id: "my-new-pass-conflict-id",
  applies: (passes, provider) => passes.myNewPass && /* conflict condition */,
  fix: { myNewPass: false },
  autoCoerce: true,   // true = silent, idempotent, never surprises; false = issue + fix button
  severity: "critical",
  title: "Human-readable title",
  description: "Why this combination fails.",
  affectedTabs: ["relevant_tabs"],
  affectedPasses: ["my_new_pass", "conflicting_pass"],
  actionLabel: "Fix action label",
}
```
- `autoCoerce: true` — only for idempotent fixes that never surprise the user; runs on every `commitUiStateUpdate`, must be cheap.
- `autoCoerce: false` — surfaces an issue with a fix button; user decides.

### 6. Provider conflicts — `pipelineValidation.ts` → `getProviderConflicts()`
If the pass requires specific hardware:
- GPU-only → block on CPU/NPU
- QNN-only → block on non-QNN EPs
- Intel-only → block on non-OpenVINO EPs

### 7. Pass catalog — BOTH locations required
- **Client:** `src/lib/passCatalog.ts` — metadata for UI display (name, description, category)
- **MCP KB:** `olive-mcp-server/olive_mcp_server/knowledge_base/passes.json` — full entry: name, type, class, description, input/output formats, params, hardware requirements, gotchas

### 8. Schema engine registration — `src/lib/schemaEngine.ts` → `isKnownPass()`
New pass types must be recognized here (checks the static catalog AND dynamically loaded MCP KB passes). Unknown types → `getPassCatalogIssues()` flags a "critical" issue blocking execution.

### 9. UI component — `src/components/features/` (appropriate panel)
Add toggle + config controls; connect to the zustand store via `usePipelineStore`.

### 10. Tests
- **Unit:** `src/lib/__tests__/` — builder in isolation, cross-pass rule interactions, provider conflict gates
- **Recipe validation:** `scripts/validate-recipe-builder.ts` — add combinations exercising the new pass

### Verify
```bash
pnpm validate:recipe && pnpm test && pnpm lint:quick
```

---

## Part B — Add a New AI Provider

A new provider is a side-effect-imported plugin. The assistant is on the backburner — only do this when explicitly requested. Prefer Custom / `openai-compat` for OpenAI-shaped hosts until a first-class entry is justified.

### 1. Add the provider id — `src/server/types.ts`
Add the new id to `ProviderConfig["provider"]` **first**.

### 2. Create provider file — `src/server/services/ai/myProvider.ts`
Implement `AiProviderPlugin`:
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
  call: (cfg, system, messages, wantJson) => callOpenAICompat(cfg, system, messages, wantJson),
};

registerProvider(plugin);
```
- `name` and `buildConfig().provider` must be the **new** id. Reusing `"openai-compat"` throws — `registerProvider` rejects duplicate names.
- Config uses `baseUrl`, not `endpoint`.
- Required plugin fields: `name`, `label`, `defaultModel`, `envVarNames`, `buildConfig`, `call`.
- For OpenAI-compatible providers, reuse `callOpenAICompat` from `openai.ts` with a custom base URL.
- For non-standard auth (SigV4, OAuth, custom headers): implement auth in `buildConfig` or `call`; store credentials via **environment variables only** — never hardcode secrets.
- `call` returns `Promise<string>` (full assistant text). Do NOT invent a `stream` option — streaming is handled by the Express chat route, not the plugin.

### 3. Side-effect import — `src/server/services/ai/index.ts`
```typescript
import "./myProvider.ts";
```

### 4. UI catalog — `src/components/features/assistant/aiProviderCatalog.ts` → `PROVIDER_OPTIONS`
```typescript
{
  value: "my-provider",
  label: "My Provider",
  description: "Short description",
  envVar: "MY_PROVIDER_API_KEY",
  docsUrl: "https://docs.myprovider.com",
}
```
The UI shows the provider as "available" when at least one env var in `envVarNames` is set.

### 5. Verify
```bash
pnpm test:server && pnpm lint:quick
```
Check: provider appears in the settings/assistant panel, env detection works, messages route correctly, errors return friendly messages.

### Rules
- Never modify the registry Map directly — always `registerProvider(plugin)`
- Provider files are side-effect imported — they self-register at load
- The registry is a singleton — no duplicate names
- Env vars are the ONLY way to configure credentials (no config files, no UI input for secrets)

## Candidates (per AGENTS.md)

First-class providers under consideration (only when demand justifies): Azure OpenAI / Foundry, AWS Bedrock, Google Vertex AI, IBM watsonx, Perplexity, Qwen/DashScope, Nous Portal, DeepSeek, Kimi/Moonshot, GLM/Zhipu, MiniMax. Most thin OpenAI-compatible ones work today via Custom. Out of scope: Microsoft 365 Agents / Copilot Studio agents, OpenClaw / Hermes agent gateways, Cursor SDK (agent runtimes, not chat providers).
