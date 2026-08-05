# Changelog

All notable changes to Olive Studio are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/).

---

## [Unreleased]

### Changed

- **Tech-debt passes 1–6** (see `docs/Tech Debt & Issues.md` for the full status table):
  - Validation pipeline: `buildOliveRecipe` memoized; `buildRecipeFromState` reuses the recipe built during validation; recipe-builder UI defers validation display and rebuilds fresh at Execute/Queue time.
  - `CROSS_PASS_RULES` is now the single rule table driving both pass coercion and cross-pass validation issues; HF task / model-type inference uses explicit ordered lookup tables.
  - Job logs are capped at 1,000 lines with a trim marker on SSE reconnect replay; `/olive/status` reports `logsTruncated`.
  - `routes/ai.ts` (2,120 lines) split into `routes/ai/` sub-modules; local-engine runtime state moved to `services/ai/localEngineState.ts` with a test reset hook.
  - `OLIVE_SERVE_STATIC` env switch for static serving; vite loaded dynamically in dev and moved to devDependencies; `QueryClient` scoped inside `App`; recipe/system types off `any`.

### Removed

- Dead `@mendable/firecrawl-js` dependency (no imports anywhere in the codebase).

---

## [0.2.0] — 2026-07-25

### Added

#### AI Assistant & Providers

- **Ollama integration** — first-class support for Ollama alongside LM Studio as a local AI engine. Models can be pulled, loaded, and unloaded via the Ollama API (`localhost:11434`).
- **Engine toggle** — segmented toggle in the 1-Click Local AI Setup header lets users pick their preferred engine (LM Studio or Ollama), persisted to `localStorage`.
- **Source-aware model management** — each model tracks its source engine (`lms` | `ollama`), routing Load/Unload operations to the correct endpoint automatically.
- **Expanded AI provider catalog** — 14 providers across 4 categories:
  - **Direct:** Google Gemini, OpenAI, Anthropic, Mistral AI, xAI (Grok)
  - **Routers:** OpenRouter, Groq, Together AI
  - **Subscriptions:** ChatGPT, GitHub Copilot, Devin, Kilo Code
  - **Custom:** OpenAI-Compatible (Ollama, vLLM, LiteLLM)
- **Provider tooltips** — detailed tooltips on each execution provider card explaining hardware requirements, supported quantization methods, and recommended configurations.
- **Auto-select provider** — automatic provider detection based on system capabilities, auto-selecting the best provider on first load.
- **LM Studio (Llmster) integration** — health check endpoint, model pulling with progress, 1-click download cards with real file sizes from the LM Studio API.
- **Active model indicator** — green dot next to the currently active model in the Installed Models list.
- **Model search filter** — search input with `⌘K` / `Ctrl+K` keyboard shortcut to focus, `Escape` to clear.
- **Collapsible publisher groups** — installed models grouped by publisher (lmstudio-community, google, etc.) with expand/collapse controls.
- **Model size badges** — 1-click cards display actual GGUF file sizes fetched from LM Studio and Ollama APIs instead of hardcoded fallbacks.

#### Hardware Validation & Autofix

- **Autofix buttons for all providers** — every parameter validation rule now includes an autofix button with descriptive action labels:
  - **CPU:** Switch to INT8
  - **CUDA:** Switch to AWQ INT4
  - **TensorRT (×3):** Switch to AWQ / INT4
  - **TensorRT RTX (×2):** Switch to AWQ INT4
  - **ROCm (×2):** Switch to GPTQ / GPTQ INT4
  - **OpenVINO:** Enable static INT8
  - **QNN (×2):** Enable AWQ symmetric / Switch to INT4
- **Hardware-specific parameter validation** — validates pass parameters against hardware constraints (e.g., INT8 on QNN requires `per_channel=true`, TensorRT requires QDQ format).
- **Refresh validation button** — bypass the debounce and re-run both MCP validation checks immediately.
- **RecipeValidationPanel** — live validation panel in the RecipeGraphView showing compatibility warnings, parameter warnings, and MCP diagnostics.

#### MCP Server Integration

- **MCPDiagnosticCard** — reusable component for displaying MCP troubleshooting results with Apply Fix button, wired into both ExecutionWorkspace and BatchProcessingPanel.
- **useMcpDiagnosticKeyed hook** — shared hook for per-job diagnostic tracking, eliminating duplicated fetch logic across components.
- **Apply Fix** — applies `updated_config` from MCP diagnostics to the recipe state (e.g., switching precision, quantization method, symmetry).
- **Manual diagnosis** — "Diagnose Selected" button in the execution log panel lets users manually trigger `troubleshoot_olive_error` on any selected log lines.
- **Error auto-selection** — on job failure, error lines (containing `[ERROR]`, `Traceback`, `Exception`, etc.) are automatically selected for immediate diagnosis.
- **Diagnosis history sidebar** — collapsible sidebar storing previous diagnosis results with timestamps for comparing across runs.

#### Shared Infrastructure

- **useAutoClearError hook** — unified timer pattern for auto-dismissing error messages across PruningInspector, QuantizationInspector, ExecutionWorkspace, and BatchProcessingPanel.
- **useImportPresets hook** — shared import file handling logic (createInput + FileReader + JSON parsing + collision detection) for both pruning and quantization preset importers.
- **ImportConfirmDialog** — reusable confirmation dialog showing preset details with collision indicators, keyboard support (`Escape`/`Enter`), and safe default focus on Cancel.
- **McpConfigKey type** — typed union of all MCP config keys (`precision`, `quant_mode`, `sym`, `block_size`, `group_size`, `damp_percent`, `desc_act`) catching typos at compile time.
- **mapMcpConfigToUiState utility** — shared function mapping MCP config keys to UIState patches, used by both ExecutionWorkspace and BatchProcessingPanel.
- **MCPDiagnostic shared type** — centralized `McpDiagnostic` interface in `src/types.ts` used by ExecutionWorkspace, BatchProcessingPanel, and integration tests.

#### Testing

- **74 parameter validation tests** — comprehensive test coverage for all provider rules including QNN, CUDA, TensorRT, TensorRT RTX, ROCm, OpenVINO, and CPU with autofix payload assertions.
- **Cross-provider consistency tests** — parameterized `test.each` block verifying consistent validation behavior across all 7 providers.
- **useMcpDiagnosticKeyed tests** — unit tests for keyed diagnostic storage, loading state transitions, concurrent fetches, and error handling.
- **mapMcpConfigToUiState tests** — unit tests for MCP config mapping with edge cases for invalid values and missing keys.
- **Server lifecycle tests** — tests for `cleanupAllJobs` pattern and SSE disconnect cancellation.

#### Tooling & CI

- **oxlint** — added fast linter (`pnpm lint:quick`) for pre-push checks alongside ESLint.
- **License updated** — AGPL-3.0-or-later → MIT.

### Fixed

- **GeminiSidebar ESLint warning** — suppressed `react-hooks/set-state-in-effect` on mount effect (intentional `setLoading(true)` at top of `refresh()`).
- **Trailing comma in package.json** — fixed JSON parse error after removing stale `overrides` block.
- **ESLint warnings in ExecutionWorkspace** — added `eslint-disable-line` for `Date.now()` purity warnings and `setState` in effects.
- **Tab-switch flicker** — reduced GeminiSidebar tab-switch flicker with `useTransition`.
- **Job history notices** — centralized job-history notices and CPU probe-failure rendering.

### Security

- **uuid vulnerability fixed** — added `uuid@<11.1.1: '>=11.1.1'` override in `pnpm-workspace.yaml` to resolve Dependabot alert #15 (medium severity, missing buffer bounds check).
- **Stale overrides cleaned** — removed npm-style `overrides` from `package.json` (pnpm 10 ignores them; real overrides live in `pnpm-workspace.yaml`).

### Changed

- **MCP overrides relocated** — moved `protobufjs`, `body-parser`, `minimatch`, and `brace-expansion` overrides from `package.json` to `pnpm-workspace.yaml` (pnpm 10 requirement).
- **README updated** — license badge AGPL→MIT, added pnpm badge, description polish, table formatting.
- **MCP server docs** — updated `olive-mcp-server/README.md` with expanded tool descriptions.

---

## [0.1.0] — 2026-07-01

Initial release.
