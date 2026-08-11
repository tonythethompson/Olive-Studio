# Olive Studio Roadmap

---

## Architecture posture (agent / MCP)

Decisions against the "start fresh" critique. Outcomes we want; rewrites we do not.

| Theme                                                                 | Disposition | Roadmap treatment                                                                                                                                                              |
| --------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MCP as optimization agent (observe → reason → multi-step fix → retry) | **Done**    | Shipped in v0.3. Studio-mediated loop: tools call Studio's job API; MCP never launches Olive. Studio owns policy and execution.                                                |
| `UIState.passes` as a discriminated union                             | **Park**    | Typed accessors (`passAccessors.ts`) stay the approach. Full union migration stays Tech Debt; not scheduled for v0.4-v0.5. Revisit only if flat-bag TypeScript pain dominates. |
| Persistent MCP stdio (vs per-call spawn)                              | **Done**    | Shipped in v0.2. No further roadmap item.                                                                                                                                      |
| Assistant sidebar as the sole agent UI                                | **Modify**  | Ship Execute Agent mode in v0.5. Later: shared proposed-actions / tool-approval path so Assistant and Agent mode use the same tools. Do not make chat the only agent shell.    |

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
- MCP agent platform Phases 0–3: persistent client, capabilities, retrieval modes, read-only job visibility, validation/preflight, idempotent submit/cancel

---

## v0.3 (shipped)

### olive-ai 0.13.0 upgrade

- [x] Pass catalog: 8 new passes (MobiusBuilder, QairtPipeline, KQuant, OnnxKquantQuantization, QuantizeEmbeddingInt8, ShareEmbeddingLmHead, SimplifiedLayerNormToRMSNorm, OnnxDiscrepancyCheck)
- [x] KQuant quantization method added to recipe builder, type unions, and validation allowlists
- [x] `trust_remote_code` default-flip handled: emit `true` only after explicit Hugging Face user opt-in + info advisory
- [x] Pipeline validation: CROSS_PASS_RULES for QNN-only passes, QnnAbiExecutionProvider as distinct EP
- [x] Migration module (`passMigration.ts`): MobiusModelBuilder rename, QairtPreparation/QairtGenAIBuilder removal, pipelineStore integration
- [x] Removed-pass advisory warnings and removed-pass detection in recipe overrides
- [x] MCP knowledge base: passes.json, compatibility_matrix.json, hardware_profiles.json, troubleshooting.json updated for 0.13.0
- [x] Venv spec pinned to `olive-ai==0.13.0` (spec version 5)

### Agent autonomy tools (MCP Phase 3)

Studio-mediated loop — five tools that close observe → plan → diagnose → retry:

- [x] `plan_optimization` — intent + hardware probe → complete UIState patch with reasoning
- [x] `execute_and_observe` — submit via Studio job API, poll until completion, return structured outcome
- [x] `diagnose_and_fix` — error text + current recipe → diagnosis + fixed recipe for retry
- [x] `compare_results` — 2+ job results → structured comparison with recommendation
- [x] `get_model_info` — HuggingFace model ID → params, architecture, VRAM estimate (HF API with regex fallback)

### Performance

- [x] Client bundle reduced 37.9% (−1007 KB): tree-shaking, code splitting, dead-code elimination
- [x] Bundle phase 2: externalize typegpu, lazy MCP card, consolidate formatBytes (−293 KB)

### Chore

- [x] fast-check 3.23 → 4.9, motion 12.43 → 13.0

---

## v0.4 (in progress)

### Validation & test hardening

Complete the olive-ai 0.13.0 verification gap (spec tasks 9.5, 11, 12):

- [ ] Pipeline validation unit tests for new CROSS_PASS_RULES (QairtPipeline, SimplifiedLayerNormToRMSNorm, kquant EP constraints, removed-pass warnings, trust_remote_code advisory)
- [ ] Integration test fixtures: MobiusModelBuilder migration, QairtPreparation/QairtGenAIBuilder removal, trust_remote_code emission
- [ ] Recipe validation smoke test pass (`pnpm validate:recipe` green)
- [ ] Final checkpoint sweep: zero `0.12.1` references in source, lint clean, all test tiers green

### Agent loop state

- [ ] Attempt / session context for agent loops (last recipe, last failure, attempt history) owned by MCP session or Studio job metadata — enough for multi-step retry without turning MCP into the UI controller

### Quality

- [ ] GraphCanvas SVG dedup (#150)

---

## v0.5.0 (next)

### Unified Assistant (Audit + Chat)

Combine the visible Audit and Chat tabs into one Assistant experience while keeping Settings and Execute Agent mode separate.

- [ ] Pin a collapsible Pipeline Review in Assistant with score, findings, evidence, last-checked state, and conversation beneath it
- [ ] Replace Audit-only `{ pass, value }` autofixes with a shared finding/action contract (`applyPatch`, `navigate`, `explain`, `documentation`)
- [ ] Every reported deficiency must retain a useful next action even when no safe one-click patch exists; never show a negative finding beside "No actionable changes"
- [ ] Give review and chat the same MCP knowledge and validated UI-patch schema, with bounded targeted retrieval for automatic review and broader retrieval for user questions
- [ ] Applying an Assistant action re-runs the review; bind results to a workspace fingerprint so stale findings cannot overwrite newer state
- [ ] Keep deterministic recipe validation authoritative and keep automatic review refreshes out of chat history

### Agent UI (Execute panel)

Manual vs Agent on Execute first; Assistant stays chat until the later bridge.

- [ ] Agent mode toggle in Execute panel (Manual vs Agent)
- [ ] Agent activity log (reasoning, attempts, decisions in real-time)
- [ ] Multi-model batch comparison view (frontend for `compare_results`)

### Product

- [ ] Export optimization report (PDF/Markdown)
- [ ] Recipe catalog version pinning
- [ ] MultiLoRA adapter support: Olive 0.13.0 supports single-adapter `HfModel.adapter_path` and `ExtractAdapters`; multi-adapter switching is an ONNX Runtime GenAI runtime concern, not an Olive `adapters[]` pass configuration. **Blocked** on Studio builder/runtime integration and end-to-end validation. See `docs/multilora-design.md`.

### Distribution

- [ ] MCP Docker deployment docs (user-facing guide)
- [ ] PyPI publish of `olive-mcp-server` as standalone package
- [ ] Tauri signed installer (requires code signing cert)

---

## v0.6 (later)

### Assistant ↔ agent bridge

Converge Assistant and Execute Agent mode on one action path. Do not replace Execute Agent mode with chat-only.

- [ ] Shared proposed-actions model (MCP tool call + user approve) used by Assistant and Agent mode
- [ ] Assistant can invoke the same autonomy tools as Agent mode (`plan_optimization`, `diagnose_and_fix`, `execute_and_observe`, …)
- [ ] Audit surfaces proactive agent findings on that path (not a permanent parallel "mode" forever inventing JSON patches)

---

## Backlog

- [ ] Cloud sync for recipe presets
- [ ] Collaborative recipe sharing (GitHub Gist export)
- [ ] ONNX Runtime WebGPU inference preview
- [ ] Expand compatibility matrix with more models
- [ ] Olive version tracking (support matrix for multiple Olive releases)
- [ ] *(parked)* `UIState.passes` discriminated union: Tech Debt #11; accessors only unless DX pain forces migration

---

## Status legend

| Symbol | Meaning               |
| ------ | --------------------- |
| `[x]`  | Shipped               |
| `[ ]`  | Planned / in progress |
