# Pitch: Elevate Olive MCP — Server Quality, mcporter Clients, and Studio-Mediated Job Control

**Working title:** Olive MCP as agent intelligence/configuration today; **agent-facing control of Studio** when job APIs are connected  
**Audience:** Olive Studio maintainers, MCP consumers, agent-tooling stakeholders  
**Status:** Proposal — Phases 0–3 **code complete** on branch `MCP_harden`; **CI / end-to-end verification still pending** (do not treat as fully signed-off until the matrix is green)  
**Date:** 2026-08-07  
**Calibration:** Architecture **~9/10**; near-term plan **~8/10** → proceed. End-state job loop raises product value without a second executor.

### Review disposition (summary)

| Decision | Adopt |
|----------|--------|
| Studio `/api/mcp/*` stays product path; mcporter is supported client only | Yes |
| Failure mode = process-per-call + embeddings, not weak domain quality | Yes |
| Do not rebuild domain server; do not MCP→olive CLI | Yes |
| `auto \| keyword \| semantic`; precomputed KB index; `get_mcp_capabilities` | Yes |
| Launcher P0; split latencies; mcporter canary CI; trim Docker/gen-cli early | Yes |
| Permanent “MCP never runs jobs” | **Replace** with Studio-mediated contract (below) |
| Idempotency on submit | **Mandatory** |
| `dry_run` on submit | **No** — use separate `validate_*` |
| Job policy | **Studio-owned** (settings); env only for dev/CI override |
| Job tool rollout | Read-only → validate → submit/cancel |

---

## 1. Executive summary

Olive MCP (`olive-mcp-server`) is a **domain-rich specialized advisor**. Agent flakiness is mostly **lifecycle and config**, not thin domain knowledge.

**Near-term thesis:** Keep the domain-rich server; make process lifecycle and configuration predictable; expose it cleanly to Studio and external agents (mcporter / native MCP).

**End-state thesis:** Standalone MCP remains an **expert advisor**. MCP **connected to Studio** becomes an **agent-facing control plane for Studio operations**—submit, monitor, diagnose, retry, cancel—**only** by calling Studio’s job API. MCP never launches Olive itself.

### Architectural contract (replace permanent “no execution”)

> **MCP never executes Olive directly.**  
> Real jobs may only be submitted through **Olive Studio’s controlled job-execution API**.  
> **Standalone MCP remains advisory-only.**

That preserves v0/CI safety while removing an artificial product ceiling.

```text
Agent
  → MCP tools
    → Studio policy + API          ← Studio is authoritative
      → job registry / runtime manager
        → Olive
```

**Not this (second executor):**

```text
Agent → MCP → olive CLI / subprocess → Olive
```

---

## 2. Planes of authority

| Surface | Role |
|---------|------|
| **Standalone Olive MCP** | **Intelligence / configuration** — advise, troubleshoot, local templates; no jobs |
| **MCP + Studio (bridge only)** | Configuration projection/validation (`validate_ui_state_recipe`, etc.) |
| **MCP + Studio (job control)** | **Agent-facing control of Studio** — inspect/submit/cancel jobs via Studio API |
| **Olive Studio** | **Authoritative operations plane** — policy, preflight, registry, runtime, logs, artifacts |

Use “control plane” for **MCP + Studio with job tools enabled**, not for standalone MCP.

---

## 3. Near-term problem (Phases 0–1)

| Works | Hurts agents |
|--------|----------------|
| Domain depth, tests, structured errors | Cold stdio + embedding load → timeouts |
| Loopback bridge design | Bare `python` → wrong env |
| | Dual client story under-documented |

Fix lifecycle/packaging/contracts first. **Do not** add job submission until the advisory path is reliable.

---

## 4. Track A — Server reliability (Phases 0–1)

### 4.1 Principles

1. Retrieval **`mode = auto | keyword | semantic`** (default `auto`: use semantic when ready; keyword if unavailable; keyword + `degraded: true` if over budget; explicit `semantic` waits).
2. **Precomputed KB document embeddings** at CI/release; runtime loads index + embeds query.
3. Never block catalog tools on embeddings.
4. **MCP never executes Olive directly** (jobs only later, via Studio).
5. Early scope **excludes:** Docker, generate-cli/emit-ts/serve, broad JSON-envelope rewrite, Studio agent-settings UI (except later job policy).

### 4.2 `get_mcp_capabilities`

Not process health (client owns transport status). Returns e.g.:

```text
server.version, kb.version, kb.index.version
semantic.available | ready | model
retrieval.default_mode
studio.configured | studio.reachable
toolset.version
job_control.supported | enabled | ready | reason   # see §6 (later; stub false until built)
```

### 4.3 Testing & benchmarks

- Suite green + new coverage; **no “≥N tests” KPI**.
- Contract = versioned required tool names/schemas.
- Always split: **tool execution latency** vs **ephemeral-client E2E**.

---

## 5. Track B — Clients (Phases 0–1)

1. Studio `/api/mcp/*` unchanged for product assistant — **never** shell out to mcporter per chat turn.
2. **One deterministic launcher** (venv) shared by `.mcp.json` and project mcporter config.
3. Smoke: **required** native contract; **canary** pinned mcporter.
4. Minimal docs: two clients; planes of authority; capabilities vs status.

---

## 6. End-state: Studio-mediated job control (Phases 2–3+)

### 6.1 Why

Agents fit Olive’s multi-step loop: inspect → strategy → recipe → **run** → fail → troubleshoot → adjust → **rerun**. Stopping at recipe JSON underuses the KB investment.

### 6.2 Tool surface (domain-shaped, not a shell)

| Tool | Side effect | Role |
|------|-------------|------|
| `list_optimization_jobs` | No | Inspect |
| `get_optimization_job` | No | Progress / state |
| `get_optimization_results` | No | Metadata, paths, metrics, log tail — **not** model bytes |
| `validate_optimization_job` | No | Normalized recipe, preflight, **fingerprint**, warnings |
| `submit_optimization_job` | **Yes** | Queue job; returns quickly |
| `cancel_optimization_job` | **Yes** | Cancel via Studio |

**Do not expose:** `execute_command`, `run_olive(args=...)`, or generic shell.

### 6.3 Explicit side-effect boundary (no `dry_run` on submit)

```text
validate_optimization_job
        → normalized recipe
          preflight status
          job fingerprint
          warnings
        → never starts Olive

submit_optimization_job
        → always means “request execution via Studio”
        → returns job_id, state=queued, fingerprint, submitted_at
        → completes in seconds, not minutes
```

`validate_*` cannot execute. `submit_*` always means execute (subject to Studio policy). Cleaner for agents and humans than `submit(..., dry_run=true)`.

### 6.4 Idempotency is mandatory

Agent retries are normal. `submit_optimization_job` **must** accept an **idempotency key** and/or reuse the **job fingerprint** from validate. Studio **must** guarantee replaying the same submission does not start a second optimization.

Idempotency matters more than rate limiting for avoiding duplicate GPU work (rate limits remain useful as a backstop).

**Current Studio behavior (MCP-origin only):** `findJobByIdempotency` reuses the prior MCP job for the same key and/or fingerprint while that job remains in the process registry for **in-progress** and **completed** states. **Failed** / **cancelled** indexed jobs are treated as a miss so agents can retry. Callers that need a **new** run after a successful completed job must supply a **new idempotency key** (and typically a changed recipe fingerprint). UI submissions are never entered into this index.

### 6.5 Long-running jobs and artifacts

- **Submit** returns in seconds with `job_id` / `queued`.
- **Poll** `get_optimization_job` for structured progress.
- MCP must **never** hold a transport call open for an entire optimization.
- **Results** return status, output path/reference, metrics, passes, EP, duration, warnings, structured failure, log tail/reference, artifact **metadata** — not ONNX blobs or multi‑GB logs.
- **`artifact_path_refs` privacy (default):** `get_optimization_results` scrapes heuristic path tokens from log lines (up to 20) and returns **basenames** (or already-relative forms) by default. Absolute paths and local account segments (`/home/<user>/...`, `C:\Users\<name>\...`, `/Users/<name>/...`) are **not** included in `artifact_path_refs` or `log_tail` unless both are true: tool arg `include_absolute_artifact_paths=true` **and** local MCP host env `OLIVE_MCP_ALLOW_ABSOLUTE_ARTIFACT_PATHS=1`. Response field `artifact_paths_absolute` reports whether full paths were actually returned. References only (no file bytes).

### 6.6 Capability model (richer than bool)

```json
{
  "job_control": {
    "supported": true,
    "enabled": true,
    "ready": false,
    "reason": "runtime_preflight_required"
  }
}
```

Distinct agent-visible conditions include:

| Condition | Example `reason` |
|-----------|------------------|
| Studio not connected | `studio_unavailable` |
| Execution administratively disabled | `job_submission_disabled` |
| Inspection allowed, submit not | `submit_disabled` |
| Studio up, runtime not ready | `runtime_preflight_required` |
| Ready | `ready` / `ready: true` |
| Incompatible job already active | `job_conflict` |

Agents branch on these instead of treating every failure as `studio_unavailable`.

### 6.7 Authorization: Studio owns policy

Product policy lives in Studio (Agent Access UI / `GET|PUT /api/olive/agent-access`). MCP **receives** effective capabilities from Studio. Preflight (env, provider, paths, disk, model existence, concurrent jobs) stays Studio’s existing job path.

**Dev/CI env overrides (not the long-term user model):**

| Variable | Behavior |
| -------- | -------- |
| `OLIVE_MCP_ALLOW_JOBS` | **Escalate-only.** Truthy (`1`/`true`/`yes`/`on`) forces effective **submit + cancel** on. Falsy values (`0`/`false`) are a **no-op** (they do not force submission off). While set, effective policy from `getAgentAccessPublic` / PUT responses reflects the override even if disk UI toggles remain off. Disk writes from the UI are preserved; the env wins at resolve time. |
| `OLIVE_MCP_ALLOW_JOB_INSPECTION` | Two-sided: falsy forces inspection off; truthy forces on. |
| `OLIVE_MCP_ACCESS` | Falsy forces master MCP access off. |

Prefer the Agent Access UI for product defaults. Do not rely on `OLIVE_MCP_ALLOW_JOBS=0` to disable submit in production; turn the UI toggles off (and unset the escalate env).

**Product policy UI sketch:**

```text
Settings → Developer / Agent Access
  MCP access                 [on]
  Allow job inspection       [on]
  Allow recipe changes       [on]
  Allow job submission       [off]
  Allow job cancellation     [off]
```

### 6.8 Incremental rollout (prefer this order)

```text
Stage 1 — Read-only job visibility
  list_optimization_jobs
  get_optimization_job
  get_optimization_results

Stage 2 — Validation / preflight
  validate_optimization_job  (+ fingerprint)

Stage 3 — Write authority (capability-gated)
  submit_optimization_job    (+ idempotency)
  cancel_optimization_job

Later — Full agent loops
  diagnose → modify recipe → validate → submit → poll → retry
```

**Stage 1 value immediately:** agent inspects a job the user started in Studio, uses troubleshooting KB, explains failure — **zero mutate**.

---

## 7. Unified roadmap

### Phase 0 — Reliable advisory MCP (minimal)

```text
Deterministic launcher
  → .mcp.json + mcporter share launcher
  → native MCP + pinned mcporter smoke
  → benchmark cold/warm (tool vs E2E)
  → get_mcp_capabilities (job_control.supported=false stub OK)
  → semantic timeout → graceful degraded fallback under auto
```

### Phase 1 — Fast retrieval ✅ (branch `MCP_harden`)

```text
precomputed KB index          → knowledge_base/indexes/ + pnpm mcp:build-index
mode = auto | keyword | semantic
preload/warm path             → OLIVE_MCP_PRELOAD_EMBEDDINGS=1
cold/warm SLO tests           → test_index_store + mcp:benchmark
studio.configured / reachable → get_mcp_capabilities
```

### Phase 2 — Read-only Studio job visibility ✅ (branch `MCP_harden`)

- Stage 1 job tools: `list_optimization_jobs`, `get_optimization_job`, `get_optimization_results`
- Studio: `GET /api/olive/jobs` + `finishedAt` on status
- **Inspection policy (implemented):** `allowJobInspection` gates **list** (`GET /api/olive/jobs`) and the dedicated agent routes `GET /api/olive/agent/status/:jobId` and `GET /api/olive/agent/stream/:jobId`. When `allowJobSubmission` is on but inspection is off, agents may still list/poll **MCP-origin** jobs only (submit lifecycle). Studio UI uses `/api/olive/status`, `/api/olive/stream`, and `POST /api/olive/cancel` without agent policy and without `studioLocalOnly` (same trust as `/olive/run` for LAN/hostname browsers), but those UI routes only serve **non-MCP** jobs so agent policy cannot be bypassed by hitting the Execute paths with an MCP job id. MCP job tools call the `/agent/*` paths (loopback + policy). Cancellation uses `POST /api/olive/agent/cancel` (always `allowJobCancellation`) vs UI `POST /api/olive/cancel`.
- Capabilities: `job_control.inspection=true`, `submission/cancellation=false`
- Optional product UI (Copy Agent Setup) deferred  

### Phase 2b — Validation / preflight ✅

- `validate_optimization_job` → `POST /api/olive/jobs/validate`  
- Fingerprint + structural preflight (no env install / no spawn). QNN validate runs host-mode + static HTP shape checks only; NPU/`loadable` probe remains in `startOliveJob` after the QNN venv is ready.

### Phase 3 — Capability-gated submit / cancel ✅

- Idempotent `submit_optimization_job` → `POST /api/olive/jobs/submit`  
- `cancel_optimization_job` → `POST /api/olive/agent/cancel`  
- Studio policy: `GET /api/olive/agent-access` (any Studio browser session) + `PUT` loopback-only via `studioLocalOnly` (policy mutation is privileged; LAN peers cannot flip submission/MCP switches). Env overrides e.g. `OLIVE_MCP_ALLOW_JOBS` for Dev/CI; see §6.7. 
- Shared `startOliveJob` runner for UI `/olive/run` and MCP submit  

### Later

- Agent-driven diagnose → modify → retry loops (product + prompt patterns)  
- Ecosystem parking lot: Docker, generate-cli, emit-ts, mcporter serve, record/replay  

### Explicitly not on critical path for 0–1

Docker, generated clients, broad envelope refactor, job submission.

---

## 8. Success metrics

### Phases 0–1

| Metric | Pass |
|--------|------|
| Launcher | One entry; venv; clear miss |
| No hang on `auto` | Structured response in budget |
| Tool vs E2E latency | Both tracked |
| Capabilities | Stable schema; `job_control` honest |
| Tests | Green + new coverage (not N≥394) |

### Phases 2–3 (when built)

| Metric | Pass |
|--------|------|
| Read-only jobs | List/get/results without mutate |
| Validate | Never starts Olive; returns fingerprint |
| Submit | Seconds; job_id; **idempotent replay** |
| Cancel | Via Studio only |
| Policy | Studio settings enforced; MCP cannot escalate |
| Results | Metadata only; no giant payloads |
| Transport | No MCP call spans full optimization |

---

## 9. Risks

| Risk | Mitigation |
|------|------------|
| Second executor (MCP→CLI) | Forbidden by contract |
| Duplicate GPU jobs | **Mandatory** idempotency + fingerprint |
| Ambiguous dry_run | Separate validate vs submit |
| Env-only auth forever | Studio policy UI; env = override |
| Job submit before reliability | Phases 0–1 first |
| Agent holds long RPC | Submit returns immediately; poll |
| Keyword quality | `auto`, not permanent keyword-default |
| mcporter breaks CI | Canary + pin |

---

## 10. Recommendation

**Proceed.**

1. **Implement Phases 0–1** as written (launcher, retrieval, capabilities, smokes).  
2. **Record end-state contract** now so bridge work doesn’t paint into a corner.  
3. **Phase 2:** read-only job inspection before any write tools.  
4. **Phase 2b–3:** validate, then idempotent submit/cancel with Studio-owned policy.  
5. Call **MCP + Studio (jobs enabled)** an agent-facing control plane; keep standalone MCP as intelligence/configuration only.

**Do not:** put mcporter in Express; MCP→olive subprocess; submit without idempotency; `dry_run` on submit; long-lived optimize RPC; ship model artifacts over MCP.

---

## 11. Appendix — Tool map by phase

| Phase | Tools |
|-------|--------|
| 0–1 | Existing catalog/strategy/troubleshoot/search/bridge recipe tools; `get_mcp_capabilities` |
| 2 | `list_optimization_jobs`, `get_optimization_job`, `get_optimization_results` |
| 2b | `validate_optimization_job` |
| 3 | `submit_optimization_job`, `cancel_optimization_job` |

---

## Related

- MCP server: `olive-mcp-server/`
- Studio MCP routes: `src/server/routes/mcp.ts`
- Studio olive jobs: `src/server/routes/olive.ts` (and job registry services)
- Agent registration: `.mcp.json`
- Local mcporter (often gitignored): `config/mcporter.json`
- Prior notes: `docs/mcp-validation-kb-feedback.plan.md`

## Changelog

| Date | Change |
|------|--------|
| 2026-08-07 | Initial dual-track pitch |
| 2026-08-07 | Review #1: auto mode, precomputed index, capabilities, CI canary, Docker demoted |
| 2026-08-07 | Review #2: intelligence/configuration plane; minimal Phase 0; trim ecosystem |
| 2026-08-07 | Review #3: Studio-mediated jobs end-state; no direct Olive from MCP |
| 2026-08-07 | Review #4: **mandatory idempotency**; validate≠submit (no dry_run on submit); rich `job_control`; Studio-owned policy; staged read-only→validate→write; submit returns quickly; results metadata-only; roadmap 0/1/2/2b/3/later |
