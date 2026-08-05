# Olive Studio Roadmap

Consolidated release targets. Sources: `ORIGINAL_REQUEST.md` (R1-R7), `OLIVE_MCP_PROMPT_FOR_DEVELOPER.md` (4-phase MCP plan), `olive-mcp-server/README.md`, `CHANGELOG.md`.

---

## v0.1.0 (shipped 2026-07-01)

- [x] Initial scaffold: React + Vite + Express monolith
- [x] Recipe builder UI with pass catalog
- [x] Pipeline validation (schema engine, pass chain rules)
- [x] Basic Tauri shell integration

## v0.2.0 (shipped 2026-07-25)

- [x] R1: Real Olive backend — venv auto-creation, olive-ai install, SSE log streaming
- [x] R2: Batch execution — job registry, SIGTERM→SIGKILL cancellation escalation
- [x] R3: Execute Live wiring — real-time output in ExecutionWorkspace
- [x] R4: Gemini API key fix — header-based auth
- [x] R5: File reconstruction — server modularization (6 route modules)
- [x] R6: Caching switch — distributed caching toggle
- [x] R7: PerformanceMetrics — GPU metrics bar, VRAM estimation
- [x] 14+ AI providers (Direct, Routers, Subscriptions, Custom/Local)
- [x] Hardware validation & autofix (CPU, CUDA, TensorRT, ROCm, OpenVINO, QNN, DirectML)
- [x] MCP server: 14 tools, 84 passes, 14 hardware profiles, 20 troubleshooting entries
- [x] 74 parameter validation tests, MIT license

## v0.3.0 (current target)

### Infrastructure & Quality

- [x] CI hardening: all test tiers in CI (server, integration, component, pytest)
- [x] Component test coverage >= 60% of features/
- [x] AGENTS.md restructure (project-first, generic reference extracted)
- [x] .mcp.json portability fix (relative path, multi-agent compatible)
- [x] KB auto-update workflow (weekly scheduled GitHub Action)
- [x] ROADMAP.md consolidation (this file)

### MCP Server

- [ ] Add deployment docs (Docker / serverless)
- [ ] Expand compatibility matrix with more models
- [ ] Olive version tracking (0.2.0 → current support)

### Product

- [ ] Recipe import from olive-recipes catalog (full GitHub lazy-load + version pinning; basic catalog browsing shipped in v0.2.0)
- [ ] Multi-model batch comparison view
- [ ] Export optimization report (PDF/Markdown)

## Backlog / v0.4+

- [ ] Tauri production packaging — NSIS/MSI installer (experimental, see criteria below)
- [ ] MultiLoRA adapter support — multiple adapters per base model (experimental, see criteria below)
- [ ] Cloud sync for recipe presets
- [ ] Collaborative recipe sharing (GitHub Gist export)
- [ ] ONNX Runtime WebGPU inference preview

### Experimental Feature Graduation Criteria

#### Tauri Desktop App

**Risks / unknowns:**

- NSIS/MSI code-signing requires a paid certificate; unsigned builds trigger SmartScreen warnings
- Auto-update mechanism (tauri-updater) needs a stable hosting endpoint for update manifests
- Binary size (~80 MB) vs. web-only deployment; CI must produce signed artifacts
- WebView2 runtime availability on older Windows 10 LTSC images

**Graduation criteria (all must be true):**

- [ ] Signed installer (EV or OV cert) passes SmartScreen without warnings
- [ ] Auto-update flow tested end-to-end (staged rollout → download → restart)
- [ ] CI produces installer artifacts on every tagged release
- [ ] Cold-start time ≤ 3 s on a 4 GB RAM VM (Windows 10 LTSC)

**Re-evaluate:** after v0.3.0 ships (target 2026-08-15)

#### MultiLoRA Adapter Support

**Risks / unknowns:**

- Olive `OrtTransformersOptimization` pass has limited multi-adapter graph fusion support
- VRAM contention when loading >2 adapters simultaneously on consumer GPUs (≤ 12 GB)
- No upstream Olive test coverage for adapter switching at inference time
- Recipe schema must express adapter-to-slot mapping without breaking existing single-adapter recipes

**Graduation criteria (all must be true):**

- [ ] Olive ≥ 0.3.0 documents multi-adapter optimization as a supported pass configuration
- [ ] End-to-end test: 2 adapters loaded, switched at runtime, correct output on ONNX Runtime 1.21+
- [ ] VRAM budget stays within 110% of single-adapter baseline for 2-adapter config
- [ ] Recipe schema extension reviewed and backward-compatible with v0.2.0 recipes

**Re-evaluate:** after Olive 0.3.0 release (track microsoft/Olive#releases)

---

## Status legend

| Symbol | Meaning               |
| ------ | --------------------- |
| `[x]`  | Shipped / complete    |
| `[ ]`  | Planned / in progress |
