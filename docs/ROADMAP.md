# Olive Studio Roadmap

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
- Typed pass accessors (`src/lib/passAccessors.ts`)
- Component splits: InputEnvironmentPanel (2200 → 241 lines), IHVIntegrationPanel (1000 → 563 lines)
- Renamed GeminiSidebar → AssistantSidebar
- Split hooks.ts into focused modules
- Security headers (helmet + CSP + Permissions-Policy)
- docs_search.py security fix
- GitHub issue triage (open count reduced)
- MCP agent platform Phases 0-3: persistent client, capabilities, retrieval modes, read-only job visibility, validation/preflight, idempotent submit/cancel

---

## v0.3 (in progress)

### Agent autonomy tools (MCP)

5 new tools that close the autonomous agent loop:

- [ ] `execute_and_observe` — submit job, poll until completion, return structured outcome
- [ ] `plan_optimization` — intent + hardware probe → complete UIState patch with reasoning
- [ ] `diagnose_and_fix` — error text + current recipe → diagnosis + fixed recipe for retry
- [ ] `compare_results` — 2+ job results → structured comparison with recommendation
- [ ] `get_model_info` — HuggingFace model ID → params, architecture, VRAM estimate (HF API with regex fallback)

### Minor quality

- [ ] GraphCanvas SVG dedup (#150)

---

## v0.4 (next)

### Agent UI

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

## Backlog

- [ ] MultiLoRA adapter support (blocked on Olive ≥ 0.3.0 upstream)
- [ ] Cloud sync for recipe presets
- [ ] Collaborative recipe sharing (GitHub Gist export)
- [ ] ONNX Runtime WebGPU inference preview
- [ ] Expand compatibility matrix with more models
- [ ] Olive version tracking (support matrix for multiple Olive releases)

---

## Status legend

| Symbol | Meaning |
|--------|---------|
| `[x]` | Shipped |
| `[ ]` | Planned / in progress |
