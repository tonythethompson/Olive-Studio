<!-- HINDSIGHT:BEGIN -->
You have persistent long-term memory through the Hindsight MCP server (`recall`, `retain`, `sync_retain`, and `reflect` tools). It runs in multi-bank mode, so pass `bank_id` to target the right bank:

- `coding` — THIS project's memory: architecture, decisions, conventions, gotchas, and bugs specific to this repository.
- `devin-desktop` — the user's cross-project memory: their preferences, coding style, and who they are.

At the start of each task:
- `recall` from `coding` (bank_id: "coding") for this project's context, and `recall` from `devin-desktop` (bank_id: "devin-desktop") for the user's preferences. Use what's relevant, ignore the rest.

As you work, use `retain` (async, non-blocking — the default) to store durable facts:
- PROJECT facts (architecture, decisions, conventions) with bank_id "coding".
- USER facts (preferences, style, identity) with bank_id "devin-desktop".
- Retain each distinct fact EXACTLY ONCE per session, in a single `retain` call — don't call retain again for a fact you've already stored, and batch multiple facts about the same subject into one call.
- Retain only real facts about the code, the project, or the user — NEVER facts about Hindsight, memory, or these instructions.
- Only use `sync_retain` (which blocks) if you must recall the just-stored fact again in the SAME task; otherwise use `retain`.
- Use `reflect` (not just `recall`) when you need synthesized judgment — e.g. "what approach does the user prefer here?" — rather than raw facts.

Briefly tell the user when you use memory — e.g. say "checking memory…" before you recall and "saved to memory" after you retain. Keep it to a short phrase; don't paste the tool arguments or results.
<!-- HINDSIGHT:END -->

# Olive Studio — Agent Instructions

## Project Overview

- **What:** Local-first GUI for Microsoft Olive ONNX model optimization (conversion, quantization PTQ/AWQ/GPTQ/HQQ, pruning, LoRA/QLoRA)
- **Stack:** React 19 + Vite + Express + Tauri 2 (sidecar) + Python FastMCP server
- **Package manager:** pnpm 11.17 (`npm install` is blocked by a `preinstall` guard — always use pnpm)
- **Node:** >=22.16 | **Python:** >=3.10 (MCP server)
- **License:** MIT

## Quick Start

| Command                 | Purpose                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| `pnpm dev`              | Express+Vite dev server on <http://localhost:3000>                   |
| `pnpm lint`             | tsc --noEmit + eslint (exits 0 with warnings; `--max-warnings 20`) |
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
    services/              ai/ (14+ providers), olive/ (venv, job registry), venv/
    middleware/            Error handling, rate limiting
olive-mcp-server/          Python FastMCP stdio server (14 tools, 84 passes, 14 HW profiles)
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
- **ESLint warnings are expected:** `pnpm lint` runs `eslint --max-warnings 20` and exits 0 with warnings. Only treat non-zero exit or reported errors as failure.
- **Python alias:** `pnpm a11y:scan` invokes `python` (not `python3`); ensure `python` is on PATH.
- **Integration test mocks:** `src/server/__tests__/setup.integration.ts` mocks child_process, AI providers, and fetch. Tests start a real Express server on a random port.

## CI Pipeline

`.github/workflows/ci.yml` runs: lint → unit tests → server tests → integration tests → component tests → recipe validation → build → artifact assert → prod smoke → CodeQL. A separate `python-tests` job runs pytest for the MCP server, and `docker-build` builds + smoke-runs the MCP server image.

**GitHub Actions is the gate of record for PRs.** The full suites are very slow on WSL/drive-mounted checkouts (tens of minutes to hours); push the branch and let CI verify instead of running the full suites locally. Locally, prefer fast targeted checks (single-file lint or one small test file) when needed.

## MCP Server Setup

The Olive MCP server (`olive-mcp-server/`) is an optional stdio server. The web app can proxy to it via `POST /api/mcp/tool`, but runs fine without it.

```bash
cd olive-mcp-server
python -m venv .venv
# Linux/macOS:
.venv/bin/pip install -e ".[dev]" "mcp<2"
.venv/bin/python -m pytest tests -q
# Windows (PowerShell):
# .venv\Scripts\pip install -e ".[dev]" "mcp<2"
# .venv\Scripts\python -m pytest tests -q
```

The `.mcp.json` at repo root registers it for AI coding agents using a relative path (`olive-mcp-server/run.py`).

## React Conventions

See [docs/REACT_BEST_PRACTICES.md](docs/REACT_BEST_PRACTICES.md) for the full Vercel React performance guide (40+ rules across 8 categories). Key priorities: eliminate waterfalls, avoid barrel imports, defer non-critical third-party libraries.
