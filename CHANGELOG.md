# Changelog

All notable changes to Olive Studio are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/).

---

## [0.2.0] — 2026-08-09

### Added

- **Persistent MCP stdio connection** — replaces per-call subprocess spawn with long-lived JSON-RPC transport via `@modelcontextprotocol/client`. Warm tool calls now complete in <50ms (was ~500ms).
- **Typed pass accessors** (`src/lib/passAccessors.ts`) — compile-time safe narrowing for pass configuration without migrating the flat UIState shape.
- **Agent access policy** — `GET/PUT /api/olive/agent-access` with MCP-origin job filtering, submission/cancellation gating, and env overrides for CI.
- **Olive job heartbeat** — logs "still working" messages when Olive is silent for 10+ seconds, eliminating "is it hung?" confusion.
- **Pipeline state persistence** — zustand persist middleware saves UIState to localStorage (credentials stripped).
- **Recipe catalog collapse/expand** — model groups collapsed by default showing EP badges, expand on click.
- **ROCm download link** — hardware panel surfaces "Get ROCm from AMD" button when AMD GPU detected but runtime missing.

### Changed

- **AssistantSidebar** — renamed from GeminiSidebar; reorganized into `src/components/features/assistant/`.
- **Component splits** — InputEnvironmentPanel (2200 → 241 lines), IHVIntegrationPanel (1000 → 563 lines), hooks.ts split into focused modules.
- **Pre-install UX** — EP install buttons reframed as "Pre-install" with green (hardware-compatible) vs neutral (cross-compile) color coding. Messaging clarifies auto-install on first run.
- **Default model** — empty string instead of gated `meta-llama/Meta-Llama-3-8B`.
- **Font size bump** — global +1 notch across 91 component files for readability.

### Fixed

- **QNN false-positive** — x64 Windows no longer shows QNN as a local accelerator (stays selectable as platform target).
- **DirectML detection** — Windows machines show "Compatible, runtime available" instead of "Not on this system".
- **QNN execution gate** — preparation mode (x64) allowed when runtime is loadable and host is recognized.
- **DirectML execution gate** — properly blocks Execute Live until onnxruntime-directml is installed (not conflated with detection).
- **Brotli cache headers** — `index.html.br` and hashed `.br` assets now get correct Cache-Control.
- **Hardware probe deadlock** — resolved probe timeout issues with subprocess timeouts on TensorRT calls.
- **Stale MCP transport** — guard against close on stale connection, close on failure, query sanitization.

### Security

- **Helmet + CSP** — Content-Security-Policy with `'self'`, jsdelivr CDN for ORT WASM, frame-ancestors, Permissions-Policy.
- **X-Robots-Tag: noindex** — prevents indexing if exposed to public internet.
- **Azure credential stripping** — `azureStr` excluded from localStorage persistence.
- **Server sourcemap removed** — `dist/server.mjs.map` no longer ships in production builds.

### Infrastructure

- **Test coverage** — recipe builder, pipeline validation, hardware probe, Devin client (22 tests), provider runtime kind.
- **Reduced method complexity** — #152, #157, #158 addressed via extractions.
- **GitHub issue triage** — open issue count reduced.
- **Repo cleanup** — removed agent/IDE directories, stale scaffold files, launcher scripts from tracking.

---

## [0.1.0] — 2026-08-08

First public release.

### Added

#### Core

- **Recipe builder UI** — configure model source, hardware target, and optimization passes visually
- **Pipeline validation** — schema engine with cross-pass compatibility rules, auto-coercion, and declarative fix suggestions
- **Real Olive backend** — venv auto-creation, `olive-ai` install, SSE log streaming, SIGTERM→SIGKILL cancellation
- **Batch execution** — job registry with queue, concurrent execution, and per-job log history
- **Execute Live** — real-time optimization output in ExecutionWorkspace with error auto-diagnosis

#### AI Assistant & Providers

- **20 AI providers** across 4 categories:
  - **Direct:** Google Gemini, OpenAI, Anthropic, Mistral AI, xAI (Grok)
  - **Routers:** OpenRouter, Groq, Together AI, Fireworks AI, NVIDIA NIM, Hugging Face
  - **Subscriptions:** ChatGPT, GitHub Copilot, Devin, Kilo Code, OpenCode Zen/Go, Codex
  - **Custom:** OpenAI-Compatible (Ollama, vLLM, LiteLLM), Cloudflare Workers AI
- **Local AI engines** — LM Studio and Ollama with model pulling, health checks, and engine toggle
- **Auto-select provider** — automatic detection based on system capabilities

#### Hardware Validation & Autofix

- **Autofix buttons for all providers** — CPU, CUDA, TensorRT, TensorRT RTX, ROCm, OpenVINO, QNN, DirectML
- **Hardware-specific parameter validation** — validates pass parameters against provider constraints
- **RecipeValidationPanel** — live validation in RecipeGraphView showing compatibility warnings and MCP diagnostics

#### MCP Server Integration

- **27-tool Python FastMCP server** — pass catalog, strategy advisor, hardware guide, troubleshooting, recipe validation, job management
- **84 optimization passes** and **22 hardware profiles** in the knowledge base
- **MCPDiagnosticCard** — reusable component for displaying and applying MCP troubleshooting results
- **Error auto-diagnosis** — on job failure, error lines are selected and diagnosed automatically

### Infrastructure

- **CI pipeline** — lint → unit tests → server tests → integration tests → component tests → recipe validation → build → artifact assert → prod smoke → CodeQL
- **oxlint** — fast linter (`pnpm lint:quick`) for pre-push checks alongside ESLint
- **74 parameter validation tests** — comprehensive coverage for all provider rules with autofix payload assertions
- **Tauri 2 shell** — optional desktop wrapper (experimental, unsigned)

### Security

- MIT license
- `uuid` vulnerability patched via `pnpm-workspace.yaml` override
- Dependency overrides consolidated in `pnpm-workspace.yaml` (pnpm 10+ requirement)

### Developer Experience

- **pnpm 11.17** enforced via preinstall guard (npm blocked)
- **5 test tiers** — unit, server, integration, component, Python MCP (pytest)
- **Recipe builder smoke test** — `pnpm validate:recipe`
- **AGENTS.md** — complete agent instructions for AI coding assistants
- **Kiro IDE configuration** — steering files, hooks, and MCP power for intelligent dev assistance
