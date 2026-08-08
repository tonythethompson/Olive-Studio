# Changelog

All notable changes to Olive Studio are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/).

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
