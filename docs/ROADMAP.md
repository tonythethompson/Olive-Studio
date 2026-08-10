# Olive Studio Roadmap

---

## Architecture posture (agent / MCP)

Decisions against the "start fresh" critique. Outcomes we want; rewrites we do not.

| Theme | Disposition | Roadmap treatment |
|-------|-------------|-------------------|
| MCP as optimization agent (observe → reason → multi-step fix → retry) | **Modify** | Keep the loop. MCP stays Studio-mediated: tools call Studio's job API; MCP never launches Olive. Studio owns policy and execution. |
| `UIState.passes` as a discriminated union | **Park** | Typed accessors (`passAccessors.ts`) stay the approach. Full union migration stays Tech Debt; not scheduled for v0.3-v0.4. Revisit only if flat-bag TypeScript pain dominates. |
| Persistent MCP stdio (vs per-call spawn) | **Done** | Shipped in v0.2. No further roadmap item. |
| Assistant sidebar as the sole agent UI | **Modify** | Ship Execute Agent mode first (v0.4). Later: shared proposed-actions / tool-approval path so Assistant and Agent mode use the same tools. Do not make chat the only agent shell. |

Contract (unchanged): standalone MCP is advisory; MCP connected to Studio is an agent-facing control plane for Studio operations. See `docs/proposals/olive-mcp-agent-platform.md`.

---

## v0.1.0 (shipped)

- Recipe builder UI with pass catalog and pipeline graph
- Pipeline validation: schema engine, cross-pass rules, auto-coercion
- Real Olive backend: venv auto-creation, SSE log streaming, batch execution
- 20 AI providers (Direct, Routers, Subscriptions, Custom/Local)
- Hardware validation & autofix (CPU, CUDA, TensorRT, TensorRT RTX, ROCm, OpenVINO, QNN, DirectML)
- MCP server: 27 tools, 84 passes, 22 hardware profiles
- CI pipeline: lint, tests (4 tiers), build, CodeQL, pytest
- Tauri 2 desktop shell (experimental, unsigned)
- Playground: in-browser inference, WebGPU benchmark, model Arena

---

## v0.2 (shipped)

- Persistent MCP stdio connection (<50ms warm tool calls, replaces subprocess spawn)
- Typed pass accessors (`src/lib/passAccessors.ts`): deliberate alternative to a full `UIState.passes` union
- Component splits: InputEnvironmentPanel (2200 → 241 lines), IHVIntegrationPanel (1000 → 563 lines)
- Renamed GeminiSidebar → AssistantSidebar
- Split hooks.ts into focused modules
- Security headers (helmet + CSP + Permissions-Policy)
- docs_search.py security fix
- GitHub issue triage (open count reduced)
- MCP agent platform Phases 0-3: persistent client, capabilities, retrieval modes, read-only job visibility, validation/preflight, idempotent submit/cancel

---

## v0.3 (in progress)

### Olive runtime

- [ ] Update `olive-ai` to 0.1.3 (venv pin / install path, docs, and compatibility notes)

### Agent autonomy tools (MCP)

Studio-mediated loop (not a second Olive executor). Five tools that close observe → plan → diagnose → retry:

- [ ] `execute_and_observe` — submit via Studio job API, poll until completion, return structured outcome
- [ ] `plan_optimization` — intent + hardware probe → complete UIState patch with reasoning
- [ ] `diagnose_and_fix` — error text + current recipe → diagnosis + fixed recipe for retry
- [ ] `compare_results` — 2+ job results → structured comparison with recommendation
- [ ] `get_model_info` — HuggingFace model ID → params, architecture, VRAM estimate (HF API with regex fallback)

### Agent loop state

- [ ] Attempt / session context for agent loops (last recipe, last failure, attempt history) owned by MCP session or Studio job metadata: enough for multi-step retry without turning MCP into the UI controller

### Minor quality

- [ ] GraphCanvas SVG dedup (#150)

---

## v0.4 (next)

### Agent UI (Execute panel)

Manual vs Agent on Execute first; Assistant stays chat until the later bridge.

- [ ] Agent mode toggle in Execute panel (Manual vs Agent)
- [ ] Agent activity log (reasoning, attempts, decisions in real-time)
- [ ] Multi-model batch comparison view (frontend for `compare_results`)

### Product

- [ ] Export optimization report (PDF/Markdown)
- [ ] Recipe catalog version pinning

### Distribution

- [ ] MCP Docker deployment docs (user-facing guide)
- [ ] PyPI publish of `olive-mcp-server` as standalone package
- [ ] Tauri signed installer (requires code signing cert)

---

## v0.5 (later)

### Assistant ↔ agent bridge

Converge Assistant and Execute Agent mode on one action path. Do not replace Execute Agent mode with chat-only.

- [ ] Shared proposed-actions model (MCP tool call + user approve) used by Assistant and Agent mode
- [ ] Assistant can invoke the same autonomy tools as Agent mode (`plan_optimization`, `diagnose_and_fix`, `execute_and_observe`, …)
- [ ] Audit surfaces proactive agent findings on that path (not a permanent parallel “mode” forever inventing JSON patches)

---

## Backlog

- [ ] MultiLoRA adapter support (blocked on Olive ≥ 0.3.0 upstream)
- [ ] Cloud sync for recipe presets
- [ ] Collaborative recipe sharing (GitHub Gist export)
- [ ] ONNX Runtime WebGPU inference preview
- [ ] Expand compatibility matrix with more models
- [ ] Olive version tracking (support matrix for multiple Olive releases)
- [ ] *(parked)* `UIState.passes` discriminated union: Tech Debt #11; accessors only unless DX pain forces migration

---

## Status legend

| Symbol | Meaning |
|--------|---------|
| `[x]` | Shipped |
| `[ ]` | Planned / in progress |
