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

## Phase 5: Cleanup & Finalization (Week 7)

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
