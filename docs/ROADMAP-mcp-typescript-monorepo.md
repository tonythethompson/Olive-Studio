# Roadmap: MCP Server TypeScript Port & Monorepo Migration

Port the Python MCP server (`olive-mcp-server/`) to TypeScript and restructure the project as a pnpm workspace monorepo. This eliminates the Python dependency, enables shared types, removes the HTTP bridge overhead, and consolidates CI.

---

## Current State

- **32 tools** registered in `olive-mcp-server/olive_mcp_server/mcp_server.py`
- **Python dependencies:** `mcp<2`, `sentence-transformers>=3`, `numpy`, `requests`, `beautifulsoup4`
- **Semantic search:** `BAAI/bge-small-en-v1.5` (384-dim, ~130MB, CPU-only via sentence-transformers)
- **Precomputed indexes:** Shipped `.npz` files (4,711 doc embeddings, 36+12 troubleshooting embeddings)
- **Transport:** stdio (FastMCP), proxied via `POST /api/mcp/tool` on the Express server
- **Pain points:** Python venv management, `mcp<2` pin fragility, 5+ min install with sentence-transformers download, separate CI pipeline, type duplication between Python and TypeScript

---

## Target Architecture

```
olive-studio/
├── pnpm-workspace.yaml
├── package.json                    (root — workspace scripts, shared devDeps)
├── packages/
│   ├── mcp-server/                 ← TypeScript MCP server (new)
│   │   ├── src/
│   │   │   ├── server.ts           (MCP entry point using @modelcontextprotocol/sdk)
│   │   │   ├── tools/              (one file per tool or tool group)
│   │   │   ├── knowledge-base/     (JSON files — moved from Python)
│   │   │   ├── embeddings/         (semantic search using @huggingface/transformers)
│   │   │   └── indexes/            (precomputed embedding indexes in TS-friendly format)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vitest.config.ts
│   ├── shared/                     ← Shared types and utilities (new)
│   │   ├── src/
│   │   │   ├── types.ts            (UIState, OliveRecipe, PassConfig, etc.)
│   │   │   ├── validation.ts       (shared validation logic)
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── app/                        ← Existing application (moved from root src/)
│       ├── src/
│       │   ├── components/
│       │   ├── lib/
│       │   └── server/
│       ├── server.ts
│       ├── package.json
│       ├── vite.config.ts
│       └── tsconfig.json
├── olive-mcp-server/               ← Python (deprecated, removed in Phase 4)
└── docs/
```

---

## Phase 0: Workspace Scaffolding (~half day)

**Goal:** Prove the pnpm workspace structure works without moving any code.

**Tasks:**

1. Create `pnpm-workspace.yaml`:
   ```yaml
   packages:
     - "packages/*"
   ```

2. Create `packages/shared/` with a minimal `package.json` and `tsconfig.json`. Export the shared types (`UIState`, `OliveRecipe`, `ProviderConfig`, etc.) that are currently duplicated or live in `src/types.ts`.

3. Verify the existing app still builds and all tests pass with the workspace present. The root `package.json` remains the working app until Phase 3b when we move it to `packages/app/`.

4. Update `.gitignore` for any new workspace-level artifacts.

**Success criteria:** `pnpm install` works, `pnpm dev` works, CI passes. No user-facing change.

---

## Phase 1: Port Easy Tools (Keyword-Only) (~1 week)

**Goal:** Create the TypeScript MCP server with all 22 non-semantic tools ported.

**Tools to port (pure JSON/logic — no embeddings):**

| Tool                              | Source Module       | Complexity |
| --------------------------------- | ------------------- | ---------- |
| `get_olive_passes`                | pass_catalog        | Trivial    |
| `get_pass_parameters`             | pass_parameters     | Trivial    |
| `get_pass_config_template`        | config_generator    | Low        |
| `get_hardware_optimization_guide` | hardware_guide      | Low        |
| `get_pass_chain`                  | pass_chain          | Low        |
| `get_data_config_template`        | data_config         | Low        |
| `get_quantization_strategy`       | strategy_advisor    | Medium     |
| `evaluate_optimization_tradeoff`  | tradeoff            | Medium     |
| `get_model_compatibility`         | compatibility       | Low        |
| `get_cli_command`                 | cli_helper          | Low        |
| `get_integration_recipe`          | integration_recipes | Trivial    |
| `get_runtime_ep_hints`            | runtime_ep_hints    | Low        |
| `get_mcp_capabilities`            | capabilities        | Trivial    |
| `record_troubleshoot_feedback`    | feedback            | Low        |
| `validate_ui_state_recipe`        | studio_recipe       | Medium     |
| `get_recipe_for_ui_state`         | studio_recipe       | Medium     |
| `plan_optimization`               | agent_planner       | Medium     |
| `execute_and_observe`             | agent_execute       | Medium     |
| `diagnose_and_fix`                | agent_diagnosis     | Medium     |
| `compare_results`                 | agent_compare       | Low        |
| `get_model_info`                  | agent_model_info    | Low        |
| `get_context_for_pipeline`        | passive_context     | Low        |

**Tasks:**

1. Create `packages/mcp-server/` with `package.json`, `tsconfig.json`, and `vitest.config.ts`.

2. Add dependencies:
   - `@modelcontextprotocol/sdk` — Official TypeScript MCP SDK (stdio + SSE transport)
   - `zod` — Input validation schemas for tool parameters

3. Copy knowledge base JSON files from `olive-mcp-server/olive_mcp_server/knowledge_base/` → `packages/mcp-server/src/knowledge-base/`.

4. Implement tool modules one-by-one, writing tests alongside each:
   - Start with the trivial ones (`get_olive_passes`, `get_mcp_capabilities`)
   - Progress to medium complexity (`get_quantization_strategy`, `plan_optimization`)
   - Port the Studio recipe tools last (they touch `UIState` types from `packages/shared/`)

5. Implement keyword-only search for `search_olive_documentation` and `troubleshoot_olive_error` — substring matching with term frequency scoring (the Python server's fallback path).

6. Create the MCP server entry point (`server.ts`) using `@modelcontextprotocol/sdk`'s `Server` class with stdio transport.

7. Write a smoke test script that starts the server and calls each tool once.

8. Update `.mcp.json` at repo root to point to the new TS server (with a flag to use Python or TS).

**Success criteria:** All 22 tools pass tests. The TS MCP server starts via stdio and responds to tool calls. Keyword search returns reasonable results for troubleshooting queries.

---

## Phase 2: Eliminate the Studio HTTP Bridge (~2-3 days)

**Goal:** The 7 Studio bridge tools call Express services directly instead of making loopback HTTP requests.

**Current Python flow:**
```
AI Agent → MCP tool → HTTP POST localhost:3000/api/olive/... → Express → Service
```

**Target TS flow:**
```
AI Agent → MCP tool → direct import of service module → Service
```

**Tools affected:**
- `list_optimization_jobs`
- `get_optimization_job`
- `get_optimization_results`
- `validate_optimization_job`
- `submit_optimization_job`
- `cancel_optimization_job`

**Tasks:**

1. Extract the Olive job service logic from `src/server/services/olive/` into `packages/shared/` (or keep it in `packages/app/` and have the MCP server import it). Decide on the boundary: shared service code vs. thin MCP wrappers that call the app.

2. For the `submit_optimization_job` and `cancel_optimization_job` tools (side-effects), consider:
   - **Option A:** MCP server runs in-process with Express (no stdio subprocess). Tools call services directly.
   - **Option B:** MCP server runs as stdio subprocess but communicates with Express via IPC/Unix socket (more isolated, but adds complexity).
   - **Recommendation:** Option A for development. The MCP proxy route already runs in-process with Express — the TS MCP server can be initialized in the same Node.js process as a library, not just as a subprocess.

3. Update the Express MCP proxy route (`src/server/routes/mcp.ts`) to call the TS MCP tools directly (in-process) instead of spawning a subprocess.

4. Write integration tests verifying the tools work without HTTP.

**Success criteria:** Studio bridge tools return results without any localhost HTTP calls. Latency drops measurably (no serialization overhead).

---

## Phase 3: Semantic Search in TypeScript (~1 week)

**Goal:** Port the hybrid semantic + keyword search to TypeScript using `@huggingface/transformers` (Transformers.js).

**What needs porting:**
- `embeddings.py` → `embeddings.ts` (model loading, encode, cosine similarity)
- `troubleshooting.py` scoring logic → `troubleshooting.ts`
- `docs_search.py` search logic → `docs-search.ts`
- `.npz` index files → TypeScript-friendly format

**Tasks:**

1. **Convert index format.** Write a build script that:
   - Reads existing `.npz` files (numpy zip format)
   - Exports as flat binary files (`.bin` — raw Float32Array) + JSON metadata
   - Stores in `packages/mcp-server/src/indexes/`
   - This runs once during migration, then indexes are regenerated by a TS build script going forward

2. **Implement embedding encoding.** Use `@huggingface/transformers` with `onnxruntime-node`:
   ```typescript
   import { pipeline } from '@huggingface/transformers';

   const embedder = await pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5', {
     device: 'cpu',
   });

   const output = await embedder('query text', { pooling: 'cls', normalize: true });
   // Returns Float32Array of length 384
   ```
   Note: The ONNX-exported model (`Xenova/bge-small-en-v1.5`) produces embeddings compatible with the Python sentence-transformers version. Same embedding space.

3. **Implement cosine similarity.** Pure TypeScript — no numpy needed:
   ```typescript
   function cosineSimilarity(a: Float32Array, b: Float32Array): number {
     let dot = 0, normA = 0, normB = 0;
     for (let i = 0; i < a.length; i++) {
       dot += a[i] * b[i];
       normA += a[i] * a[i];
       normB += b[i] * b[i];
     }
     return dot / (Math.sqrt(normA) * Math.sqrt(normB));
   }
   ```

4. **Port the hybrid scoring system.** Translate the `_score()` function (0.6 x semantic + 0.4 x keyword + hit bonus) and the retrieval budget/fallback logic.

5. **Port troubleshoot_olive_error.** Include:
   - Domain routing (olive vs studio)
   - Frequency tracking (in-memory Map)
   - Index caching with content-hash validation
   - Quirk category inference

6. **Port search_olive_documentation.** Include:
   - KB flattening (JSON → text pairs)
   - Index building/caching
   - Result ranking and deduplication

7. **Validate embedding compatibility.** Write a test that:
   - Encodes the same query with both Python and TypeScript
   - Asserts cosine similarity > 0.99 between the two embeddings
   - Confirms search results match for a set of known queries

8. **Add index rebuild script.** `packages/mcp-server/scripts/build-indexes.ts` — regenerates `.bin` index files from knowledge base JSON (equivalent to `scripts/build_kb_index.py`).

**Dependencies to add:**
- `@huggingface/transformers` (already in root `package.json` for playground inference)
- `onnxruntime-node` (for server-side ONNX inference)

**Success criteria:** `troubleshoot_olive_error` and `search_olive_documentation` return results with quality parity to the Python version. Semantic search activates within the same time budget (8s default).

---

## Phase 4: Remove Python & Finalize Monorepo (~2-3 days)

**Goal:** Delete the Python MCP server and complete the monorepo restructuring.

**Tasks:**

1. Remove `olive-mcp-server/` directory entirely.

2. Remove from CI (`.github/workflows/ci.yml`):
   - `python-tests` job
   - `olive-pass-availability` job (rewrite as a TS test if needed)
   - Docker build job for MCP server image

3. Remove Python-related scripts and configuration:
   - `scripts/setup-mcp.ps1` / `scripts/setup-mcp.sh`
   - `scripts/postinstall-mcp-setup.mjs`
   - `.kiro/hooks/check-mcp-venv`
   - Python references in `AGENTS.md`, docs, and steering files

4. Update `.mcp.json` to point to the TS MCP server only.

5. Optionally move `src/` → `packages/app/` to complete the monorepo layout. This is a larger refactor (all imports, Vite config, tsconfig paths) — can be deferred if the workspace structure works with the root-level app.

6. Update all documentation:
   - `AGENTS.md` — remove Python setup, MCP pin note, venv instructions
   - `README.md` — simplify getting-started (no Python requirement)
   - `.kiro/` steering files — update MCP server references
   - `docs/` — update architecture references

7. Run full CI, verify everything passes.

**Success criteria:** Zero Python in the repo. `pnpm install` → `pnpm dev` is the only setup needed. MCP tools work identically to before.

---

## Risk Assessment

| Risk                                                   | Likelihood | Impact | Mitigation                                                                      |
| ------------------------------------------------------ | ---------- | ------ | ------------------------------------------------------------------------------- |
| Embedding quality regression                           | Medium     | High   | Side-by-side comparison tests; keep Python as fallback until validated          |
| `@huggingface/transformers` ONNX model incompatibility | Low        | High   | Test Xenova/bge-small-en-v1.5 early in Phase 3; fall back to keyword-only       |
| Monorepo import path breakage                          | Medium     | Medium | Phase 0 validates the structure before any code moves                           |
| Cold start regression (model loading)                  | Medium     | Low    | Lazy-load embeddings (same as Python); precomputed indexes cover 95% of queries |
| Breaking MCP protocol compatibility                    | Low        | High   | Test with existing `.mcp.json` config and Kiro/Claude MCP clients               |
| Studio bridge direct-import creates circular deps      | Medium     | Medium | Clean boundary via `packages/shared/`; service interfaces, not implementations  |

---

## Dependencies & Packages

**New workspace packages:**
- `@olive-studio/mcp-server` — The TypeScript MCP server
- `@olive-studio/shared` — Shared types, validation, constants

**New npm dependencies (mcp-server):**
- `@modelcontextprotocol/sdk` — TypeScript MCP SDK (stdio/SSE server)
- `zod` — Schema validation for tool inputs
- `onnxruntime-node` — ONNX inference runtime for embeddings (Phase 3)
- `cheerio` — HTML parsing for live docs fetch (replaces beautifulsoup4)

**Existing deps reused:**
- `@huggingface/transformers` — Already in root package.json (used for playground)

---

## Decision Log

- **2025-08-17:** Plan created. Phased approach chosen — Python server remains available as fallback throughout migration.
- **In-process MCP preferred over subprocess:** The TS MCP server should be importable as a library (for the Express proxy route) and also runnable as a standalone stdio server (for external MCP clients like Kiro/Claude). Dual-mode.
- **Keyword-only first:** Phase 1 ships without semantic search. This is already a supported mode in the Python server (`OLIVE_MCP_RETRIEVAL_MODE=keyword`). Most tool calls don't use semantic search.
- **Index format: flat binary over npz.** `.npz` is numpy-specific. Flat `.bin` files (raw Float32Array) + a JSON manifest are trivial to read in both Python and TypeScript.
- **`packages/app/` move deferred:** Moving the main app into a workspace package is the biggest single refactor (Vite config, all import paths, CI changes). Phase 4 marks it as optional — the workspace works with the app at root level and packages/ for the new code.

---

## When to Start

**Prerequisites:**
- Stable feature set for the current MCP tools (no active tool development in Python)
- AI SDK adoption roadmap Phase 1 complete (provider swap) — so the app-side refactor window doesn't overlap
- Confidence that `@huggingface/transformers` can load `bge-small-en-v1.5` reliably on the target Node.js version (22.16+)

**Trigger:** Start when the Python venv management becomes a contributor friction point, or when the next batch of MCP tools would be easier to write in TypeScript.
