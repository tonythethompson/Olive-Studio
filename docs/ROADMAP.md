# Olive Studio Roadmap

---

## v0.1.0 (current)

Everything shipped in the first public release:

- Recipe builder UI with pass catalog and pipeline graph
- Pipeline validation — schema engine, cross-pass rules, auto-coercion
- Real Olive backend — venv auto-creation, SSE log streaming, batch execution
- 20 AI providers (Direct, Routers, Subscriptions, Custom/Local)
- Hardware validation & autofix (CPU, CUDA, TensorRT, TensorRT RTX, ROCm, OpenVINO, QNN, DirectML)
- MCP server: 27 tools, 84 passes, 22 hardware profiles
- 74 parameter validation tests, MIT license
- CI pipeline: lint → tests → build → CodeQL
- Tauri 2 desktop shell (experimental, unsigned)

---

## v0.2 (next)

### Infrastructure & Quality

- [ ] Add MCP deployment docs (Docker / serverless)
- [ ] Expand compatibility matrix with more models
- [ ] Olive version tracking (support matrix for 0.2.x → current)
- [ ] Component test coverage >= 60% of features/

### Product

- [ ] Recipe import from olive-recipes catalog (full GitHub lazy-load + version pinning)
- [ ] Multi-model batch comparison view
- [ ] Export optimization report (PDF/Markdown)

### Tech Debt

- [ ] `buildOliveRecipe` memoization cleanup
- [ ] Job log cap and trim-marker replay
- [ ] Route module splits for remaining large files

---

## Backlog / v0.3+

- [ ] Tauri production packaging — NSIS/MSI signed installer
- [ ] MultiLoRA adapter support — multiple adapters per base model
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

#### MultiLoRA Adapter Support

**Risks / unknowns:**

- Olive `OrtTransformersOptimization` pass has limited multi-adapter graph fusion support
- VRAM contention when loading >2 adapters simultaneously on consumer GPUs (≤ 12 GB)
- No upstream Olive test coverage for adapter switching at inference time
- Recipe schema must express adapter-to-slot mapping without breaking existing single-adapter recipes

**Graduation criteria (all must be true):**

- [ ] Olive documents multi-adapter optimization as a supported pass configuration
- [ ] End-to-end test: 2 adapters loaded, switched at runtime, correct output on ONNX Runtime 1.21+
- [ ] VRAM budget stays within 110% of single-adapter baseline for 2-adapter config
- [ ] Recipe schema extension reviewed and backward-compatible with v0.1.0 recipes

---

## Status legend

| Symbol | Meaning               |
| ------ | --------------------- |
| `[x]`  | Shipped / complete    |
| `[ ]`  | Planned / in progress |
