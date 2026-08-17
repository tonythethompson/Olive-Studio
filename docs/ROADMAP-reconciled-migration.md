# Roadmap: Reconciled Migration Plan

Unified migration plan combining the ATX codebase analysis (dependency-aware component ordering, technical debt assessment) with Kiro's MCP TypeScript port roadmap and AI SDK adoption plan. Where the two plans differed, this document picks the simpler path.

---

## Guiding Principles

1. **Single runtime.** Eliminate Python. One `pnpm install` → `pnpm dev` for everything.
2. **AI SDK as the provider abstraction.** Delete the hand-rolled registry; use `generateText`/`streamText` with official provider packages.
3. **No premature monorepo.** Keep the flat `src/` structure. The MCP server becomes a TypeScript module inside the project, not a separate workspace package. Revisit `packages/` only if a concrete need emerges.
4. **Ship incrementally.** Each phase is independently deployable. Python remains as fallback until fully validated.

---

## Current Pain Points (from both analyses)

- Python venv management (5+ min install, `mcp<2` pin fragility)
- 8 provider files doing raw `fetch` with per-provider request/response shapes
- HTTP bridge overhead (MCP tool → loopback POST → Express → service)
- Type duplication between Python and TypeScript
- `parseJsonFromAiResponse` / `softRepairJson` fragility

---

## Phase 1: AI SDK Provider Collapse (~1 day)

**Goal:** Replace 8 provider files + registry with AI SDK provider packages.

**Why first:** Lowest risk, highest code reduction, unblocks streaming (Phase 2) and simplifies the MCP port (Phase 4) since tools calling AI no longer need provider internals.

### What Changes

**Delete:**
- `src/server/services/ai/gemini.ts`
- `src/server/services/ai/openai.ts`
- `src/server/services/ai/anthropic.ts`
- `src/server/services/ai/bedrock.ts`
- `src/server/services/ai/cloudflare.ts`
- `src/server/services/ai/codex.ts`
- `src/server/services/ai/devin.ts`
- `src/server/services/ai/genai.ts`

**Replace with:** A single `src/server/services/ai/providers.ts`:

```ts
import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { amazon as bedrock } from '@ai-sdk/amazon-bedrock';
import { createOpenAI } from '@ai-sdk/openai';

// OpenAI-compatible providers use createOpenAI with custom baseURL
const codex = createOpenAI({ baseURL: '...', apiKey: process.env.CODEX_API_KEY });
const devin = createOpenAI({ baseURL: '...', apiKey: process.env.DEVIN_API_KEY });

export function resolveModel(cfg: ProviderConfig) {
  switch (cfg.provider) {
    case 'gemini':     return google(cfg.model, { apiKey: cfg.apiKey });
    case 'openai':     return openai(cfg.model, { apiKey: cfg.apiKey });
    case 'anthropic':  return anthropic(cfg.model, { apiKey: cfg.apiKey });
    case 'bedrock':    return bedrock(cfg.model, { region: cfg.region });
    case 'cloudflare': return openai(cfg.model, { apiKey: cfg.apiKey, baseURL: cfg.baseUrl });
    case 'codex':      return codex(cfg.model);
    case 'devin':      return devin(cfg.model);
    default:           throw new Error(`Unknown provider: ${cfg.provider}`);
  }
}
```

**Simplify `registry.ts`:** Keep `detectEnvProvider()` and `listEnvCredentialStatus()` (UI needs these), but `callProvider()` becomes:

```ts
import { generateText } from 'ai';
import { resolveModel } from './providers.ts';

export async function callProvider(cfg, system, messages, wantJson) {
  const result = await generateText({
    model: resolveModel(cfg),
    system,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    ...(wantJson && { output: Output.object({ schema: responseSchema }) }),
  });
  return wantJson ? JSON.stringify(result.output) : result.text;
}
```

**Keep:** `detect.ts`, `env.ts`, `security.ts`, `state.ts`, `localEngineState.ts`, `oliveMcpKnowledge.ts`

### Dependencies

```
pnpm add ai @ai-sdk/google @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/amazon-bedrock
```

(`@ai-sdk/cloudflare` not needed if Cloudflare Workers AI is OpenAI-compatible — verify)

### Success Criteria

- All existing tests pass (`registry.test.ts`, `bedrock.test.ts`, `providers.validation.test.ts`)
- `detectEnvProvider()` still works
- Chat responses identical to before
- 8 files deleted, ~1 file added

---

## Phase 2: Streaming + Structured Output (~3 days)

**Goal:** Token-by-token streaming in the assistant; schema-validated responses on non-streaming routes.

### Streaming (chat route)

```ts
import { streamText } from 'ai';

// In chatRoutes.ts:
const result = streamText({
  model: resolveModel(cfg),
  system,
  messages,
});
result.pipeTextStreamToResponse(res); // Express response
```

Client-side: replace `await r.json()` with `ReadableStream` consumer in `useAiChat.ts`. Actions sent as final NDJSON chunk.

### Structured Output (validation/analysis routes)

```ts
import { generateText, Output } from 'ai';
import { z } from 'zod';

const result = await generateText({
  model: resolveModel(cfg),
  system,
  messages,
  output: Output.object({ schema: validationSchema }),
});
// Typed, validated output — no parseJsonFromAiResponse needed
```

**Delete:** `softRepairJson`, `scanJsonStringEnd`, fenced-JSON stripping utilities (once all routes migrated).

### Dependencies

```
pnpm add zod
```

### Success Criteria

- Chat shows tokens as they arrive (no "Thinking..." delay)
- Cancel button works (AbortController)
- Validation/analysis routes return typed responses
- JSON parsing utilities removed

---

## Phase 3: MCP TypeScript Port — Keyword Tools (~1 week)

**Goal:** Port all 22 non-semantic MCP tools to TypeScript. No monorepo restructure.

### Architecture Decision: Module, Not Package

Instead of Kiro's `packages/mcp-server/`, place the MCP server at:

```
src/server/mcp/
├── server.ts           (entry point, @modelcontextprotocol/sdk)
├── tools/              (one file per tool group)
├── knowledge-base/     (JSON files from Python)
└── stdio.ts            (standalone stdio entry for external MCP clients)
```

**Rationale:** The MCP tools need to call Olive service modules (`src/server/services/olive/`). In the same TypeScript project, this is a direct import. In a separate workspace package, it requires extracting services into `packages/shared/` — a large refactor for no functional benefit.

The `stdio.ts` entry allows running the server standalone for external MCP clients (Kiro, Claude), while the Express route can import and call tools directly in-process.

### Tool Port Order (from Kiro's plan, grouped by complexity)

**Trivial (copy JSON + return):**
`get_olive_passes`, `get_mcp_capabilities`, `get_integration_recipe`

**Low (light logic):**
`get_pass_parameters`, `get_pass_config_template`, `get_hardware_optimization_guide`, `get_pass_chain`, `get_data_config_template`, `get_model_compatibility`, `get_cli_command`, `get_runtime_ep_hints`, `record_troubleshoot_feedback`, `compare_results`, `get_model_info`

**Medium (business logic):**
`get_quantization_strategy`, `evaluate_optimization_tradeoff`, `validate_ui_state_recipe`, `get_recipe_for_ui_state`, `plan_optimization`, `execute_and_observe`, `diagnose_and_fix`, `get_context_for_pipeline`

**Keyword search (fallback mode):**
`search_olive_documentation`, `troubleshoot_olive_error` — substring + term frequency only

### Dependencies

```
pnpm add @modelcontextprotocol/sdk
```

(`zod` already added in Phase 2)

### Success Criteria

- All 22 tools pass vitest tests
- MCP server responds via stdio
- `.mcp.json` updated to point to TS server
- Keyword search returns reasonable results

---

## Phase 4: Eliminate HTTP Bridge (~2 days)

**Goal:** Studio bridge tools call services directly instead of loopback HTTP.

### What Changes

The 6 Studio tools (`list_optimization_jobs`, `get_optimization_job`, `get_optimization_results`, `validate_optimization_job`, `submit_optimization_job`, `cancel_optimization_job`) currently POST to `localhost:3000/api/olive/...`.

Since the MCP server now lives in `src/server/mcp/`, it directly imports from `src/server/services/olive/`. No HTTP, no serialization.

### Update MCP Route

`src/server/routes/mcp.ts` calls MCP tools in-process instead of spawning a subprocess:

```ts
import { callTool } from '../mcp/server.ts';

router.post('/api/mcp/tool', async (req, res) => {
  const result = await callTool(req.body.name, req.body.arguments);
  res.json(result);
});
```

### Success Criteria

- Zero loopback HTTP calls from MCP tools
- Measurable latency reduction
- Integration tests pass

---

## Phase 5: Semantic Search in TypeScript (~1 week)

**Goal:** Port hybrid semantic + keyword search. This is the highest-risk phase.

### Approach: Pre-computed Only (Simplified from Kiro's plan)

The knowledge base is **static** — it ships with the app and doesn't change at runtime. This means:

1. **Build time:** Generate embeddings for all KB entries and store as `.bin` (Float32Array) + JSON manifest
2. **Runtime:** Load pre-computed embeddings, encode the query, cosine similarity — that's it

This avoids shipping `sentence-transformers` equivalent at runtime for 95% of queries. Only the query needs encoding at runtime.

### Runtime Query Encoding

```ts
import { pipeline } from '@huggingface/transformers';

// Lazy-loaded, cached after first use
let embedder: any;
async function encode(text: string): Promise<Float32Array> {
  embedder ??= await pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5');
  const output = await embedder(text, { pooling: 'cls', normalize: true });
  return output.data;
}
```

### Validation

Port Kiro's compatibility test: encode same queries with Python and TypeScript, assert cosine similarity > 0.99.

### Fallback

If `@huggingface/transformers` fails to load (memory, platform), fall back to keyword-only mode (already working from Phase 3).

### Dependencies

```
pnpm add onnxruntime-node
```

(`@huggingface/transformers` already in root package.json)

### Success Criteria

- `troubleshoot_olive_error` and `search_olive_documentation` return quality-parity results
- Embedding compatibility test passes (>0.99 cosine sim)
- Fallback to keyword-only works when ONNX unavailable

---

## Phase 6: Remove Python (~1 day)

**Goal:** Delete `olive-mcp-server/` and all Python infrastructure.

### Delete

- `olive-mcp-server/` directory
- `scripts/setup-mcp.ps1`, `scripts/setup-mcp.sh`
- `scripts/postinstall-mcp-setup.mjs`
- `.kiro/hooks/check-mcp-venv`
- Python CI jobs (`.github/workflows/ci.yml`: `python-tests`, `olive-pass-availability`, Docker MCP image)

### Update

- `.mcp.json` → point to TS server only
- `AGENTS.md` → remove Python setup instructions
- `README.md` → simplify getting-started (no Python requirement)
- `.kiro/` steering files → update MCP references

### Success Criteria

- Zero Python in the repo
- `pnpm install` → `pnpm dev` is the only setup
- All MCP tools work identically
- CI green

---

## What This Plan Omits (Intentionally)

| Kiro Proposed | This Plan's Position |
|---|---|
| `packages/mcp-server/` workspace package | MCP server at `src/server/mcp/` — same project, direct imports |
| `packages/shared/` types package | Types stay in `src/lib/types/` — already shared within the project |
| `packages/app/` restructure | Not needed. Single Vite build, one team, no benefit |
| `pnpm-workspace.yaml` | Not created. Revisit only if a second build target emerges |
| `cheerio` for HTML parsing | Keep existing approach or defer to when live-docs fetch is needed |

---

## Dependency Graph (Execution Order)

```
Phase 1 (AI SDK)
    │
    ├──→ Phase 2 (Streaming + Structured Output)
    │
    └──→ Phase 3 (MCP TS Port — keyword)
              │
              ├──→ Phase 4 (Kill HTTP Bridge)
              │
              └──→ Phase 5 (Semantic Search)
                        │
                        └──→ Phase 6 (Remove Python)
```

Phases 2 and 3 can run in parallel (different parts of the codebase).

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| AI SDK doesn't support a provider's edge case | Low | Medium | Fall back to `createOpenAI` with custom baseURL for that provider |
| Embedding quality regression (Phase 5) | Medium | High | Compatibility test + keyword fallback + keep Python until validated |
| `onnxruntime-node` platform issues | Medium | Low | Keyword-only mode is already functional from Phase 3 |
| Streaming breaks `ChatAction` parsing | Medium | Medium | Send actions as final chunk after stream completes |
| Breaking MCP protocol compatibility | Low | High | Test with `.mcp.json` and external MCP clients before removing Python |

---

## Decision Log

- **AI SDK before MCP port:** Simplifies the MCP server (it just calls `generateText` without knowing provider details). Also the fastest win.
- **No monorepo:** The project has one build output (Vite → web app + Express server). Workspace packages add `tsconfig` path mapping, cross-package build coordination, and import indirection for zero functional benefit at current scale.
- **MCP as module, not package:** Direct imports avoid the service-extraction refactor that a separate package would require. The stdio entry point still supports external MCP clients.
- **Pre-computed embeddings preferred:** The KB is static. Runtime model loading is expensive and fragile. Pre-compute at build time, only encode queries at runtime.
- **`useChat` hook deferred indefinitely:** The sidebar's `ChatAction` system (pipeline state patches) doesn't map to the SDK's chat model. Custom streaming (Phase 2) is sufficient.
