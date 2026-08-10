# Olive Studio — Post-PR #219 Discovery Sweep

**Date:** 2026-08-10T01:35Z  
**Baseline (main @ 91155c3):** 1,648,669 bytes, 39 chunks  
**Prior art:** PR #219 shipped D1–D10, reducing from 2,655,341 → 1,648,669 (−37.9%)  
**Goal:** Find behavior-preserving changes that reduce bundle further  

---

## Tier 1 — High Impact, Low Effort

### D14: Externalize `typegpu` (293K)

- **Locus:** `src/components/features/playground/WebGpuBenchmarkPanel.tsx:196` — `await import("typegpu")`
- **Current bytes:** 293,559 (17.8% of total bundle)
- **Usage:** Only `tgpuMod.default.init()` — a runtime WebGPU pipeline probe. No WGSL shader compilation, no build-time transforms used.
- **Why bundled despite dynamic import:** `unplugin-typegpu/vite` (line 1 of `vite.config.ts`) forces Vite to resolve the full dependency. The plugin does JS→WGSL transpilation at build time, but this project uses none of that — just a runtime init probe.
- **Fix:** Add `'typegpu'` to `build.rollupOptions.external`. Condition `unplugin-typegpu` with `apply: 'serve'` (dev DX only). Load from CDN at runtime (same pattern as transformers/onnxruntime).
- **Hypothesis:** −293,559 bytes (−17.8%)
- **Risk:** Low — usage is purely runtime init probe behind dynamic import with try/catch fallback. No build-time WGSL transforms to preserve. The `unplugin-typegpu` peer dep on typegpu is only needed for the plugin's own resolution in dev.
- **Confidence:** High

### D15: Remove client-side recipe catalog chunk (192K)

- **Locus:** `src/data/olive-recipes-catalog.ts` → `dist/assets/olive-recipes-catalog-CCvYQIkW.js` (192,642 bytes)
- **Current status:** Already code-split (separate chunk, dynamic import in `src/data/recipes.ts:17`). However, `recipes.ts` fires `loadSuggestedRecipes().then(...)` eagerly at module load (line 36), and `recipes.ts` is statically imported by `InputEnvironmentPanel.tsx`.
- **Fix path A — defer prefetch:** Move `loadSuggestedRecipes()` call from module-load to first user interaction with recipe browser (IntersectionObserver or click). Chunk stays in bundle but isn't fetched on page load.
- **Fix path B — remove from bundle entirely:** The server endpoint `/api/github/catalog` already serves this data. Remove the static catalog file; `loadSuggestedRecipes()` fetches from the API. The 192K vanishes from the JS bundle and becomes a cacheable API response.
- **Hypothesis:** Path A: 0 byte reduction (still bundled, just deferred). Path B: −192,642 bytes (−11.7%)
- **Risk:** Path A: None. Path B: Medium — requires API to be available; offline/static deployments lose recipe suggestions. Need a fallback.
- **Confidence:** High (chunk identity confirmed), Medium (path B feasibility depends on deployment model)

---

## Tier 2 — Medium Impact, Moderate Effort

### D16: Split `pipelineValidation` from store critical path (50–55K)

- **Locus:** `src/lib/stores/pipelineStore.ts:5` — `import { commitUiStateUpdate } from "@/lib/pipelineValidation"`
- **Current bytes:** ~66K in `pipelineStore` shared chunk, eagerly preloaded
- **Root cause:** `commitUiStateUpdate` → `sanitizePipelineState` → `getPipelineValidation` pulls the entire 1,046-line validation engine + its imports (oliveRecipeBuilder, qnnReadiness, schemaEngine, hardwareProbe, providerRuntimeKind) into the initial load.
- **Fix:** Extract `mergeUiState` + `sanitizePipelineState` + `coercePassFields` into `pipelineStateMerge.ts` (~150 lines). The store imports only that lightweight module. Heavy validation stays in `pipelineValidation.ts`, imported only by lazy panels.
- **Challenge:** `sanitizePipelineState` internally calls `getPipelineValidation()` (line 940). Must either: (a) inline the ~30 critical-only rules, or (b) inject `validate` as a callback at store init from the app shell.
- **Hypothesis:** −50–55K from critical-path chunk
- **Risk:** Medium-High — architectural refactor; validation runs synchronously on every state mutation. Must not break invariants.
- **Confidence:** Medium (savings real but refactor complexity may force a compromise)

### D17: Lazy-load `MCPDiagnosticCard` in Execute panels (17K)

- **Locus:** `src/components/features/execute/BatchProcessingPanel.tsx:21` and `ExecutionWorkspace.tsx:27` — static imports
- **Current bytes:** 17,407 in separate chunk, loaded whenever Execute tab opens
- **Fix:** `React.lazy(() => import("./MCPDiagnosticCard"))` with Suspense fallback in both consumers. Only load when MCP diagnostics are actually relevant.
- **Hypothesis:** −17,407 from Execute-tab load (still in bundle, just deferred further)
- **Risk:** Low — straightforward React.lazy refactor
- **Confidence:** Medium (real bytes, but user visits Execute tab as primary workflow)

---

## Tier 3 — Low Impact, Low Effort (Hygiene)

### D18: Consolidate 6× duplicate `formatBytes()` implementations (~1.5K)

- **Locus:**
  - `src/components/features/assistant/LocalAiSetupCard.tsx:15`
  - `src/components/features/playground/WebGpuBenchmarkPanel.tsx:123`
  - `src/components/features/playground/ArenaPanel.tsx:80`
  - `src/components/features/playground/ArenaConvenience.tsx:20`
  - `src/components/features/input/localFileUtils.ts:13`
  - `src/lib/localEngineDisk.ts:64`
- **Fix:** Single `formatBytes()` in `src/lib/utils.ts`, import everywhere.
- **Hypothesis:** −1,500 bytes
- **Risk:** None — pure function
- **Confidence:** High

### D19: Remove dead `@google/genai` dependency (0 bundle bytes)

- **Locus:** `package.json` — listed as dependency, zero imports in source
- **Fix:** `pnpm remove @google/genai`
- **Hypothesis:** 0 client bundle impact (cleaner manifest + smaller node_modules)
- **Risk:** None
- **Confidence:** High

### D20: Remove `unplugin-typegpu` from build pipeline (if D14 ships)

- **Locus:** `vite.config.ts:1` + `package.json` devDependency
- **Fix:** Remove the import and plugin registration (or gate with `apply: 'serve'`)
- **Hypothesis:** 0 bundle bytes (plugin is build-time only), faster builds (~100ms)
- **Risk:** None if D14 externalizes typegpu — the plugin's WGSL transpilation is unused
- **Confidence:** High

### D21: Lazy-load `VramEstimateBanner` on narrow viewports (3–5K)

- **Locus:** `src/App.tsx:9` — eagerly imported, rendered under `hidden wide:block`
- **Fix:** `React.lazy()` wrapper; only materializes on wide viewports
- **Hypothesis:** −3–5K from critical path on mobile
- **Risk:** Low — already CSS-hidden on narrow
- **Confidence:** Low (may pull in minimal deps only)

---

## Impact Summary

| Tier | IDs | Estimated Savings | Effort |
|------|-----|-------------------|--------|
| Tier 1 | D14, D15 | −293K to −486K | Low–Medium |
| Tier 2 | D16, D17 | −67K to −72K | Medium–High |
| Tier 3 | D18–D21 | −5K (hygiene) | Low |
| **Total** | **8 candidates** | **−365K to −563K** | — |

## Projected Bundle After Full Execution

| Scenario | Bundle Size | Reduction from Current | Total from Original |
|----------|------------|----------------------|-------------------|
| D14 only | 1,355,110 | −17.8% | −49.0% |
| D14 + D15(B) | 1,162,468 | −29.5% | −56.2% |
| D14 + D15(B) + D16 | ~1,107K | −32.8% | −58.3% |
| All | ~1,085K | −34.2% | −59.1% |

## Recommended Execution Order

1. **D14** — One vite.config.ts change, biggest win (−293K), trivial risk
2. **D19 + D20** — Housekeeping, remove dead deps
3. **D15 path A** — Defer catalog prefetch (zero-risk, saves network on first load)
4. **D18** — Consolidate formatBytes (5-minute refactor)
5. **D17** — Lazy MCPDiagnosticCard (10-minute refactor)
6. **D16** — pipelineStore split (if architecturally feasible)
7. **D15 path B** — Remove catalog from bundle entirely (only if API-first deployment confirmed)
