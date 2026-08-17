# Reconciled Migration Roadmap

Unified execution plan combining the **AI SDK adoption** and **MCP TypeScript port / monorepo** roadmaps into a single sequenced timeline. Phases are ordered to avoid conflicting refactors and maximize shared groundwork.

See also:
- [ROADMAP-ai-sdk-adoption.md](./ROADMAP-ai-sdk-adoption.md) — detailed AI SDK plan
- [ROADMAP-mcp-typescript-monorepo.md](./ROADMAP-mcp-typescript-monorepo.md) — detailed MCP port plan

---

## Sequencing Rationale

The AI SDK adoption touches the Express server's AI routes and provider layer. The monorepo migration touches the MCP server and project structure. They mostly don't conflict, but:

1. **AI SDK Phase 1 (provider swap)** should land first — it establishes AI SDK provider instances that the MCP server's TS port will also use for any LLM calls (e.g., `plan_optimization` uses the assistant to parse NL intent).
2. **Monorepo Phase 0 (workspace scaffold)** can happen in parallel with AI SDK work since it doesn't move existing code.
3. **AI SDK Phase 2 (streaming)** and **MCP Phase 1 (port tools)** are independent and can run concurrently or in either order.
4. **MCP Phase 2 (eliminate HTTP bridge)** benefits from AI SDK Phase 2 being done, because the Express routes will have stabilized after the streaming refactor.

---

## Timeline

```
Week 1          AI SDK Phase 1: Provider swap (1 day)
                Monorepo Phase 0: Workspace scaffolding (half day)
                ─── both land, CI green ───

Week 2-3        AI SDK Phase 2: Streaming chat (2-3 days)
                MCP Phase 1: Port easy tools, keyword-only (1 week, parallel)

Week 4          AI SDK Phase 3: Structured output schemas (1-2 days)
                MCP Phase 2: Eliminate Studio HTTP bridge (2-3 days)

Week 5-6        MCP Phase 3: Semantic search in TypeScript (1 week)

Week 7          MCP Phase 4: Remove Python, finalize monorepo (2-3 days)
                ─── migration complete ───
```

Total: ~6-7 weeks of focused work (not calendar time — interleaved with feature work).

---

## Phase 1: Foundation (Week 1)

### AI SDK Provider Swap (~1 day)

Replace hand-rolled HTTP calls in each provider plugin with AI SDK `generateText()`. No user-facing change.

- Install `ai`, `@ai-sdk/google`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/mistral`, `@ai-sdk/amazon-bedrock`
- Swap internal `call()` methods to use `generateText()`
- Keep existing registry, env detection, and `callAI()` dispatch
- Verify all provider tests pass

**Output:** AI SDK provider instances available for streaming (next phase) and for the TS MCP server (later phases).

### Monorepo Workspace Scaffold (~half day)

Prove pnpm workspace works without moving code.

- Create `pnpm-workspace.yaml` listing `packages/*`
- Create `packages/shared/` with shared types (`UIState`, `OliveRecipe`, `ProviderConfig`)
- Verify `pnpm install`, `pnpm dev`, and CI still pass

**Output:** Workspace structure ready for the MCP server package.

---

## Phase 2: Streaming + Tool Port (Weeks 2-3)

### AI SDK Streaming Chat (~2-3 days)

Add token-by-token streaming to the assistant chat.

- Server: Replace `callAI()` in `/api/ai/chat` with `streamText()`, stream text progressively, send `actions[]` as final chunk
- Client: Rewrite `useAiChat` to consume a `ReadableStream`, add abort/cancel support
- Protocol: NDJSON lines (`{"type":"text","content":"..."}` ... `{"type":"done","actions":[...],"mcp":{...}}`)

**Output:** Users see text appearing immediately instead of waiting for full response. Cancel button works.

### MCP Tool Port — Keyword Only (~1 week, parallel)

Create `packages/mcp-server/` and port all 22 non-semantic tools.

- Set up package with `@modelcontextprotocol/sdk`, `zod`
- Copy knowledge base JSON files
- Implement tools, starting with trivial (pass catalog) → medium (strategy advisor, agent planner)
- Keyword-only fallback for `search_olive_documentation` and `troubleshoot_olive_error`
- Smoke test: start server via stdio, call each tool

**Output:** TypeScript MCP server functional with keyword search. Python server still available as fallback.

---

## Phase 3: Structured Output + Bridge Elimination (Week 4)

### AI SDK Structured Output (~1-2 days)

Replace `parseJsonFromAiResponse` / `softRepairJson` with Zod-validated `Output.object()`.

- Define schemas for: chat reply, review findings, recipe validation
- Apply to `/ai/validate` and `/ai/analyze-state` routes (non-streaming)
- Chat route optionally uses structured streaming for the `actions[]` portion

**Output:** Type-safe AI responses, no more regex-based JSON extraction. Fewer malformed-response bugs.

### Eliminate Studio HTTP Bridge (~2-3 days)

MCP Studio tools call Express services directly instead of loopback HTTP.

- Import Olive job services directly into MCP tool modules
- Update Express MCP proxy route to call TS tools in-process
- Remove HTTP serialization overhead for 7 tools
- Integration tests proving direct calls work

**Output:** MCP ↔ Express bridge is zero-latency in-process calls. No more loopback HTTP.

---

## Phase 4: Semantic Search Port (Weeks 5-6)

### Semantic Search in TypeScript (~1 week)

Port hybrid semantic + keyword search using `@huggingface/transformers`.

- Convert `.npz` indexes to flat `.bin` (Float32Array) + JSON manifest
- Implement embedding encoding via `Xenova/bge-small-en-v1.5` ONNX model
- Implement cosine similarity (pure TS, ~20 lines)
- Port hybrid scoring (0.6 x semantic + 0.4 x keyword + bonus)
- Port `troubleshoot_olive_error` with frequency tracking, domain routing, caching
- Port `search_olive_documentation` with KB flattening and result ranking
- Validate: cross-check embedding similarity > 0.99 between Python and TS outputs

**Output:** Full semantic search parity with Python. All 32 tools ported and tested.

---

## Phase 5: Semantic Search in TypeScript (~3-5 days)

**Goal:** Port hybrid semantic + keyword search with zero bundled ML model.

### Key Insight

Document/passage embeddings are **already pre-built at release time** — they ship as `.npz` files in `knowledge_base/indexes/` (4,711 doc entries + 48 troubleshooting entries). The only reason `build_kb_index` / `encode_texts` runs at runtime is as a fallback when the shipped index is stale or `OLIVE_MCP_REBUILD_INDEX=1` is set.

The only runtime model invocation for normal queries is `encode_query()` — a single 384-dim vector for the user's search string. That's the one place where the model must load in the Python version.

### Index Format Migration

Replace `.npz` (numpy-specific) with JS-native format:
- **`.bin`** — raw packed Float32Array (one per index: docs, troubleshooting)
- **`.json` manifest** — metadata (entry count, dimension, content hashes, text labels)

Build script runs once during migration, then regenerates from KB JSON going forward.

### Query Embedding Strategy

| Option | Install Weight | Latency | Accuracy |
|--------|--------------|---------|----------|
| **A. Pre-computed query expansions** — ship a lookup table of common query embeddings + fall back to keyword/BM25 for novel queries | Zero runtime deps | <1ms | Good for fixed KB, degrades on novel queries |
| **B. External embedding endpoint** — call a local or cloud embedding API (OpenAI `text-embedding-3-small`, Ollama, etc.) via the existing AI provider infrastructure | Zero bundled model | ~50-200ms | Exact |
| C. Lightweight WASM embedding — quantized BGE-micro or all-MiniLM ONNX model via `onnxruntime-node` (~30MB model, not 130MB) | ~30MB model file | ~20ms | Near-equivalent |

**Decision: Option A as default, Option B as opt-in.**

The knowledge base is fixed between releases. Pre-compute embeddings for common query patterns (pass names, error codes, hardware names, frequent troubleshooting terms) and ship them alongside the document embeddings. At runtime:

1. Check the pre-computed query lookup table (exact match or nearest neighbor in the table)
2. If no match: fall back to BM25/keyword scoring over the same index
3. Hybrid score: weighted combination of any semantic match found + keyword relevance

If users want full semantic search for arbitrary queries, they configure an embedding endpoint — same pattern as the existing AI provider plugin system. Add an optional config:

```ts
// In env or config:
OLIVE_MCP_EMBED_ENDPOINT=http://localhost:11434/api/embeddings  // Ollama
// or
OLIVE_MCP_EMBED_ENDPOINT=openai  // Uses configured OpenAI key
```

### What This Eliminates

- `@huggingface/transformers` as a runtime dependency for MCP
- `onnxruntime-node` native bindings
- 130MB model download on first run
- The entire `sentence-transformers` → ONNX → model download chain

### Build-Time Tooling

`src/server/mcp/scripts/build-indexes.ts`:
- Reads KB JSON files
- Calls the Python embedder one final time (or a cloud API) to generate all document + common-query embeddings
- Outputs `.bin` + `.json` manifest
- This runs during release prep, not at user install time

### Runtime Implementation

```ts
// Pre-computed query table (shipped with app)
const queryIndex = loadQueryIndex();       // { terms: string[], embeddings: Float32Array[] }
const docIndex = loadDocIndex();           // { texts: string[], embeddings: Float32Array[] }

async function search(query: string, topK = 5) {
  // 1. Try pre-computed query match
  const queryEmb = queryIndex.lookup(query);  // fuzzy match against known queries
  
  // 2. If no semantic match available, pure keyword
  if (!queryEmb) {
    return bm25Search(query, docIndex.texts, topK);
  }
  
  // 3. Hybrid: semantic + keyword
  const semanticHits = cosineSimilarityTopK(queryEmb, docIndex.embeddings, topK * 2);
  const keywordHits = bm25Search(query, docIndex.texts, topK * 2);
  return mergeAndRank(semanticHits, keywordHits, topK);  // 0.6 semantic + 0.4 keyword
}
```

### Optional: External Embedding Endpoint

```ts
// Only activated when OLIVE_MCP_EMBED_ENDPOINT is configured
async function encodeQuery(text: string): Promise<Float32Array> {
  const endpoint = process.env.OLIVE_MCP_EMBED_ENDPOINT;
  if (!endpoint) return queryIndex.lookup(text);  // pre-computed fallback
  
  if (endpoint === 'openai') {
    const res = await openaiEmbed(text);  // text-embedding-3-small
    return truncateTo384(res);            // project down to match index dims
  }
  // Ollama / custom endpoint
  const res = await fetch(endpoint, {
    method: 'POST',
    body: JSON.stringify({ model: 'bge-small-en-v1.5', prompt: text }),
  });
  return new Float32Array(await res.json().then(r => r.embedding));
}
```

### Success Criteria

- `troubleshoot_olive_error` and `search_olive_documentation` return quality-parity results for common queries (covered by pre-computed table)
- BM25 fallback handles novel queries reasonably
- Zero ML dependencies in default install
- Optional embedding endpoint works when configured
- Build script generates indexes from KB JSON

## Phase 6: Cleanup & Finalization (Week 7)

### Remove Python (~2-3 days)

Delete the Python MCP server and clean up all references.

- Delete `olive-mcp-server/` directory
- Remove from CI: `python-tests` job, `olive-pass-availability` job, Docker build
- Remove: `scripts/setup-mcp.ps1`, `scripts/setup-mcp.sh`, `scripts/postinstall-mcp-setup.mjs`
- Remove: `.kiro/hooks/check-mcp-venv`
- Update `.mcp.json` to point to TS server only
- Update all docs: `AGENTS.md`, steering files, README

### Optional: Move app into workspace package

- Move `src/` → `packages/app/` (biggest refactor — all import paths, Vite config, tsconfig)
- Can be deferred indefinitely if the workspace works with app at root

**Output:** Zero Python. Single `pnpm install` → `pnpm dev` setup. One language, one toolchain.

---

## Dependency Summary

### Added in Phase 1
| Package                  | Purpose                                              |
| ------------------------ | ---------------------------------------------------- |
| `ai`                     | Core AI SDK (`generateText`, `streamText`, `Output`) |
| `@ai-sdk/google`         | Gemini provider                                      |
| `@ai-sdk/openai`         | OpenAI + compatible providers                        |
| `@ai-sdk/anthropic`      | Anthropic/Claude                                     |
| `@ai-sdk/mistral`        | Mistral                                              |
| `@ai-sdk/amazon-bedrock` | AWS Bedrock                                          |
| `zod`                    | Schema validation (structured output + MCP tools)    |

### Added in Phase 2
| Package                     | Purpose                 |
| --------------------------- | ----------------------- |
| `@modelcontextprotocol/sdk` | TS MCP server framework |

### Added in Phase 4
| Package            | Purpose                                |
| ------------------ | -------------------------------------- |
| `onnxruntime-node` | ONNX inference for embeddings          |
| `cheerio`          | HTML parsing (replaces beautifulsoup4) |

### Removed in Phase 5
| Package                       | Purpose                |
| ----------------------------- | ---------------------- |
| `mcp<2` (pip)                 | Python MCP framework   |
| `sentence-transformers` (pip) | Python embedding model |
| `numpy` (pip)                 | Python array math      |
| `requests` (pip)              | Python HTTP client     |
| `beautifulsoup4` (pip)        | Python HTML parser     |

---

## Risk Mitigation

| Risk                            | Phase | Mitigation                                                                       |
| ------------------------------- | ----- | -------------------------------------------------------------------------------- |
| Streaming breaks chat actions   | 2     | Stream text first, send structured `actions` as final chunk — UI still gets them |
| Provider swap breaks a provider | 1     | One provider at a time, test each before moving to next                          |
| Monorepo breaks CI              | 1     | Phase 0 changes no existing code; workspace is additive                          |
| MCP tool behavior diverges      | 2-4   | Python server runs in parallel; compare outputs for same inputs                  |
| Semantic search quality drops   | 4     | Cross-validate embeddings; keep keyword fallback always available                |
| Large PR scope                  | All   | Each phase is independently shippable and mergeable                              |

---

## Success Metrics

| Metric                                | Before                                                       | After                                   |
| ------------------------------------- | ------------------------------------------------------------ | --------------------------------------- |
| Setup time (new contributor)          | ~15 min (Node + Python venv + sentence-transformers)         | ~2 min (`pnpm install`)                 |
| Chat response latency (perceived)     | 3-15s (full wait)                                            | <500ms to first token                   |
| MCP tool call latency (Studio bridge) | ~50-100ms (HTTP round-trip)                                  | <1ms (in-process)                       |
| CI pipeline jobs                      | 5 (validate + security + python-tests + olive-pass + docker) | 3 (validate + security + olive-pass-ts) |
| Languages in repo                     | 2 (TypeScript + Python)                                      | 1 (TypeScript)                          |
| JSON parsing failure rate             | ~2-5% (malformed AI responses)                               | ~0% (schema-validated)                  |

```text
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
| Pre-computed query table misses important queries | Medium | Medium | BM25 fallback covers gaps; expand table over time based on usage logs |
| Novel queries degrade without embedding endpoint | Low | Low | Keyword/BM25 still returns reasonable results; users can opt into endpoint |
| Streaming breaks `ChatAction` parsing | Medium | Medium | Send actions as final chunk after stream completes |
| Breaking MCP protocol compatibility | Low | High | Test with `.mcp.json` and external MCP clients before removing Python |

---

## Decision Log

| Date       | Decision                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------- |
| 2025-08-17 | Reconciled two roadmaps into single sequenced plan                                        |
| 2025-08-17 | AI SDK provider swap goes first (unblocks everything)                                     |
| 2025-08-17 | Streaming and MCP tool port are parallel workstreams                                      |
| 2025-08-17 | Python stays as fallback until Phase 5 (no hard cutover)                                  |
| 2025-08-17 | `packages/app/` move is optional — workspace works with app at root                       |
| 2025-08-17 | `useChat` (full hook replacement) deferred — only revisit if assistant becomes primary UI |
| 2025-08-17 | AI Elements UI components skipped — custom sidebar layout doesn't benefit                 |
| 2025-08-17 | Turborepo skipped — single-package CI is fast enough at current scale                     |

- **AI SDK before MCP port:** Simplifies the MCP server (it just calls `generateText` without knowing provider details). Also the fastest win.
- **No monorepo:** The project has one build output (Vite → web app + Express server). Workspace packages add `tsconfig` path mapping, cross-package build coordination, and import indirection for zero functional benefit at current scale.
- **MCP as module, not package:** Direct imports avoid the service-extraction refactor that a separate package would require. The stdio entry point still supports external MCP clients.
- **Pre-computed embeddings preferred:** The KB is static. Ship pre-computed doc embeddings + common query embeddings. Zero ML runtime deps by default. External embedding endpoint as opt-in for full semantic search on novel queries.
- **`useChat` hook deferred indefinitely:** The sidebar's `ChatAction` system (pipeline state patches) doesn't map to the SDK's chat model. Custom streaming (Phase 2) is sufficient.
