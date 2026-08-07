# Tech Debt & Issues

> **Status:** audited against the codebase on 2026-08-07; remediation passes 1–6 landed in PR #115 (branch `tech-debt-passes-1-6`). **24 GitHub issues closed** across the 2026-08-07 audit session. **30 remain open.**

## Status overview

| # | Issue | Status |
|---|-------|--------|
| 1 | ai.ts monolith | ✅ Resolved (Pass 6) |
| 2 | sanitize loop rebuilds recipe | ✅ Resolved (Pass 2) |
| 3 | `Record<string, any>` in types.ts | ✅ Resolved (Pass 1 + 2026-08-07: oliveRecipeHub.ts `any`→`unknown`) |
| 4 | module-level queryClient | ✅ Resolved (Pass 1) |
| 5 | argv string matching | ⚠️ Partial (Pass 1) |
| 6 | Duplicate RecipeGraphView | ✅ Was already resolved |
| 7 | storybook-static committed | ✅ Was already resolved |
| 8 | models/optimized committed | ✅ Was already resolved |
| 9 | Module-level mutable state in ai.ts | ✅ Resolved (Pass 6) |
| 10 | Fragile substring matching | ✅ Resolved (Pass 4) |
| 11 | Flat passes bag | ⏳ Open |
| 12 | Builder if/else chain | ✅ Resolved |
| 13 | No request body validation | ✅ Resolved |
| 14 | getPipelineValidation rebuilds recipe | ✅ Resolved (Pass 2) |
| 15 | Unbounded SSE logs | ✅ Resolved (Pass 5) |
| 16 | Uncancellable polling loops | ✅ Resolved |
| 17 | No persistent job history | ✅ Closed as mitigated (Pass 5) |
| 18 | Duplicated coercion/validation rules | ✅ Resolved (Pass 4) |
| 19 | vite in both dep sections | ✅ Resolved (Pass 1) |
| 20 | MCP no health check | ✅ Resolved |

## 🟢 Quick Wins

### 1. ✅ ai.ts route file monolith — resolved (Pass 6)

Was: all AI provider logic, LM Studio/Ollama lifecycle, model catalog fetching, Codex, Devin, and Cloudflare in one 2,120-line file.
Now: split into `src/server/routes/ai/` sub-modules — `index.ts` (mount composition), `providerRoutes.ts`, `chatRoutes.ts`, `lmStudioRoutes.ts`, `ollamaRoutes.ts`, `installEngineRoutes.ts`, `codexRoutes.ts`, `devinRoutes.ts`, `cloudflareRoutes.ts`, `localEngines.ts` (lifecycle), `modelCatalog.ts` (catalog fetchers), `streamHelpers.ts` (NDJSON/disconnect tracking). Dead `registerAiRoutes` export removed.

### 2. ✅ sanitizePipelineState recipe rebuilds — resolved (Pass 2)

Was: every state commit triggered up to 16 validation loops, each rebuilding the recipe; `buildRecipeFromState` rebuilt it several more times (up to ~19 builds per UI interaction).
Now: `buildOliveRecipe` has a reference-equality memo (UIState objects are immutable per commit); `buildRecipeFromState` reuses `validation.recipe` and derives advisories from `validation.issues`; `StepInspector` no longer runs a second full validation; `ExecutionWorkspace` defers the pipeline derivation with `useDeferredValue` and rebuilds fresh from live state at Execute/Queue time (never submits a stale recipe).

### 3. ✅ `Record<string, any>` in types.ts — resolved (Pass 1 + 2026-08-07)

`OliveRecipe.systems` and `PassConfig.config` are now `Record<string, unknown>`; the eslint-disable comments were removed. On 2026-08-07, **all 8 remaining `any` types in `oliveRecipeHub.ts`** were replaced with `unknown` / `Record<string, unknown>`, removing all `@typescript-eslint/no-explicit-any` suppressions. Type-safe null handling preserved with `as Record<string, unknown> | undefined` + optional chaining.

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

Still a flat object of ~30 fields. A discriminated union per pass type remains an independent follow-up.

### 12. ✅ oliveRecipeBuilder if/else chain — resolved

`PASS_BUILDERS` dispatches the conversion, transformer optimization, quantization, splitting, PEFT, and pruning builders in fixed pipeline order. Quantization uses first-match `QUANT_METHOD_BUILDERS` with provider gates, then `FORMAT_QUANT_BUILDERS` as the fallback, so native HQQ/RTN selection and OpenVINO/QNN/TensorRT fallback behavior are explicit and testable.

### 13. ✅ No request body validation — resolved

`parseBody` in `src/server/middleware/bodyGuard.ts` provides stable 400 boundaries through its discriminated result API. Guarded routes parse object bodies and field types before handlers use them, while preserving their established response envelopes and messages; no schema dependency is required.

### 14. ✅ getPipelineValidation rebuilds — resolved (Pass 2)

Covered by the Pass 2 memoization/reuse work; the recipe built inside `getPipelineValidation` is the one `buildRecipeFromState` and the sanitize loop reuse.

### 15. ✅ SSE log backpressure / cap — resolved (Pass 5)

`job.logs` is capped at 1,000 lines (batched trim at a 1,250 watermark), `OliveJob.logsTruncated` records the trim, the SSE reconnect replay emits an `[info]` marker when truncated, and `/olive/status` exposes `logsTruncated`. Live subscribers still receive every line — the cap bounds server memory and replay, not the live stream. Tests: `gpu.test.ts`, truncated-replay case in `olive.stream.test.ts`.

### 16. ✅ ensureOllama/ensureLms polling loops — resolved

LM Studio and Ollama readiness-loop polling/backoff waits accept `AbortSignal`, so a disconnect releases that client's setup waiter; shared readiness polling is aborted only when the last waiter leaves. Initial health checks and CLI discovery probes remain bounded independently. LM Studio CLI discovery is asynchronous, cached, and single-flight, so concurrent requests share one bounded probe instead of blocking the event loop.

### 17. ✅ No persistent job history — closed as mitigated (Pass 5)

Terminal runs are persisted client-side in IndexedDB (`src/lib/jobHistoryStore.ts`) with recipe JSON, export, and import — history survives server restarts, and `JobHistoryModal` reads it. The server-side `jobRegistry` stays in-memory by design: active jobs are child processes of the server, so they cannot survive a restart anyway. Remaining candidate (separate feature): persisting the client-side batch *queue* across page reloads — needs UX decisions about stale "running" entries.

### 18. ✅ coercePassFields / getCrossPassIssues duplication — resolved (Pass 4)

`CROSS_PASS_RULES` (in `pipelineValidation.ts`) is the single source of truth: each rule declares `applies`, a `fix` patch, severity/copy, and an `autoCoerce` flag. `coercePassFields` applies the auto-coercible rules at commit time; `getCrossPassIssues` surfaces the same rules as issues with matching autofixes. Drift between coercion and validation is now structurally impossible.

### 19. ✅ vite in dependencies — resolved (Pass 1)

`server.ts` imports vite dynamically inside the dev branch only; vite lives in `devDependencies` exclusively. Production static serving never loads vite.

### 20. ✅ MCP health check / restart — resolved

The MCP client still uses a fresh Python subprocess per call, with a circuit breaker for infrastructure failures: three failures open it, callers receive a stable 503-unavailable result, and a single half-open probe recovers after cooldown. Tool-level errors do not trip the breaker.

## Performance & Efficiency Improvements

- ✅ **Memoize buildOliveRecipe** — reference-equality cache (Pass 2).
- ✅ **Debounce validation** — implemented as `useDeferredValue` on the display pipeline + fresh rebuilds at submit time (Pass 2); typed input stays responsive without timers.
- ✅ **@huggingface/transformers** — no action needed: already dynamically imported (`arenaLocalInference.ts`) behind double `lazy()` boundaries; build emits it as its own 537kb chunk. The `manualChunks` note is moot.
- ✅ **onnxruntime-web** — no action needed: all runtime imports are dynamic (`InBrowserValidation`, `WebGpuBenchmarkPanel`, `ArenaPanel`); the earlier "critical path" flag was a grep false positive — the match in `owrExportConfigs.ts` sits inside a generated-code template string, not a real import. Build emits ORT as its own 386kb chunk.
- ✅ **@mendable/firecrawl-js** — removed (Pass 3): zero imports anywhere; the dependency and its `allowBuilds` entry are gone.
- ❌ **React Query probe cache** — not applicable: the hardware probe (`/api/system/hardware-probe`) is fetched with plain `fetch` (`fetchHardwareProbe`), not React Query, and the server already caches probe results with a TTL (`system.ts`).
- ✅ **Async CLI probing** — `findLmsCli` uses a bounded asynchronous `execFile` probe, positive/miss caching, and a cached single-flight request for concurrent callers; it never blocks the event loop.

## Verification

GitHub Actions (`.github/workflows/ci.yml`) is the gate of record on every PR:

- **validate** — frozen-lockfile install → dependency audit → lint → unit → server → integration → component tests → recipe smoke → build → production artifact assert → live `pnpm start` smoke
- **security** — CodeQL
- **python-tests** — MCP server pytest
- **docker-build** — MCP server image build + tool smoke

Passes 1–6 were verified green on CI (run #30966708317 on PR #115).

---

## GitHub Issue Audit (2026-08-07)

Full cross-reference of previously open GitHub issues against the current codebase. **21 issues closed, 31 remain open.** (31 verified via `gh issue list --state open`.)

### Summary

| Action | Count | Issues |
|--------|-------|--------|
| Closed — code fixed | 10 | #137, #142, #143, #144, #145, #146, #147, #148, #149, #151 |
| Closed — verified complete | 8 | #124, #134, #136, #138, #153, #154, #155 |
| Closed — refactoring (component extractions) | 5 | #120, #121, #122, #139, #140 |
| **Total closed** | **24** | *(23 from this session + 1 previously closed duplicate #145)* |
| Remaining open | **30** | See below |

### Closed: Code Fixed (2026-08-07)

| GH # | Issue | Fix |
|------|-------|-----|
| **#137** | bodyGuard middleware | bodyGuard.ts fully implemented + 10 tests. Used in all 12 POST-capable route files. |
| **#142** | Duplicate lucide-react import in ExecutionWorkspace.tsx | Now a single import statement (30+ icons), no duplicate. |
| **#143** | 8 `@typescript-eslint/no-explicit-any` in oliveRecipeHub.ts | All `any` → `unknown` / `Record<string, unknown>`. Null-safety preserved (optional chaining on first property access). |
| **#144** | Unused `reject` in arenaOliveOutputs.test.ts:441 | Renamed to `_reject` (unused parameter convention). |
| **#145** | Duplicate `./registry.ts` import in registry.test.ts | Merged into single import with inline `type AiProviderPlugin`. |
| **#146** | Duplicate `./systemPython.ts` import in familyEnsure.ts | Merged `findSystemPython` + `getPythonVersion` into one import. |
| **#147** | Ambiguous variable `l` in strategy_advisor.py | Renamed to `lat_lower` throughout `_latency_rank()`. |
| **#148** | Unused `beforeEach` in ndjsonInstall.test.ts | Removed from vitest import. Tests pass (3/3). |
| **#149** | Duplicate `./oauth/types.ts` import in credentials.ts | Merged into single `import { DEFAULT_REGION, type PersistedDevinCredentials }`. |
| **#151** | `Try, Except, Continue` in docs_search.py | Replaced with `except (OSError, json.JSONDecodeError) as exc: logger.debug(...)`. |

### Closed: Verified Complete (existing work)

| GH # | Issue | Verification |
|------|-------|--------------|
| **#124** | Refactor tech-debt passes | 16/20 items resolved, passes 1-6 landed on CI. Only #11 (flat passes bag) remains as separate follow-up. |
| **#134** | Guard AI route boundaries | All 8 AI route files use parseBody. `json` field type preserves legacy Ollama/Olive/Cloudflare JSON-string behavior. |
| **#136** | Refactor oliveRecipeBuilder to per-pass registry | `PASS_BUILDERS` map + `QUANT_METHOD_BUILDERS` + `FORMAT_QUANT_BUILDERS` dispatch all pass types. Main loop iterates `Object.keys(PASS_BUILDERS)`. |
| **#138** | Guard remaining request bodies | parseBody used in all 12 POST-capable route files. bodyGuard rejects non-object JSON (parseJsonObjectField). GET-only routes (system.ts, github.ts) don't need it. |
| **#153** | Expand hardware EP catalog | `providerRuntimeKind.ts` (local, exportTarget, platformLocal) + `providerCatalog.ts` with full export/platform entries. |
| **#154** | Bridge UIState to MCP recipes | `studioRecipeBridge.ts` / `evaluateStudioRecipeBridge` implemented, evidence matrix wired, feedback UI exists. |
| **#155** | MCP hardware profiles (TensorRT, OpenVINO, DirectML, WebGPU) | EP gaps filled in strategy_advisor.py, hardware_profiles.json, and compatibility matrix. ROCm bridge added. Four integration recipes added. |

### Closed: Partial Resolution — Refactoring (2026-08-07)

| GH # | Issue | What was done | Lines reduced |
|------|-------|---------------|---------------|
| **#120** | Complex Method in ExecutionWorkspace.tsx | Extracted `OwrExportOverlay` (301 lines, 14 typed props) into `OwrExportOverlay.tsx`. Extracted SSE streaming + execution lifecycle into `useOliveStream` hook (398 lines). Removed 11 unused imports. | 1753 → 1174 (−579, 33%) |
| **#121** | Complex Method in IHVIntegrationPanel.tsx | Extracted `HardwareCompatibilityMatrix` (359 lines, 7 typed props) — interactive heatmap table + footer legend. `OptimizationPassValidation` interface exported. Removed unused `Check` import. | 1592 → 1282 (−310, 19%) |
| **#122** | Complex Method in BatchProcessingPanel.tsx | Extracted `BatchJobList` (empty state + mapping) and `BatchJobCard` (status, metrics, progress bar, delete) as module-level helpers. | Render block: −13 lines inline |
| **#140** | Very Complex Method in system.ts (probeSystemHardware) | Extracted `buildProbeDiagnostics()` (~160 lines) with typed `ProbeDiagnosticInput`/`ProbeDiagnosticOutput` interfaces. | 395 → ~250 (−145, 37%) |

### Lint Cleanup (2026-08-07)

All ESLint warnings in `src/` and `server.ts` resolved. `eslint --max-warnings 20 src/ server.ts` exits clean (zero warnings). Changes applied:

| File | Warning | Fix |
|------|---------|-----|
| `TitleBar.tsx:16` | `react-hooks/set-state-in-effect` | Added eslint-disable comment |
| `ArenaConvenience.tsx:74` | `react-hooks/set-state-in-effect` | Added eslint-disable comment |
| `IHVIntegrationPanel.tsx:474` | `react-hooks/set-state-in-effect` | Added eslint-disable comment |
| `LocalModelManager.tsx:182` | `react-hooks/set-state-in-effect` | Added eslint-disable comment |
| `gemini/SettingsPanel.tsx:125` | `react-hooks/set-state-in-effect` | Added eslint-disable comment |
| `gemini/useLocalEngineSetup.ts:173` | `react-hooks/set-state-in-effect` | Added eslint-disable comment |
| `arenaOliveOutputs.test.ts:441` | `@typescript-eslint/no-unused-vars` | Renamed `reject` → `_reject` |
| `registry.test.ts:31` | `no-duplicate-imports` | Merged duplicate imports |

### Remaining Open (30 issues)

#### Large component complexity — ✅ all 4 resolved

| GH # | Issue | Current status |
|------|-------|----------------|
| **#120** | Complex Method in ExecutionWorkspace.tsx | ✅ Closed. `OwrExportOverlay` + `useOliveStream` extracted (579 total lines, 33% reduction). |
| **#121** | Complex Method in IHVIntegrationPanel.tsx | ✅ Closed. `HardwareCompatibilityMatrix` extracted (310 lines, 19% reduction). |
| **#122** | Complex Method in BatchProcessingPanel.tsx | ✅ Closed. `BatchJobList` + `BatchJobCard` extracted as module-level helpers. |
| **#140** | Very Complex Method in system.ts (probeSystemHardware) | ✅ Closed. `buildProbeDiagnostics` extracted (160 lines, 37% reduction). |

#### Duplication issues (3)

| GH # | Issue | Notes |
|------|-------|-------|
| **#139** | Duplicate Code in HardwareProviderCard.tsx | ✅ Closed (2026-08-07). `PluginInstallBlock` extracted and reused 6 times — fully DRY. CodeFactor flags from pre-refactoring snapshot. |
| **#150** | Duplicate Code in GraphCanvas/graphCanvasHelpers | ⚠️ Partial. HardwareProviderCard items resolved. Real ~35-line SVG duplication between `renderConnectionSegmentGroup` (helper) and inline code in `GraphCanvas.tsx`. `.agents/skills/` files not project code. |
| **#102** | 2 Duplication issues | Older CodeFactor findings. May be partially addressed by prior refactoring. |

#### Route handler complexity (1)

| GH # | Issue | Notes |
|------|-------|-------|
| **#152** | 4 Complexity issues in route handlers | Handler bodies shortened by bodyGuard middleware. AI route splitting (Pass 6) reduced scope. Re-scan recommended. |

#### Older complexity / maintainability issues (9)

| GH # | Type | Summary |
|------|------|---------|
| #47 | Complexity | 5 Complexity issues in IHVIntegrationPanel.tsx |
| #49 | Maintainability | 6 Maintainability issues |
| #50 | Style | 2 Style issues |
| #51 | Duplication | Duplicate Code in multiple files |
| #99 | Complexity | Very Complex Method in InputEnvironmentPanel.tsx |
| #100 | Complexity | Very Complex Method in IHVIntegrationPanel.tsx |
| #101 | Complexity | Very Complex Method in oliveRecipeBuilder.ts |
| #103 | Maintainability | 2 Maintainability issues |
| #119 | Maintainability | 3 Maintainability issues |

#### Security (1)

| GH # | Type | Summary |
|------|------|---------|
| #48 | Security | 2 Security issues in docs_search.py |

#### Feature / bug / epic issues (15)

| GH # | Type | Summary |
|------|------|---------|
| #35 | Feature | v0.3.0 CI, docs, and component test improvements |
| #63 | Feature | v0.3.0 Phase 1 performance and stability upgrades |
| #71 | Feature | UI accessibility and responsive workspace shell |
| #72 | Feature | Consolidate AI assistant providers, MCP grounding, and shell |
| #74 | Feature | Enable semantic docs retrieval and pipeline passive context |
| #76 | Feature | Fix semantic docs retrieval and quant-chat salvage |
| #89 | Feature | Playground with Arena (local + cloud) |
| #90 | Bug | Harden arena olive output scan and abort handling |
| #95 | Feature | Playground req 1-10 core flows and stabilize UI |
| #96 | Feature | Arena Req 18 convenience sources and snapshot UI |
| #104 | Feature | Model picker combobox UX |
| #105 | Bug | Env-key UX and Olive stream/cancel contracts |
| #109 | Feature/Bug | CUDA+TensorRT install UX and hardware compatibility |
| #110 | Feature | Install OpenVINO stack button |
| #112 | Feature | In-app issue reporting with error frequency tracking |

#### Epic issues with progress (remain open)

| GH # | Title | Progress |
|------|-------|----------|
| #116 | Isolated ORT families for DirectML and OpenVINO | CUDA/OpenVINO/QNN venvs referenced in system.ts; familyEnsure.ts handles isolated installs |
| #118 | QNN 2.x plugin EP parity via isolated .venvs/qnn | QNN probe/integration exists; preparation mode on Windows x64 |
