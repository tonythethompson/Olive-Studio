# Olive Studio

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](package.json)
[![pnpm](https://img.shields.io/badge/package%20manager-pnpm%2011.17.0-f69203)](https://pnpm.io)
[![CI](https://github.com/tonythethompson/Olive-Studio/actions/workflows/ci.yml/badge.svg)](https://github.com/tonythethompson/Olive-Studio/actions/workflows/ci.yml)

<p align="center">
  <img src="../Assets/hero.png" alt="Olive Studio — visual GUI for Microsoft Olive model optimization: model input, optimization passes, and deployment artifact pipeline" width="900" />
</p>

Olive Studio is a visual GUI for [Microsoft Olive](https://github.com/microsoft/Olive) model optimization. Configure model sources, hardware targets, and optimization passes, then execute on your own machine without cloud accounts. Ships with an AI assistant (20 providers), hardware validation with one-click autofix, and an MCP server for agent-driven workflows.

[Microsoft Olive docs](https://microsoft.github.io/Olive/) · [Olive recipes catalog](https://github.com/microsoft/olive-recipes) · [Roadmap](../docs/ROADMAP.md)

---

## Screenshots

| Recipe catalog | Hardware detection |
|:-:|:-:|
| ![Recipe catalog with presets and AI audit](../public/screenshots/01-recipe-catalog.png) | ![Hardware probe with VRAM estimation](../public/screenshots/02-hardware-detection.png) |

| Hardware VRAM & providers | Recipe graph flow |
|:-:|:-:|
| ![Provider cards with VRAM estimates](../public/screenshots/02-hardware-vram.png) | ![Pipeline graph with AI suggestions](../public/screenshots/03-recipe-graph.png) |

---

## Quick start

### Prerequisites

- **Node.js** 22+
- **pnpm** 11.17+ (`npm install` is blocked)
- **Python** 3.10-3.13 (3.12 recommended) on PATH, or set from the app's Runtime control

Optional: NVIDIA / Intel / Qualcomm / AMD drivers for GPU/NPU recipes. [Hugging Face token](https://huggingface.co/settings/tokens) for gated models.

### Install and run

```bash
git clone https://github.com/tonythethompson/Olive-Studio.git
cd Olive-Studio
pnpm install
pnpm dev
```

Open http://localhost:3000. On the first Execute Live run, the server creates a `.venv/` and installs Olive automatically.

### Production build

```bash
pnpm build
pnpm start
```

---

## Features

### Three-step pipeline

1. **Model source** — Hugging Face model ID, local files, Azure ML path, or a starter recipe from the curated GitHub catalog
2. **Hardware** — pick an execution provider; the app probes your machine and surfaces only what it can run
3. **Recipe & run** — edit passes in a graph or JSON view, validate, execute, queue batch jobs, or export

### Optimization passes

| Pass | What it does |
|------|-------------|
| **Conversion** | PyTorch / TensorFlow / JAX → ONNX, OpenVINO IR, QNN, or TensorRT |
| **Quantization** | PTQ, AWQ, QAT, GPTQ, HQQ, RTN, SpinQuant, QuaRot (INT8/INT4/FP16) |
| **Pruning** | Magnitude, SparseGPT, Wanda (structured or unstructured) |
| **ORT transforms** | Transformer-specific ONNX Runtime graph optimizations |
| **PEFT** | LoRA / QLoRA, including diffusion LoRA |
| **Model splitting** | Shard large models across devices |

Pass combinations are validated against your execution provider. Incompatible combinations surface conflict banners with one-click autofix.

### Execution providers

| Provider | Target |
|----------|--------|
| CPU | Broad compatibility |
| CUDA | NVIDIA GPUs |
| TensorRT | NVIDIA datacenter (full SDK) |
| TensorRT RTX | Consumer GeForce RTX |
| OpenVINO | Intel CPU / GPU / NPU |
| QNN | Qualcomm Snapdragon NPU |
| ROCm | AMD GPUs |
| DirectML | Windows GPU acceleration |
| WebGPU | In-browser (ONNX Runtime Web) |

### Runtime intelligence

- **Hardware probe** — detects ORT providers, GPU drivers, VRAM, and recommends a default
- **VRAM estimates** — per-pass and provider memory guidance
- **Pipeline validation** — schema checks, compatibility rules, and Olive preflight before spawn
- **Auto dependency install** — creates `.venv/`, installs olive-ai, pins GPU runtimes on demand
- **Batch queue** — run and track multiple jobs with shared validation
- **MCP diagnostics** — query the bundled MCP server for troubleshooting and pass guidance
- **In-browser validation** — smoke-test exported ONNX models with WebGPU or CPU
- **WebGPU benchmark** — measure browser GPU inference performance
- **Model Arena** — side-by-side A/B comparison of optimization outputs

### AI assistant (optional)

20 providers supported: Gemini, OpenAI, Anthropic, Mistral, xAI, OpenRouter, Groq, Together, Fireworks, NVIDIA NIM, Hugging Face, Cloudflare Workers AI, OpenAI Codex (ChatGPT sign-in), GitHub Copilot, Devin, Kilo Gateway, LM Studio, Ollama, and generic OpenAI-compatible endpoints.

- **Audit** — reviews your pipeline configuration and suggests optimizations
- **Chat** — workspace-aware Q&A about your recipe, hardware, and Olive workflows
- **Apply actions** — AI suggestions can be applied directly to your pipeline state

Set credentials in-app under Assistant → Settings, or via environment variables.

---

## Environment variables

Create `.env` or `.env.local` in the project root. All are optional:

| Variable | Purpose |
|----------|---------|
| `GEMINI_API_KEY` | Google Gemini |
| `OPENAI_API_KEY` | OpenAI / compatible |
| `ANTHROPIC_API_KEY` | Anthropic Claude |
| `HF_TOKEN` | Hugging Face (models + chat) |
| `MISTRAL_API_KEY` | Mistral |
| `XAI_API_KEY` | xAI Grok |
| `OPENROUTER_API_KEY` | OpenRouter |
| `GROQ_API_KEY` | Groq |
| `TOGETHER_API_KEY` | Together AI |

Full list of supported keys in [AGENTS.md](../AGENTS.md).

---

## GPU notes (NVIDIA)

- The server pins `onnxruntime-gpu==1.26.0` with CUDA 12 runtime wheels into `.venv`
- TensorRT (`tensorrt==10.9.0.34`) installs for `TensorrtExecutionProvider` recipes
- TensorRT RTX (`tensorrt-rtx`) installs for `NvTensorRTRTXExecutionProvider` recipes
- Restart `pnpm dev` after server-side dependency changes

---

## MCP server

The repository includes `olive-mcp-server/`, a Python FastMCP server with 27 tools covering pass catalog, hardware guides, troubleshooting, compatibility checks, recipe validation, and job lifecycle.

- Runs as a stdio server; the web app proxies calls via `POST /api/mcp/tool`
- `.mcp.json` at repo root registers it for AI coding agents (Claude Code, Cursor, etc.)
- Troubleshooting feedback is local-only and aggregate (no logs or PII stored)

See [olive-mcp-server/README.md](../olive-mcp-server/README.md) for setup and tool documentation.

---

## Project layout

```
Olive-Studio/
├── src/
│   ├── components/features/  # 26 React feature panels
│   ├── lib/                  # Recipe builder, validation, stores, hooks
│   └── server/
│       ├── routes/           # Express route modules (ai, olive, mcp, env, system, arena)
│       ├── services/         # AI providers (20), olive jobs, venv, MCP client
│       └── middleware/       # bodyGuard, rateLimit, localOnly
├── server.ts                 # Express entry point
├── olive-mcp-server/         # Python MCP server (27 tools)
├── bin/                      # Production CLI
├── scripts/                  # Catalog generator, smoke tests, utilities
└── docs/                     # Roadmap, release notes, architecture docs
```

---

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Development server (Vite + Express) |
| `pnpm build` | Production build |
| `pnpm start` | Serve production build |
| `pnpm test` | Unit tests (vitest) |
| `pnpm test:server` | Server unit tests |
| `pnpm test:integration` | Integration tests |
| `pnpm test:component` | Component tests (jsdom) |
| `pnpm lint` | TypeScript + ESLint |
| `pnpm lint:quick` | Fast lint (oxlint) |
| `pnpm validate:recipe` | Recipe builder smoke test |

---

## Contributing

Issues and pull requests welcome. See [CONTRIBUTING.md](../CONTRIBUTING.md).

---

## Roadmap

**v0.2** (next)
- Persistent MCP connection (replace subprocess spawn, ~5ms tool calls)
- Typed pass configuration (discriminated union per pass type)
- Component splits for large panels
- GitHub issue triage and cleanup

**Later**
- Stateful Olive Agent (plan, execute, observe, auto-retry)
- Published MCP server (PyPI / Docker, usable without the GUI)
- Tauri desktop packaging (signed installer, auto-update)
- Multi-model batch comparison view
- Export optimization reports

Full details in [docs/ROADMAP.md](../docs/ROADMAP.md).

---

## Related

- [Microsoft Olive](https://github.com/microsoft/Olive) — the optimization engine
- [microsoft/olive-recipes](https://github.com/microsoft/olive-recipes) — official recipe catalog
- [ONNX Runtime](https://onnxruntime.ai/) — inference runtime

---

## License

MIT. See [LICENSE](../LICENSE).

Microsoft Olive and related names are trademarks of Microsoft Corporation. This project is independent community tooling.
