# Olive Studio — Agent Instructions

## Project Overview

- **What:** Local GUI for Microsoft Olive ONNX model optimization (conversion, quantization PTQ/AWQ/GPTQ/HQQ, pruning, LoRA/QLoRA). Do not brand the product as "local-first" (see `.cursor/rules/no-local-first-branding.mdc`).
- **Stack:** React 19 + Vite + Express + Tauri 2 (sidecar) + Python FastMCP server
- **Package manager:** pnpm 11.17 (`npm install` is blocked by a `preinstall` guard — always use pnpm)
- **Node:** >=22.16 | **Python:** >=3.10 (MCP server)
- **License:** MIT

## Quick Start

| Command                 | Purpose                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| `pnpm dev`              | Express+Vite dev server on <http://localhost:3000>                 |
| `pnpm lint`             | tsc --noEmit + eslint (`--max-warnings 0`; any warning fails)      |
| `pnpm test`             | Unit tests (vitest, src/lib/)                                      |
| `pnpm test:server`      | Server unit tests (src/server/)                                    |
| `pnpm test:integration` | Integration tests (mocked externals, real Express server)          |
| `pnpm test:component`   | Component tests (jsdom, @testing-library/react)                    |
| `pnpm validate:recipe`  | Recipe builder smoke test                                          |
| `pnpm build`            | Vite build + esbuild server bundle → dist/server.mjs               |
| `pnpm start`            | Serve production build on port 3000                                |

## Architecture

```text
server.ts                  Express entry (modular routes in src/server/routes/)
src/
  components/features/     26+ React feature panels (zustand-connected)
  lib/stores/              pipelineStore.ts — single zustand UI state store
  lib/                     Recipe builder, pipeline validation, AI response, hooks
  server/
    routes/                ai.ts, mcp.ts, olive.ts, env.ts, system.ts, github.ts
    services/              ai/ (20 providers), olive/ (venv, job registry), venv/
    middleware/            Error handling, rate limiting
olive-mcp-server/          Python FastMCP stdio server (32 tools, 92 passes, 22 HW profiles)
src-tauri/                 Tauri 2 shell (optional — app runs without it)
```

## Assistant AI providers (backburner)

Do not implement unless explicitly requested. Prefer Custom / openai-compat for OpenAI-shaped hosts until then.

| Candidate                        | Notes                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Azure OpenAI / Microsoft Foundry | First-class provider: deployment-as-model, `api-key` and/or Bearer, optional `api-version`               |
| AWS Bedrock                      | Converse / SigV4 (or Bedrock OpenAI-compat gateway if standardized)                                      |
| Google Vertex AI                 | Gemini via GCP/ADC; separate from AI Studio Gemini key path                                              |
| IBM watsonx                      | Enterprise non-OpenAI auth/catalog                                                                       |
| Perplexity                       | Thin OpenAI-compat preset (Custom works today)                                                           |
| Qwen / Alibaba DashScope         | API preset (intl vs CN base); not a Subscription entry                                                   |
| Nous Portal                      | Subscription-style multi-model gateway (Hermes/Nous); distinct from OpenClaw/Hermes local agent gateways |
| DeepSeek                         | Thin OpenAI-compat preset (`api.deepseek.com`); Custom works today                                       |
| Kimi / Moonshot                  | Thin OpenAI-compat preset (intl vs CN base); also reachable via OpenRouter / OpenCode / HF today         |
| GLM / Zhipu                      | Thin OpenAI-compat preset (Zhipu / BigModel); Custom works today                                         |
| MiniMax                          | Thin OpenAI-compat preset; Custom works today                                                            |

Out of scope for this list: Microsoft 365 Agents / Copilot Studio agents (channel runtime, not a model provider). OpenClaw / Hermes agent gateways and Cursor SDK stay Custom/local / agent-runtime (not chat providers) unless demand justifies a first-class entry.

## Testing Tiers

| Config file                        | Scope                              | Command                                            |
| ---------------------------------- | ---------------------------------- | -------------------------------------------------- |
| `vitest.config.ts`                 | src/lib/ unit tests                | `pnpm test`                                        |
| `vitest.server.config.ts`          | src/server/ unit tests             | `pnpm test:server`                                 |
| `vitest.integration.config.ts`     | Integration (all externals mocked) | `pnpm test:integration`                            |
| `vitest.component.config.ts`       | Component tests (jsdom)            | `pnpm test:component`                              |
| `olive-mcp-server/tests/` (pytest) | Python MCP tools                   | `cd olive-mcp-server && python -m pytest tests -q` |

## Gotchas

- **mcp pip pin:** `mcp` must be pinned `<2` — version 2.x removes `mcp.server.fastmcp` and breaks imports/tests. Install with: `pip install -e ".[dev]" "mcp<2"`
- **No real Olive runs in CI/VM:** Do NOT trigger actual Olive optimization ("Execute Live"/batch run) — it downloads models + CUDA wheels. Recipe building, JSON export, and validation are the CPU-only flows.
- **ESLint warnings fail the build:** `pnpm lint` runs `eslint --max-warnings 0`. Any warning is a failure, same as an error.
- **Python alias:** `pnpm a11y:scan` invokes `python` (not `python3`); ensure `python` is on PATH.
- **Integration test mocks:** `src/server/__tests__/setup.integration.ts` mocks child_process, AI providers, and fetch. Tests start a real Express server on a random port.

## CI Pipeline

`.github/workflows/ci.yml` runs: lint → unit tests → server tests → integration tests → component tests → recipe validation → build → artifact assert → prod smoke → CodeQL. A separate `python-tests` job runs pytest for the MCP server, and `docker-build` builds + smoke-runs the MCP server image.

**GitHub Actions is the gate of record for PRs.** The full suites are very slow on WSL/drive-mounted checkouts (tens of minutes to hours); push the branch and let CI verify instead of running the full suites locally. Locally, prefer fast targeted checks (single-file lint or one small test file) when needed.

## MCP Server Setup

The Olive MCP server (`olive-mcp-server/`) is an optional stdio server. The web app can proxy to it via `POST /api/mcp/tool`, but runs fine without it. For Kiro, the `olive-mcp-tools` Power provides the connection — just run the setup script once:

```bash
# Windows (PowerShell) — from repo root:
.\scripts\setup-mcp.ps1

# Linux/macOS:
./scripts/setup-mcp.sh

# To also rebuild semantic search indexes:
.\scripts\setup-mcp.ps1 -RebuildIndex
./scripts/setup-mcp.sh --rebuild-index
```

This creates the venv, installs all deps (including `sentence-transformers` for semantic search, `mcp<2`), and verifies the server starts.

For manual setup or pytest:
```bash
cd olive-mcp-server
python -m venv .venv
.venv/bin/pip install -e ".[dev]" "mcp<2"   # Linux/macOS
.venv\Scripts\pip install -e ".[dev]" "mcp<2"  # Windows
.venv/bin/python -m pytest tests -q   # Linux/macOS
.venv\Scripts\python -m pytest tests -q  # Windows
```

The `.mcp.json` at repo root registers Olive MCP for AI coding agents using a relative path (`olive-mcp-server/run.py`). It also registers optional Serena via `uvx --from serena-agent==1.6.1` (requires [uv](https://docs.astral.sh/uv/); version-pinned, no global `serena` install). Run `pnpm install` yourself before relying on Serena's TypeScript language server. Do not put `pnpm install` in `.serena/project.yml` activation.

## Security / network threat model

Olive Studio is built for single-user, loopback-only operation. Do not expose the Express API to a LAN or the public internet without understanding and accepting the risk.

| Variable                   | Effect                                                                                                                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OLIVE_BIND`               | Server bind address. Defaults to `127.0.0.1`. Set to `0.0.0.0` or `::` only to enable LAN access and only on a trusted network.                                                                 |
| `SYNC_KB_TOKEN`            | Server-side enforcement token for `POST /api/mcp/sync-kb`. When set, the client must send the matching `x-sync-token` header.                                                                   |
| `VITE_SYNC_KB_TOKEN`       | Build-time copy of the token embedded in the bundled UI so it can send the `x-sync-token` header. Must match `SYNC_KB_TOKEN`. This value is client-visible and must not be treated as a secret. |
| `OLIVE_ARENA_ALLOW_REMOTE` | When `true`, disables loopback gating on Arena inference routes for Docker / remote lab setups.                                                                                                 |

- `server.ts` binds to `127.0.0.1` by default and logs a warning when bound to all interfaces.
- Olive job endpoints (`/api/olive/run`, `/api/olive/status/:jobId`, `/api/olive/stream/:jobId`, `/api/olive/cancel`) and `/api/mcp/sync-kb` are loopback-only.
- A global Express error handler sanitizes 500s so stack traces do not leak to clients.

## React Conventions

See [docs/REACT_BEST_PRACTICES.md](docs/REACT_BEST_PRACTICES.md) for the full Vercel React performance guide (40+ rules across 8 categories). Key priorities: eliminate waterfalls, avoid barrel imports, defer non-critical third-party libraries.

## Kiro IDE Configuration

The `.kiro/` directory at repo root contains workspace-level Kiro configuration for intelligent development assistance. Everything is committed — no manual file creation needed.

| Path                                          | Purpose                                                                                                                                      |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `.kiro/powers/olive-mcp-tools/`               | **MCP Power** — connects Kiro to the 32-tool Olive MCP server + steering docs + guided skills (discover, optimize, troubleshoot, validate)   |
| `.kiro/powers/olive-studio-dev/`              | **Dev Power** — architecture reference, pass/provider addition checklists, troubleshooting workflows                                         |
| `.kiro/steering/olive-studio-conventions.md`  | Core development rules (pnpm, test strategy, architecture patterns, code style)                                                              |
| `.kiro/steering/pipeline-validation-rules.md` | Rules for modifying the recipe builder and validation systems (conditional: loaded when editing pipelineValidation/oliveRecipeBuilder files) |
| `.kiro/hooks/`                                | Automated quality gates (lint on save, recipe validation on builder change, targeted test runs, typecheck pre-task, MCP venv check)          |

### MCP Server Setup (one-time)

The `olive-mcp-tools` Power provides the MCP connection config, but the Python venv must be initialized once:

```bash
# Windows (PowerShell):
.\scripts\setup-mcp.ps1

# Linux / macOS:
./scripts/setup-mcp.sh

# With semantic search index rebuild (optional — shipped indexes work out of the box):
.\scripts\setup-mcp.ps1 -RebuildIndex
./scripts/setup-mcp.sh --rebuild-index
```

This creates `olive-mcp-server/.venv`, installs all deps (including `sentence-transformers` for semantic search), and verifies the server starts. A `SessionStart` hook warns if the venv is missing.

> **Note:** `.kiro/settings/mcp.json` is NOT needed — the Power at `.kiro/powers/olive-mcp-tools/mcp.json` provides the server connection. Only create a settings file if you need to override the Power's config (e.g., different Python path or env vars).

### Hooks (active on session start)

- **check-mcp-venv** — verifies MCP server Python venv exists on session start
- **lint-on-save** — `pnpm lint:quick` on `.ts`/`.tsx` saves
- **validate-recipe-on-builder-change** — `pnpm validate:recipe` when `oliveRecipeBuilder.ts` changes
- **unit-tests-on-lib-change** — `pnpm test` on `src/lib/**/*.ts` saves
- **server-tests-on-route-change** — `pnpm test:server` on `src/server/**/*.ts` saves
- **pytest-on-mcp-change** — pytest on `olive-mcp-server/**/*.py` saves
- **typecheck-pre-task** — `tsc --noEmit` before spec task execution
