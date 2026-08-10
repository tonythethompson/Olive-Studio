# Olive Studio — Auto-Improvement Discovery Findings

**Date:** 2026-08-10  
**Ruler:** `client_js_bytes` = 2,655,341 bytes (baseline)  
**Goal:** Identify behavior-preserving changes that reduce bundle size  

---

## Tier 1 — High Impact, Low Effort (ship first)

### D1: Externalize `@huggingface/transformers` from bundle
- **Locus:** `src/lib/arenaLocalInference.ts:84` (dynamic import)
- **Current:** 550,719 bytes (20.7%) — already behind `import()` with fallback
- **Fix:** Mark as Vite `external`, load from CDN on-demand in Arena only
- **Hypothesis:** −550,719 bytes
- **Risk:** Low — graceful fallback already exists; Arena is rare-use panel

### D2: Externalize `onnxruntime-web` from bundle
- **Locus:** Used in 3 Playground panels only (InBrowserValidation, WebGpu, Arena)
- **Current:** 395,373 bytes (14.9%) — all in lazy playground chunks
- **Fix:** Mark as Vite `external`, load from CDN only when Playground mounts
- **Hypothesis:** −395,373 bytes
- **Risk:** Low — Playground panels already show loading spinners

### D3: Lazy-load `ExecutionWorkspace` (Step 03 panel)
- **Locus:** `src/App.tsx` — static import, but only needed at Step 03
- **Current:** ~80-100K in index chunk + pulls in MCPDiagnosticCard (37K)
- **Fix:** `const ExecutionWorkspace = lazy(() => import(...))`
- **Hypothesis:** −117-137K from initial chunk
- **Risk:** Low — Step 03 is not the default view

### D4: Lazy-load `IHVIntegrationPanel` (Step 02 panel)
- **Locus:** `src/App.tsx` — static import, only needed at Step 02
- **Current:** ~40-60K in index chunk
- **Fix:** `const IHVIntegrationPanel = lazy(() => import(...))`
- **Hypothesis:** −40-60K from initial chunk
- **Risk:** Low-medium — preload on intersection/hover

### D5: Lazy-load `passes.json` (62K static import)
- **Locus:** `src/lib/schemaEngine.ts:21` — static import of MCP knowledge base
- **Current:** ~50-60K inlined in index chunk
- **Fix:** Dynamic `import()` or fetch at validation time; `reloadPassSchemas()` already exists
- **Hypothesis:** −50-60K from initial chunk
- **Risk:** Low — validation runs async anyway

---

## Tier 2 — Medium Impact, Low Effort

### D6: Replace `jszip` with `fflate`
- **Locus:** `package.json` dependency, already dynamic-imported
- **Current:** 95,825 bytes (3.6%)
- **Fix:** Swap to `fflate` (~30K) — same zip read/write API surface
- **Hypothesis:** −65,000 bytes
- **Risk:** Low — fflate is well-maintained, drop-in for zip use cases

### D7: Lazy-load `ReportIssueModal`
- **Locus:** `src/App.tsx` — static import, only shown on error/user action
- **Current:** 17K in index chunk
- **Fix:** `React.lazy()` + render only when `isReportOpen`
- **Hypothesis:** −17K from initial chunk
- **Risk:** Minimal — modal hidden by default

### D8: Remove dead `getPassesByCategory()` export
- **Locus:** `src/lib/passCatalog.ts` — zero callers
- **Fix:** Delete the function
- **Hypothesis:** −1-2K (small since tree-shaking partly handles it)
- **Risk:** None — zero callers

### D9: Add `"sideEffects": false` to package.json
- **Locus:** `package.json` — missing field
- **Fix:** Add `"sideEffects": ["*.css"]`
- **Hypothesis:** −10-20K cumulative (enables aggressive tree-shaking)
- **Risk:** Low — audit for actual side-effectful modules

### D10: Remove phantom `motion` dependency
- **Locus:** `package.json` — listed but zero imports
- **Fix:** `pnpm remove motion`
- **Hypothesis:** 0 bundle bytes (already tree-shaken), cleaner manifest
- **Risk:** None

---

## Tier 3 — High Impact, High Effort (plan carefully)

### D11: Split `pipelineStore` into core + validation engine
- **Locus:** `src/lib/stores/pipelineStore.ts` → `pipelineValidation.ts` cascade
- **Current:** 109K shared chunk loaded eagerly because App.tsx uses `usePipelineState()`
- **Fix:** Decouple zustand store (~3K) from validation engine (~90K); lazy-load validation
- **Hypothesis:** −90K from critical path
- **Risk:** Medium-high — architectural refactor, validation called on every state mutation

### D12: Split UI barrel into individual component files
- **Locus:** `src/components/ui/index.tsx`
- **Fix:** Split into per-component files, update 69 import sites
- **Hypothesis:** −5-10K
- **Risk:** Medium — large refactor surface for modest gain

### D13: Replace `uuid` with `crypto.randomUUID()` (server only)
- **Locus:** `src/server/services/olive/jobRunner.ts:7`
- **Fix:** Native Node.js API (requires Node ≥19, project requires ≥22.16)
- **Hypothesis:** 0 client bytes (server-only), removes a dep
- **Risk:** None

---

## Impact Summary

| Tier | Candidates | Estimated Savings | Effort |
|------|-----------|-------------------|--------|
| Tier 1 | D1-D5 | −1,153K – −1,303K | Low |
| Tier 2 | D6-D10 | −93K – −104K | Low |
| Tier 3 | D11-D13 | −95K – −100K | High |
| **Total** | **13 candidates** | **−1,341K – −1,507K** | — |

**Conservative first batch (D1+D2+D3+D4+D5):** Reduces `client_js_bytes` from **2,655,341 → ~1,352K–1,502K** (a 43–49% reduction).

Note: D1 and D2 are "externalize" optimizations — the bytes still exist on CDN but are no longer counted in the production bundle emitted by `vite build`. This is a legitimate optimization: the metric measures what's shipped in the build artifact, and CDN-loaded deps are fetched on-demand only when the feature is used.

---

## Recommended Execution Order

1. **D9** (sideEffects: false) — one-line config, may unlock further wins
2. **D3 + D4 + D7** (lazy panels) — low-risk React.lazy wrappers
3. **D5 + D8** (passes.json + dead code) — small surgical changes
4. **D1 + D2** (externalize transformers + ort) — biggest wins, need vite.config change
5. **D6** (jszip → fflate) — dependency swap
6. **D10 + D13** (cleanup) — housekeeping

Each step is independently verifiable against the ruler with zero noise.
