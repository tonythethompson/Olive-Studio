# Olive Studio — Auto-Improvement Ruler Design

## Status: CALIBRATED ✅

Calibrated 2026-08-10. Ready for Phase 2 optimization cycles.

---

## Primary Metric

| Property | Value |
|----------|-------|
| **Label** | `client_js_bytes` |
| **Description** | Total uncompressed JavaScript in the production client bundle |
| **Baseline** | 2,655,341 bytes (2.53 MB) |
| **Direction** | Lower is better |
| **Noise band** | **0 bytes** (perfectly deterministic) |
| **Measurement** | `bash data/ruler/measure.sh` |

### Why This Metric

1. **Zero noise** — Vite/Rollup produce bit-identical output across builds. No statistical filtering needed. Any delta ≠ 0 is a real change.
2. **Directly actionable** — Bundle size is affected by code structure (dead code, dependency choices, tree-shaking, code splitting). An optimizer can make behavior-preserving changes that move this number.
3. **User-impacting** — Smaller bundles mean faster page loads, especially on mobile/slow connections.
4. **Rich optimization surface** — The app ships 2.53 MB of client JS across 32 chunks, with clear vendor/app separation and multiple optimization vectors.

### Rejected Alternatives

| Candidate | Why rejected |
|-----------|-------------|
| Test wall-clock time | 11.2% CV (4.51s noise band on 20.15s mean). Too noisy for WSL. |
| Vite build time | 4.2% CV but only 2.5s absolute — hard to improve meaningfully |
| tsc --noEmit time | 3.7% CV, 15.4s mean — interesting but not user-impacting |
| Test coverage % | Already at 94.87% — optimizing this isn't performance work |

---

## Bundle Breakdown (Baseline)

### By Category
- **Vendor libraries**: 1,738,048 bytes (65.4%)
  - transformers.web: 551K
  - ort.bundle.min: 395K
  - typegpu: 294K
  - vendor-react: 178K
  - olive-recipes-catalog: 193K
  - vendor-radix: 80K
  - jszip: 96K
  - vendor-icons: 30K
  - vendor-query: 30K
- **App code**: 917,293 bytes (34.6%)
  - index (main app): 282K
  - pipelineStore: 109K
  - AssistantSidebar: 98K
  - RecipeGraphView: 115K
  - panels (Batch, Arena, WebGpu, MCP): ~89K

### By Chunk Count
- 32 JS chunks in `dist/assets/`
- 1 CSS file (100K)
- 1 server bundle (887K, measured separately)

---

## Guardrails

These must ALL pass or the change is rejected:

1. **Unit tests** — `vitest run` exits 0 (currently 1,018 tests)
2. **Server tests** — `vitest run --config vitest.server.config.ts` exits 0 (389 tests)
3. **Type check** — `tsc --noEmit` exits 0
4. **No regression** — Bundle must not grow >500 bytes without justification

---

## Reward-Hack Guards

1. **No feature removal** — Size reduction must not come from deleting used functionality
2. **No lazy→eager consolidation** — Chunk count must stay ≥25 (avoids bloating initial load)
3. **Gzip correlation** — Compressed size must decrease proportionally
4. **No readability sacrifice** — Source code must remain readable and maintainable

---

## Canary

| Property | Value |
|----------|-------|
| **Method** | Inject ~100 chars into `OLIVE_VERSION` (a used export in `passCatalog.ts`) |
| **Expected delta** | +98 bytes |
| **Measured delta** | +98 bytes |
| **Restore check** | Exact baseline recovery (2,655,341 bytes) |
| **Status** | ✅ PASS |

The canary proves the harness correctly detects:
- Code additions (injected string appears in bundle)
- Code removals (restoring removes the bytes exactly)
- The measurement is perfectly reproducible

---

## Calibration Data

### Bundle Size (Primary — 5 consecutive builds)
```
Run 1: 2,655,341 bytes
Run 2: 2,655,341 bytes
Run 3: 2,655,341 bytes
Run 4: 2,655,341 bytes
Run 5: 2,655,341 bytes
σ = 0, noise_band = 0 bytes
```

### Test Suite Wall-Clock (Rejected — 20 runs)
```
Mean: 20.15s, σ = 2.25s, CV = 11.2%
Min: 17.00s, Max: 26.31s
Noise band: 4.51s (22.4% of mean) — too noisy
```

### Vite Build Time (Secondary reference — 9 warm-cache runs)
```
Mean: 2.509s, σ = 0.105s, CV = 4.2%
Noise band: 0.211s (8.4% of mean)
```

---

## Optimization Vectors (Phase 2 Targets)

1. **Dead code elimination** — Unused exports, unreachable branches, dev-only code
2. **Dependency pruning** — Replace heavy deps with lighter alternatives or native APIs
3. **Code splitting** — Move rarely-used panels behind `React.lazy()` boundaries
4. **Tree-shaking barriers** — Fix barrel re-exports, side-effect markers
5. **Duplicate logic** — Consolidate repeated utility implementations

---

## Running the Ruler

```bash
# Full measurement (tests + tsc + build + metrics)
bash data/ruler/measure.sh

# Canary validation (proves harness works)
bash data/ruler/canary.sh

# Quick build-only check (no tests)
cd /home/tonyt/olive-studio
rm -rf dist/ && node_modules/.bin/vite build
find dist/ -name "*.js" ! -name "server.mjs" -exec cat {} + | wc -c
```
