# Olive Studio Code Review

**Reviewed:** 2026-07-31  
**Baseline:** `v0.2.0` (`package.json`); Tauri config reports `0.3.0`  
**Scope:** Architecture, correctness hotspots, test shape, and ship-risk for local-first use  
**Method:** Static review of `src/`, `server.ts`, `olive-mcp-server/`, `src-tauri/`, CI config. No live Olive GPU runs.

---

## Verdict

**Ship for single-user localhost / Tauri use**, with the local-trust model documented clearly.  
**Do not expose the Express API to a LAN or the public internet** without bind + authn fixes.

The product core (recipe build → validate → spawn Olive → SSE logs) is coherent and well gated by schema/pipeline validation. The largest risks are network exposure (binds `0.0.0.0`, no auth), user-controlled recipe filesystem paths, and a broken MCP tool proxy import.

| Area                | Assessment                                                           |
| ------------------- | -------------------------------------------------------------------- |
| Recipe correctness  | Strong: layered client + server validation                           |
| Local runner / venv | Solid process model; pin `olive-ai` for supply-chain stability       |
| AI providers        | Good plugin registry; some duplication and catalog sync risk         |
| MCP (stdio agents)  | Healthy FastMCP package + pytest                                     |
| MCP (in-app proxy)  | Broken: imports missing `call_tool`                                  |
| UI maintainability  | Three mega-panels (~1.6k–2k lines) dominate complexity               |
| Test tiers          | Strong lib/server/integration; gaps in recipe-graph and large panels |
| Network security    | Local-trust only; not safe as a shared service                       |

---

## Architecture (ranked)

```text
Browser / Tauri WebView
  └─ React (src/) ──fetch──► Express (server.ts)
                               ├─ spawn ──► Olive CLI (.venv)
                               ├─ execFile ──► Python MCP call_tool (proxy; currently broken)
                               ├─ fetch ──► AI provider APIs / LM Studio / Ollama
                               └─ execFile ──► nvidia-smi, system probes

Tauri (release) ──spawn──► node dist/server.mjs
External agents ──stdio──► olive-mcp-server/run.py
```

### 1. UI

- **Entry:** `index.html` → `src/main.tsx` → `src/App.tsx` (input → hardware → execute).
- **State:** `src/lib/stores/pipelineStore.ts` is intentionally thin (~59 lines). Real rules live in `pipelineValidation.ts` via `commitUiStateUpdate`.
- **Hotspots:**
  - `InputEnvironmentPanel.tsx` (~2018)
  - `IHVIntegrationPanel.tsx` (~1652)
  - `ExecutionWorkspace.tsx` (~1610)
  - `BatchProcessingPanel.tsx` (~835)
- **Likely orphans:** `EnterpriseInfraPanel.tsx`, `PerformanceMetrics.tsx` (not mounted from `App.tsx`).

### 2. Express server

- **Entry:** `server.ts` mounts `ai`, `env`, `github`, `mcp`, `olive`, `system`.
- **Critical paths:** `routes/olive.ts` (job spawn + SSE), `services/venv/` (Python discovery + `.venv`), `routes/ai.ts` (~926 lines), `routes/mcp.ts`.
- **Controls present:** `pythonGuard.ts`, AI base-URL allowlists (`services/ai/security.ts`), GitHub proxy SSRF checks, selective rate limits (`middleware/rateLimit.ts`).

### 3. Validation / recipe libs

Hub path:

```text
UIState → sanitizePipelineState → buildOliveRecipe → schema + pipeline checks → POST /api/olive/run (re-validates)
```

Key files: `recipePipeline.ts`, `pipelineValidation.ts` (~761), `oliveRecipeBuilder.ts`, `schemaEngine.ts`, `passParameterValidation.ts`.

### 4. Olive MCP (Python)

- Stdio FastMCP in `olive-mcp-server/` (27 tools, KB JSON, pytest).
- Pin: `mcp<2` (2.x removes `mcp.server.fastmcp`).
- In-app proxy is separate and currently broken (see Findings).

### 5. Tauri shell

- `src-tauri/src/lib.rs`: release spawns Node sidecar, polls `/api/health`, navigates WebView to loopback.
- CSP disabled (`tauri.conf.json`); version skew vs `package.json` (0.3.0 vs 0.2.0).

### 6. Tests / CI

| Tier         | Command                             | Notes                                    |
| ------------ | ----------------------------------- | ---------------------------------------- |
| Lib unit     | `pnpm test`                         | Strong on recipe/pipeline/schema         |
| Server unit  | `pnpm test:server`                  | AI registry, olive cancel, MCP route     |
| Integration  | `pnpm test:integration`             | Real Express; externals mocked           |
| Component    | `pnpm test:component`               | 9 feature tests; thin vs mega-panel size |
| Recipe smoke | `pnpm validate:recipe`              | In CI                                    |
| Python       | pytest in `olive-mcp-server/tests/` | Separate CI job                          |
| E2E          | Playwright `e2e/`                   | Not in main `validate` job               |

CI also runs `pnpm audit --audit-level high`, build, artifact assert, prod smoke, CodeQL.

---

## Findings

Severity assumes the documented local-first threat model. LAN exposure raises every item that touches spawn, tokens, or filesystem.

### Critical

1. **API has no authn and binds all interfaces**  
   **Verified:** `server.ts` listens on `0.0.0.0`. No auth middleware on olive / mcp / env / ai routes.  
   **Impact:** Any LAN client can spawn Olive jobs, proxy MCP, set HF tokens, trigger heavy installs.  
   **Fix:** Default bind `127.0.0.1`; optional shared secret; document never expose to network.

2. **Recipe filesystem paths are not constrained before Olive spawn**  
   **Verified:** Schema checks structure; `olive.ts` writes the recipe and spawns Olive. Paths inside the recipe are user-controlled.  
   **Impact:** With API access, Olive can be pointed at arbitrary read/write locations.  
   **Fix:** Allowlist under cwd / configured model roots; reject `..` and out-of-root absolutes.

### High

3. **In-app MCP proxy imports a missing `call_tool`**  
   **Verified:** `mcp.ts` runs `from olive_mcp_server.mcp_server import call_tool`, but `mcp_server.py` only exposes FastMCP tools (no module-level `call_tool`). Tests use `mcp.call_tool(...)`, a different API.  
   **Impact:** `POST /api/mcp/tool` fails at runtime; fragile `-c` string embedding.  
   **Fix:** Add an allowlisted `call_tool` helper (or invoke FastMCP properly); pass args via stdin/JSON file, not interpolated Python.

4. **`/api/mcp/tool` is unrate-limited and spawns Python**  
   **Verified:** No rate limit on the tool route (KB sync is limited).  
   **Fix:** Apply `heavyCommandRateLimit` or a dedicated limiter.

5. **`SYNC_KB_TOKEN` is documented but not enforced**  
   **Verified:** `.env.example` and `useKbSync.ts` send `x-sync-token`; `POST /mcp/sync-kb` never checks it.  
   **Fix:** Enforce when env is set, or remove the docs.

6. **Runtime `olive-ai` install is unpinned**  
   **Verified:** venv path installs `olive-ai` without a version pin.  
   **Fix:** Pin in install command + document supported Olive versions.

### Medium

7. Several cost/abuse endpoints lack rate limits (`/ai/chat`, Codex ask, Ollama pull path).
8. HF token setter is unrate-limited.
9. Job logs are readable by job ID on the open API.
10. Tauri CSP is null; weaker XSS containment in the desktop shell.
11. Version skew: Tauri `0.3.0` vs npm `0.2.0`.
12. KB sync unexpected errors may surface as success-shaped responses (check `mcp.ts` catch path).
13. No global Express error middleware (unhandled errors may leak stacks).
14. Devin credentials persist on disk (`0o600`, gitignored); acceptable for local-first, harden later if needed.
15. Local Python `mcp` dep allows `>=1.0.0` in `pyproject.toml`; CI pins `mcp<2`, but local installs can still break on 2.x.

### Low / positive controls

- Olive executable/args are server-chosen; temp recipes under `.olive-runs/`.
- Python interpreter allowlisting (`pythonGuard.ts`).
- AI provider base-URL SSRF checks; GitHub proxy capped.
- Runtime AI keys are memory-only (not written from Settings).
- GET provider status omits `apiKey`.
- CI audit + CodeQL + multi-tier tests.

---

## Maintainability priorities

1. **Split mega-panels** (`InputEnvironment`, `IHV`, `ExecutionWorkspace`) into feature folders with colocated hooks/tests.
2. **Keep validation logic in libs**, not duplicated in IHV cell helpers / inspectors.
3. **Deduplicate OpenAI-compat provider registrations** and `wantJson` prompt suffixes; keep UI `aiProviderCatalog.ts` in sync with server registry via a shared ID list or test.
4. **Cover `recipe-graph/`** and large untested libs (`passCatalog`, `oliveRecipeHub`, `jobHistoryStore`, `vramEstimate`).
5. **Confirm or remove** orphan panels (`EnterpriseInfraPanel`, `PerformanceMetrics`).
6. **Fix MCP proxy** before relying on in-app diagnostics in production UX.

---

## Reviewer checklist (PRs)

When reviewing changes, prioritize:

- [ ] `src/server/routes/olive.ts` + `services/venv/` (spawn, paths, env secrets)
- [ ] `src/server/routes/mcp.ts` (Python bridge, tool allowlist, rate limits)
- [ ] `src/server/routes/ai.ts` + `services/ai/security.ts` (keys, SSRF, spend)
- [ ] `src/lib/pipelineValidation.ts` + `oliveRecipeBuilder.ts` + `schemaEngine.ts`
- [ ] `src-tauri/src/lib.rs` (sidecar lifecycle)
- [ ] No real Olive GPU / model downloads in CI
- [ ] New providers registered on both server and UI catalog
- [ ] Rate limits on new heavy or secret-mutating endpoints

---

## Suggested next actions

| Priority | Action                                                                   |
| -------- | ------------------------------------------------------------------------ |
| P0       | Bind default to `127.0.0.1`; document local-trust threat model in README |
| P0       | Repair MCP `call_tool` proxy + tool allowlist + rate limit               |
| P1       | Recipe path allowlisting before spawn                                    |
| P1       | Enforce or drop `SYNC_KB_TOKEN`                                          |
| P1       | Pin `olive-ai` (and document supported range)                            |
| P2       | Align Tauri / package versions; tighten packaged CSP                     |
| P2       | Split mega-panels; add recipe-graph component tests                      |
| P2       | Gate Playwright smoke in CI (CPU-only flows)                             |

---

## Related docs

- [AGENTS.md](AGENTS.md): agent/dev constraints
- [ABOUT.md](ABOUT.md): product intent
- [ROADMAP.md](ROADMAP.md): v0.3+ targets
- [README.md](README.md): user-facing setup
- [CHANGELOG.md](CHANGELOG.md): shipped behavior

_This file is a point-in-time review snapshot. Update it when critical findings are fixed or the threat model changes._
