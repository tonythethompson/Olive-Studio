# Pitch: Elevate Olive MCP — Server Quality + First-Class mcporter Integration

**Working title:** Olive MCP as the agent-facing control plane for Olive Studio  
**Audience:** Olive Studio maintainers, MCP consumers, agent-tooling stakeholders  
**Status:** Proposal (grounded in live mcporter testing, pytest suite, and current Studio/MCP architecture)  
**Date:** 2026-08-07  
**Current grade (observed):** **B+** — strong domain product; ops/cold-start and agent-client story hold it back from **A**

---

## 1. Executive summary

Olive MCP (`olive-mcp-server`) is already a **high-quality specialized advisor**: 20 tools, deep knowledge base (84 passes, 20+ hardware profiles, dual-domain troubleshooting, integration recipes), strong tests, and a careful Studio loopback bridge that never shells out to real Olive runs.

What it is **not** yet is a **reliable agent platform client experience**. Short-lived stdio sessions (typical of mcporter `call`, some IDEs, and one-shot scripts) pay a heavy cold-start tax—especially on embedding-backed tools—so troubleshoot and doc search can time out even when the logic is correct in-process.

In parallel, Olive Studio already owns a **first-class product path** to MCP (`POST /api/mcp/tool`, studio-recipe bridge, KB status/sync, rate limits, circuit breaker). **mcporter should not replace that path.** It should become the **supported external client** for coding agents, CI, and power users—intentionally documented, configured, and smoke-tested.

This pitch unifies two recommendation sets:

| Track | Goal |
|--------|------|
| **A. Server internals** | Make Olive MCP fast, warm, predictable, and A-grade under real agent load |
| **B. mcporter + Studio agent story** | Make agents reliably discover, call, and depend on Olive MCP without inventing a second product runtime |

**Outcome:** Olive MCP becomes the default way agents reason about Olive *and* a clean companion to Studio—not a rival stack and not a bolted-on CLI curiosity.

---

## 2. Problem statement

### 2.1 What works today

- **Domain depth:** Passes, chains, quantization strategy, hardware guides, compatibility matrix, integration recipes, pass parameter deep-dives.
- **Safety:** Guidance and validation only; Studio bridge is loopback-only; feedback tool rejects free-text privacy traps.
- **Correctness culture:** Hundreds of unit/integration tests; structured error shapes (`studio_unavailable`, etc.).
- **Product integration (Studio):** Express routes, breakers, rate limits—production-minded.

### 2.2 What fails under agent conditions

| Failure mode | Evidence | Impact |
|--------------|----------|--------|
| **Cold stdio + embeddings** | In-process troubleshoot ~12s first load; mcporter calls timed out at 60–180s | Agents mark olive “offline” for the tools they need most |
| **Process-per-call clients** | mcporter default `call` / many CI scripts | Every call reloads Python + optional MiniLM |
| **Fragile launch config** | Project mcporter / `.mcp.json` often use bare `python` | Wrong env vs tested `.venv`; missing deps |
| **Shell ergonomics** | Args like `<100ms` break PowerShell | False negatives when agents compose CLI |
| **Dual story undocumented** | Studio HTTP path vs external MCP path | Contributors don’t know which surface to use |
| **Bridge tools silent without Studio** | Correct `studio_unavailable` but no agent “runbook” | Agents retry blindly or abandon UIState tools |

### 2.3 Strategic risk if we do nothing

- External agents (Claude, Cursor, Grok, Hermes, scripts) underuse Olive MCP or treat it as flaky.
- Studio’s excellent in-app MCP path and the open MCP server **diverge in quality perception**.
- Competitors ship thinner MCP wrappers that *feel* more reliable because they stay keyword-fast and warm.

---

## 3. Vision

> **One Olive MCP server. Two first-class clients.**
>
> - **Olive Studio** — product UI/assistant via Express (unchanged principle).
> - **mcporter (+ native MCP hosts)** — agent/CLI/CI via documented, warm, smoke-tested integration.

Agents should experience:

1. **Sub-second** catalog tools (passes, chain, params, recipes).
2. **Bounded, predictable** semantic tools (troubleshoot, search)—or a fast non-semantic default.
3. **One config story** for local dev: venv Python, optional Studio loopback, daemon optional.
4. **Clear health**: “olive ready / embeddings loaded / Studio bridge up.”

---

## 4. Track A — Improve `olive-mcp-server` itself

### 4.1 Design principles

1. **Fast path by default; rich path by opt-in.**
2. **Amortize model load across the session, not the call.**
3. **Never block catalog tools on embeddings.**
4. **Structured, stable errors** (already good—extend for health/timeouts).
5. **No real Olive execution from MCP** (keep CPU-only agent safety).

### 4.2 Workstream A1 — Cold-start & process lifecycle (**P0**)

**Problem:** `sentence-transformers` / `all-MiniLM-L6-v2` lazy-load on first semantic use; short-lived stdio pays that every time.

| Initiative | Description | Success metric |
|------------|-------------|----------------|
| **A1.1 Tiered search/troubleshoot** | Default: keyword / hybrid **without** loading MiniLM. Flag `semantic=true` or env `OLIVE_MCP_SEMANTIC=1` enables embeddings | p95 keyword troubleshoot &lt; 1s cold; semantic documented as “first call ~10–30s” |
| **A1.2 Eager optional preload** | Env `OLIVE_MCP_PRELOAD_EMBEDDINGS=1` loads model at process start for long-lived hosts | Warm semantic p95 &lt; 2s after ready |
| **A1.3 Ready / health tool** | `get_mcp_health` → versions, tool count, embedding loaded?, Studio URL configured?, loopback probe optional | Agents can gate workflows |
| **A1.4 Background index build** | Build KB embedding index after first semantic request or on preload, non-blocking for other tools | Catalog tools unaffected |
| **A1.5 Timeout honesty** | If semantic path exceeds N seconds, return partial keyword results + `degraded: true` rather than hanging client | No more silent 180s deaths |

**Non-goals:** Replacing FastMCP; rewriting the whole KB in a vector DB for v1.

### 4.3 Workstream A2 — Tool UX & schema quality (**P1**)

| Initiative | Description |
|------------|-------------|
| **A2.1 Agent-safe parameter defaults** | Avoid values that shell-break (`&lt;100ms` → `under_100ms` or numeric ms fields) |
| **A2.2 Stable JSON envelopes** | Consistent `{ ok, data, error, meta }` where missing; keep backward-compatible dual shape if needed |
| **A2.3 Tool grouping in descriptions** | Prefix categories: `[catalog]`, `[strategy]`, `[troubleshoot]`, `[studio-bridge]`, `[feedback]` for agent routing |
| **A2.4 “Unknown pass / unknown model” playbooks** | Always return next actions (list filters, closest names) |
| **A2.5 Deprecate/alias hygiene** | Keep `diagnose_error`; document primary names in one table (README already partial) |

### 4.4 Workstream A3 — Knowledge base & fidelity (**P1–P2**)

| Initiative | Description |
|------------|-------------|
| **A3.1 Continuous KB refresh** | Formalize `scripts/update_kb.py` schedule + `update_report.json` visibility in health |
| **A3.2 Pass availability check** | Wire `check_olive_pass_availability.py` into CI “warn if Olive upstream adds passes we lack” |
| **A3.3 Evidence versioning** | Tag compatibility/recipes with Olive/ORT version ranges agents can filter |
| **A3.4 Studio domain growth** | Expand `studio_troubleshooting.json` from real Studio error telemetry (privacy-preserving aggregates only) |
| **A3.5 Recipe ↔ Studio UIState mapping notes** | Document how integration recipes map to pipeline store fields for bridge tools |

### 4.5 Workstream A4 — Packaging, pins, deploy (**P1**)

| Initiative | Description |
|------------|-------------|
| **A4.1 Entry points** | Keep `run.py` + module entry; document Windows/macOS/Linux equally |
| **A4.2 Dependency tiers** | `olive-mcp-server[semantic]` optional extra for sentence-transformers; core stays lighter |
| **A4.3 mcp pin** | Keep `mcp&lt;2` until FastMCP migration plan exists; test both in CI matrix when ready |
| **A4.4 Docker** | Image with pre-cached MiniLM optional tag `olive-mcp:semantic` vs slim `olive-mcp:core` |
| **A4.5 Versioning** | Bump toward `0.2.0` when health + tiered semantic ship |

### 4.6 Workstream A5 — Studio bridge (server side) (**P1**)

Already well designed. Extend:

| Initiative | Description |
|------------|-------------|
| **A5.1 Health includes bridge** | Probe `GET`/`OPTIONS` or lightweight ping when `OLIVE_STUDIO_API_URL` set |
| **A5.2 Partial UIState examples** | Tool descriptions include minimal valid partials for common agent edits |
| **A5.3 Error taxonomy docs** | `studio_unavailable` / `invalid_ui_state` / `invalid_bridge_response` in README agent section |
| **A5.4 EP hints caching** | Document refresh semantics; avoid hammering Studio probe |

### 4.7 Workstream A6 — Testing & quality bar (**P0–P1**)

| Initiative | Description |
|------------|-------------|
| **A6.1 Keep pytest green** | Non-negotiable regression floor (baseline observed: 394 passed) |
| **A6.2 Cold-start benchmarks** | pytest markers or script: cold vs warm timings for keyword vs semantic |
| **A6.3 Contract tests for tool list** | Assert tool count (or versioned set) + required names for agents |
| **A6.4 Chaos: missing Studio URL** | Already covered—expand for timeout/degraded semantic |
| **A6.5 No live Olive in CI** | Preserve “no Execute Live” invariant |

---

## 5. Track B — Intentional mcporter (+ agent) integration

### 5.1 Principles

1. **Studio product runtime stays direct** (`/api/mcp/*` → olive-mcp-server). **Do not** put mcporter on the Express hot path.
2. **mcporter is a supported client**, same as Claude Desktop / Cursor / Grok native MCP.
3. **One olive definition**, three config surfaces kept in sync:
   - `.mcp.json` (IDE agents)
   - `config/mcporter.json` (CLI / mcporter project)
   - optional home `~\.mcporter\mcporter.json` (personal tools only—not olive)
4. **Warm process is part of the contract**, not an advanced tip buried in a footnote.

### 5.2 Architecture (target)

```text
┌─────────────────────────────────────────────────────────────┐
│                     Olive Studio (product)                  │
│  UI / AI sidebar ──► Express /api/mcp/* ──► olive-mcp-server│
│                         ▲ loopback                          │
│                         │ studio-recipe / EP hints          │
└─────────────────────────┼───────────────────────────────────┘
                          │ OLIVE_STUDIO_API_URL (loopback)
┌─────────────────────────┼───────────────────────────────────┐
│              olive-mcp-server (single source of tools)      │
│   catalog │ strategy │ troubleshoot │ bridge │ feedback     │
└───────────┬─────────────────────────┬───────────────────────┘
            │ stdio (warm preferred)  │ stdio / native MCP
            ▼                         ▼
   ┌────────────────┐        ┌────────────────────┐
   │    mcporter    │        │ Claude/Cursor/Grok │
   │ list/call/auth │        │ .mcp.json hosts    │
   │ daemon/serve   │        └────────────────────┘
   └────────────────┘
            │
            ▼
   CI smoke · scripts · Hermes-style agents
```

### 5.3 Workstream B1 — Config as product (**P0**)

| Deliverable | Detail |
|-------------|--------|
| **B1.1 Project `config/mcporter.json`** | Only `olive`; `command` = venv Python; `args` = `olive-mcp-server/run.py`; `cwd` = repo root; optional `env` for Studio URL |
| **B1.2 Align `.mcp.json`** | Same launch story (venv or documented bootstrap) |
| **B1.3 Env template** | `.env.example` keys: `OLIVE_STUDIO_API_URL`, `OLIVE_MCP_SEMANTIC`, `OLIVE_MCP_PRELOAD_EMBEDDINGS`, `OLIVE_MCP_FEEDBACK_PATH` |
| **B1.4 Gitignore policy** | Keep machine-local mcporter imports gitignored; commit a **template** `config/mcporter.example.json` if needed |
| **B1.5 Global vs project** | Document: personal tools → `~\.mcporter`; olive → **project only** (repo-relative paths) |

**Example target project entry (illustrative):**

```json
{
  "mcpServers": {
    "olive": {
      "command": "olive-mcp-server/.venv/Scripts/python.exe",
      "args": ["olive-mcp-server/run.py"],
      "cwd": ".",
      "env": {
        "OLIVE_STUDIO_API_URL": "${OLIVE_STUDIO_API_URL:-http://127.0.0.1:3000}",
        "OLIVE_MCP_PRELOAD_EMBEDDINGS": "${OLIVE_MCP_PRELOAD_EMBEDDINGS:-0}"
      }
    }
  }
}
```

Cross-platform: ship a small `run-olive-mcp` script that selects the venv path, referenced by both `.mcp.json` and mcporter.

### 5.4 Workstream B2 — Warm client path (**P0**)

| Deliverable | Detail |
|-------------|--------|
| **B2.1 Document `mcporter daemon`** | Start/status/stop for Olive long sessions |
| **B2.2 Prefer session reuse** | Agent skills: “list once, many calls; don’t respawn per tool if host allows” |
| **B2.3 Optional `mcporter serve`** | Expose olive-only façade for multi-agent gateways |
| **B2.4 Timeouts** | Skill/docs: catalog 15s; semantic 120s first call if enabled; keyword default under 10s |

### 5.5 Workstream B3 — Smoke, CI, and “agent definition of done” (**P0–P1**)

| Deliverable | Detail |
|-------------|--------|
| **B3.1 `pnpm mcp:agent-smoke`** | `mcporter list olive --status` + 3 safe calls: `get_olive_passes`, `get_pass_chain`, `get_integration_recipe` |
| **B3.2 Optional semantic smoke** | Nightly or manual: troubleshoot with long timeout after preload |
| **B3.3 Bridge smoke** | With Studio up: `validate_ui_state_recipe` minimal partial → not `studio_unavailable` |
| **B3.4 CI gate** | Lightweight job (no Olive GPU): pytest + agent-smoke without semantic |
| **B3.5 Grade dashboard (optional)** | Record cold/warm timings in CI artifacts |

### 5.6 Workstream B4 — Docs & skills (**P1**)

| Deliverable | Detail |
|-------------|--------|
| **B4.1 AGENTS.md section** | “Using Olive MCP from coding agents (mcporter)” |
| **B4.2 olive-mcp README “Agent clients”** | Studio vs mcporter vs native MCP table |
| **B4.3 Grok/Hermes skill update** | Point at project config, daemon, safe tools, no live Olive |
| **B4.4 Call cookbook** | Copy-paste: strategy, chain validate, troubleshoot keyword, bridge validate |
| **B4.5 Anti-patterns** | Don’t put secrets in project config; don’t route Studio UI through mcporter; don’t Execute Live from agents |

### 5.7 Workstream B5 — Studio product surfaces that help agents (without embedding mcporter) (**P1–P2**)

| Deliverable | Detail |
|-------------|--------|
| **B5.1 Dev → MCP status panel** | Reuse `/api/mcp/kb-status` + tool probe; show bridge readiness |
| **B5.2 “Copy agent setup”** | Button copies `.mcp.json` snippet + env vars |
| **B5.3 Assistant uses Studio path** | Keep Gemini/sidebar on `/api/mcp/tool` (rate limit + breaker) |
| **B5.4 Optional deep-link** | Docs page: “Open Studio so MCP bridge tools work” |

**Explicit non-goals for Studio:**

- Shelling out to `npx mcporter` on every chat turn
- Replacing the Python proxy with mcporter in Express
- Bundling mcporter as a required runtime dependency for end users

### 5.8 Workstream B6 — Advanced mcporter use (**P2**)

| Deliverable | Detail |
|-------------|--------|
| **B6.1 `generate-cli`** | Document `mcporter generate-cli --server olive` for recipe automation scripts |
| **B6.2 `emit-ts`** | Typed client for TypeScript agent harnesses in-repo |
| **B6.3 Record/replay** | Capture golden MCP sessions for regression demos |
| **B6.4 OAuth N/A** | Olive is local stdio—document “no auth”; contrast with github/notion in home mcporter |

---

## 6. Unified roadmap

### Phase 0 — Stabilize agent path (1–2 days)

- Venv-aware launch script + align `.mcp.json` / `config/mcporter.json`
- README/AGENTS agent section + smoke script
- Keyword-default or timeout-degraded path for troubleshoot if semantic load is slow

**Exit:** `pnpm mcp:agent-smoke` green on a clean clone after venv setup.

### Phase 1 — A-grade responsiveness (1–2 weeks)

- Tiered semantic; health tool; preload env; cold/warm benchmarks
- Optional `[semantic]` extra
- Bridge health in `get_mcp_health`
- CI: pytest + agent-smoke

**Exit:** Catalog tools cold &lt; 2s; keyword troubleshoot cold &lt; 2s; semantic warm &lt; 2s; no 60s false offline for defaults.

### Phase 2 — Platform polish (2–4 weeks)

- KB refresh automation; pass availability CI; Studio MCP status panel; copy agent setup
- Docker slim vs semantic tags
- Daemon/serve docs; generate-cli cookbook
- Version `0.2.0`

**Exit:** External agents and Studio assistant share one narrative; grade self-assessment **A−/A**.

### Phase 3 — Ecosystem (backlog)

- Typed TS client in monorepo; record/replay goldens
- Multi-agent `mcporter serve` profiles
- Possible MCP Apps/widgets later (out of scope for core pitch)

---

## 7. Success metrics

| Metric | Baseline (observed) | Target |
|--------|---------------------|--------|
| pytest | 394 passed | ≥394, no drop |
| `list olive` | ~3s healthy | &lt;3s |
| Catalog tool via mcporter | Works | p95 &lt; 2s |
| Troubleshoot via mcporter (default) | Timeout 60–180s | p95 &lt; 2s keyword path |
| Troubleshoot semantic warm | ~N/A under mcporter | p95 &lt; 2s after preload |
| Studio bridge without Studio | Clear error | Keep + health exposes config |
| Agent smoke in CI | Informal | Required on PR |
| Docs “two clients” clarity | Fragmented | Single canonical section |
| Overall quality grade | **B+** | **A−** then **A** |

---

## 8. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Splitting Studio vs mcporter confuses users | One architecture diagram; “product vs agent client” table |
| Semantic quality drop if keyword default | Hybrid ranking; opt-in semantic; tests for both |
| Venv paths differ Windows/Linux | Thin `run.py` / `run-olive-mcp` launcher |
| Scope creep into “run Olive from MCP” | Explicit non-goal; Studio Execute Live remains UI/API only |
| mcporter version skew | Pin docs to `npx mcporter@…` or package script |
| Embedding license/size in Docker | Slim image without model; semantic tag optional |

---

## 9. Investment & returns

### Cost (rough)

- **Phase 0:** low (config, docs, smoke)—hours to a day
- **Phase 1:** medium (server behavior + tests)—days to two weeks
- **Phase 2:** medium (UX/docs/CI polish)—parallelizable

### Return

- **Agents stop treating Olive MCP as flaky** → more real usage of passes/strategies/troubleshoot
- **Studio stays clean** → no mcporter on the hot path
- **One server, many clients** → less duplicated “how do I call olive?” knowledge
- **Differentiation** → most model-optimization MCP servers are thin; Olive MCP becomes the **reliable** specialist

---

## 10. Recommendation (ask)

**Approve a dual-track program:**

1. **Server:** tiered semantic + health + cold-start SLOs (Track A P0/P1).
2. **Clients:** intentional mcporter/agent packaging—venv launch, smoke, docs, daemon—without putting mcporter inside Studio Express (Track B P0/P1).

**Do not approve:** replacing `/api/mcp/tool` with mcporter, or requiring end users to install mcporter to use Olive Studio.

**First ship target:** Phase 0 + health/keyword-default from Phase 1—enough to turn observed **B+** into a credible **A−** for agent-facing reliability while preserving the strong domain and test base.

---

## 11. Appendix — Tool map (for prioritization)

| Category | Tools | Agent priority | Cold-start sensitivity |
|----------|--------|----------------|-------------------------|
| Catalog | `get_olive_passes`, `get_pass_parameters`, `get_pass_config_template`, `get_pass_chain`, `get_integration_recipe` | P0 | Low |
| Strategy | `get_quantization_strategy`, `get_hardware_optimization_guide`, `evaluate_optimization_tradeoff`, `get_model_compatibility`, `get_cli_command`, `get_data_config_template` | P0 | Low |
| Troubleshoot / search | `troubleshoot_olive_error`, `diagnose_error`, `get_error_frequency_summary`, `search_olive_documentation`, `get_context_for_pipeline` | P0 | **High** (today) |
| Studio bridge | `validate_ui_state_recipe`, `get_recipe_for_ui_state`, `get_runtime_ep_hints` | P1 (when Studio up) | Low (network) |
| Feedback | `record_troubleshoot_feedback` | P2 | Low |
| Proposed | `get_mcp_health` | P0 | Low |

---

## 12. Closing

Olive MCP already has the hard part: **domain truth and tests**. The pitch is not “rebuild the server.” It is:

> **Make the same server feel production-grade to every client that matters—Studio via HTTP, and the agent ecosystem via mcporter and native MCP—by fixing process lifecycle, defaults, config, and the documented contract between them.**

That is how Olive Studio’s optional MCP grows from a solid B+ specialist into the **default agent control plane for Microsoft Olive workflows**.

---

## Related

- MCP server: `olive-mcp-server/`
- Studio MCP routes: `src/server/routes/mcp.ts`
- Agent registration: `.mcp.json`
- Project mcporter (local, gitignored): `config/mcporter.json`
- Prior plan notes: `docs/mcp-validation-kb-feedback.plan.md`
