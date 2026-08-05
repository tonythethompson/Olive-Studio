# Tech Debt & Issues

> **Status:** audited against the codebase on 2026-08-04; remediation passes 1–6 landed in PR #115 (branch `tech-debt-passes-1-6`). Items are tagged: ✅ resolved · ⚠️ partial · ❌ not applicable · ⏳ open.

## Status overview

| # | Issue | Status |
|---|-------|--------|
| 1 | ai.ts monolith | ✅ Resolved (Pass 6) |
| 2 | sanitize loop rebuilds recipe | ✅ Resolved (Pass 2) |
| 3 | `Record<string, any>` in types.ts | ✅ Resolved (Pass 1) |
| 4 | module-level queryClient | ✅ Resolved (Pass 1) |
| 5 | argv string matching | ⚠️ Partial (Pass 1) |
| 6 | Duplicate RecipeGraphView | ✅ Was already resolved |
| 7 | storybook-static committed | ✅ Was already resolved |
| 8 | models/optimized committed | ✅ Was already resolved |
| 9 | Module-level mutable state in ai.ts | ✅ Resolved (Pass 6) |
| 10 | Fragile substring matching | ✅ Resolved (Pass 4) |
| 11 | Flat passes bag | ⏳ Open |
| 12 | Builder if/else chain | ⏳ Open |
| 13 | No request body validation | ⏳ Open |
| 14 | getPipelineValidation rebuilds recipe | ✅ Resolved (Pass 2) |
| 15 | Unbounded SSE logs | ✅ Resolved (Pass 5) |
| 16 | Uncancellable polling loops | ⏳ Open |
| 17 | No persistent job history | ✅ Closed as mitigated (Pass 5) |
| 18 | Duplicated coercion/validation rules | ✅ Resolved (Pass 4) |
| 19 | vite in both dep sections | ✅ Resolved (Pass 1) |
| 20 | MCP no health check | ⏳ Open |

## 🟢 Quick Wins

### 1. ✅ ai.ts route file monolith — resolved (Pass 6)

Was: all AI provider logic, LM Studio/Ollama lifecycle, model catalog fetching, Codex, Devin, and Cloudflare in one 2,120-line file.
Now: split into `src/server/routes/ai/` sub-modules — `index.ts` (mount composition), `providerRoutes.ts`, `chatRoutes.ts`, `lmStudioRoutes.ts`, `ollamaRoutes.ts`, `installEngineRoutes.ts`, `codexRoutes.ts`, `devinRoutes.ts`, `cloudflareRoutes.ts`, `localEngines.ts` (lifecycle), `modelCatalog.ts` (catalog fetchers), `streamHelpers.ts` (NDJSON/disconnect tracking). Dead `registerAiRoutes` export removed.

### 2. ✅ sanitizePipelineState recipe rebuilds — resolved (Pass 2)

Was: every state commit triggered up to 16 validation loops, each rebuilding the recipe; `buildRecipeFromState` rebuilt it several more times (up to ~19 builds per UI interaction).
Now: `buildOliveRecipe` has a reference-equality memo (UIState objects are immutable per commit); `buildRecipeFromState` reuses `validation.recipe` and derives advisories from `validation.issues`; `StepInspector` no longer runs a second full validation; `ExecutionWorkspace` defers the pipeline derivation with `useDeferredValue` and rebuilds fresh from live state at Execute/Queue time (never submits a stale recipe).

### 3. ✅ `Record<string, any>` in types.ts — resolved (Pass 1)

`OliveRecipe.systems` and `PassConfig.config` are now `Record<string, unknown>`; the eslint-disable comments were removed. Remaining `any` usages live inside `oliveRecipeHub.ts` internals (separate follow-up).

### 4. ✅ Module-level queryClient — resolved (Pass 1)

`QueryClient` is created inside `App` via a lazy `useState` initializer — no module-level singleton leaking between test runs.

### 5. ⚠️ shouldServeProductionStatic argv matching — partial (Pass 1)

`OLIVE_SERVE_STATIC=true|false` is now the explicit, testable switch (top precedence, ahead of `NODE_ENV` and `OLIVE_DIST_DIR`). The argv entry-script check remains as a last-resort fallback because bare `pnpm start` / `node dist/server.mjs` sets no env vars and removing it outright would silently flip production into Vite dev mode. `bin/cli.js` is unaffected (sets `NODE_ENV` + `OLIVE_DIST_DIR`).

### 6. ✅ Duplicate RecipeGraphView — was already resolved

`src/components/features/RecipeGraphView.tsx` is an intentional 2-line re-export shim for `./recipe-graph`, used by `ExecutionWorkspace`'s lazy import — not a stale copy.

### 7. ✅ storybook-static — was already resolved

Not tracked; `.gitignore` covers `storybook-static/`.

### 8. ✅ models/optimized — was already resolved

Not tracked; `.gitignore` covers `/models/`.

### 9. ✅ Module-level mutable state in ai.ts — resolved (Pass 6)

`cachedLmsCli`, `lmsCliMissAt`, `ollamaEnsureInFlight`, `lmsEnsureInFlight`, `lastOllamaStartAt`, `lmsPullBusyTag`, `ollamaPullBusyTag`, and the progress-subscriber sets moved to `src/server/services/ai/localEngineState.ts` as one encapsulated `localEngineRuntime` object with `resetLocalEngineRuntime()` for tests/hot-reload.

### 10. ✅ inferHfTask / inferModelType substring matching — resolved (Pass 4)

Both are now explicit ordered lookup tables (`HF_TASK_RULES`, `MODEL_TYPE_RULES`) — first regex match wins, order documented as significant, behavior pinned by the existing test suites.

## 🔴 Longer-Term Refactors

### 11. ⏳ UIState.passes flat bag — open

Still a flat object of ~30 fields. A discriminated union per pass type remains the target; do after #12.

### 12. ⏳ oliveRecipeBuilder if/else chain — open

The quantization block has grown to 11 branches. Per-pass builder functions registered in a map (keyed by pass type) is still the plan.

### 13. ⏳ No request body validation — open

Routes still destructure `req.body` directly (some manual guards exist in `/olive/run` and `mcp.ts`). A schema library (zod) or manual guards at the route boundary is still recommended.

### 14. ✅ getPipelineValidation rebuilds — resolved (Pass 2)

Covered by the Pass 2 memoization/reuse work; the recipe built inside `getPipelineValidation` is the one `buildRecipeFromState` and the sanitize loop reuse.

### 15. ✅ SSE log backpressure / cap — resolved (Pass 5)

`job.logs` is capped at 1,000 lines (batched trim at a 1,250 watermark), `OliveJob.logsTruncated` records the trim, the SSE reconnect replay emits an `[info]` marker when truncated, and `/olive/status` exposes `logsTruncated`. Live subscribers still receive every line — the cap bounds server memory and replay, not the live stream. Tests: `gpu.test.ts`, truncated-replay case in `olive.stream.test.ts`.

### 16. ⏳ ensureOllama/ensureLms polling loops — open

Still fixed-interval `sleepMs(1000)` loops (40 / 30 iterations) with no AbortSignal. Planned together with replacing `execSync` CLI probing (see Performance section). Note: the sleeps are awaited promises (they don't block the event loop); the real gaps are cancellability and backoff.

### 17. ✅ No persistent job history — closed as mitigated (Pass 5)

Terminal runs are persisted client-side in IndexedDB (`src/lib/jobHistoryStore.ts`) with recipe JSON, export, and import — history survives server restarts, and `JobHistoryModal` reads it. The server-side `jobRegistry` stays in-memory by design: active jobs are child processes of the server, so they cannot survive a restart anyway. Remaining candidate (separate feature): persisting the client-side batch *queue* across page reloads — needs UX decisions about stale "running" entries.

### 18. ✅ coercePassFields / getCrossPassIssues duplication — resolved (Pass 4)

`CROSS_PASS_RULES` (in `pipelineValidation.ts`) is the single source of truth: each rule declares `applies`, a `fix` patch, severity/copy, and an `autoCoerce` flag. `coercePassFields` applies the auto-coercible rules at commit time; `getCrossPassIssues` surfaces the same rules as issues with matching autofixes. Drift between coercion and validation is now structurally impossible.

### 19. ✅ vite in dependencies — resolved (Pass 1)

`server.ts` imports vite dynamically inside the dev branch only; vite lives in `devDependencies` exclusively. Production static serving never loads vite.

### 20. ⏳ MCP health check / restart — open, reframed

The MCP client spawns a fresh Python subprocess per call (`services/mcp/client.ts`), so there is no long-lived process to die or restart — the original framing is outdated. Remaining work: a circuit breaker/failure counter and status surfacing so repeated MCP failures show up as "MCP unavailable" instead of per-call 500s.

## Performance & Efficiency Improvements

- ✅ **Memoize buildOliveRecipe** — reference-equality cache (Pass 2).
- ✅ **Debounce validation** — implemented as `useDeferredValue` on the display pipeline + fresh rebuilds at submit time (Pass 2); typed input stays responsive without timers.
- ✅ **@huggingface/transformers** — no action needed: already dynamically imported (`arenaLocalInference.ts`) behind double `lazy()` boundaries; build emits it as its own 537kb chunk. The `manualChunks` note is moot.
- ✅ **onnxruntime-web** — no action needed: all runtime imports are dynamic (`InBrowserValidation`, `WebGpuBenchmarkPanel`, `ArenaPanel`); the earlier "critical path" flag was a grep false positive — the match in `owrExportConfigs.ts` sits inside a generated-code template string, not a real import. Build emits ORT as its own 386kb chunk.
- ✅ **@mendable/firecrawl-js** — removed (Pass 3): zero imports anywhere; the dependency and its `allowBuilds` entry are gone.
- ❌ **React Query probe cache** — not applicable: the hardware probe (`/api/system/hardware-probe`) is fetched with plain `fetch` (`fetchHardwareProbe`), not React Query, and the server already caches probe results with a TTL (`system.ts`).
- ⏳ **execSync in findLmsCli** — open: `execSync("where/which lms|ollama")` still used with an in-memory cache; convert to async probing together with #16.

## Verification

GitHub Actions (`.github/workflows/ci.yml`) is the gate of record on every PR:

- **validate** — frozen-lockfile install → dependency audit → lint → unit → server → integration → component tests → recipe smoke → build → production artifact assert → live `pnpm start` smoke
- **security** — CodeQL
- **python-tests** — MCP server pytest
- **docker-build** — MCP server image build + tool smoke

Passes 1–6 were verified green on CI (run #30966708317 on PR #115).
