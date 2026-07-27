# Olive Studio

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](package.json)
[![pnpm](https://img.shields.io/badge/package%20manager-pnpm%2011.17.0-f69203)](https://pnpm.io)
[![CI](https://github.com/tonythethompson/Olive-Studio/actions/workflows/ci.yml/badge.svg)](https://github.com/tonythethompson/Olive-Studio/actions/workflows/ci.yml)

**A visual recipe builder and local runner for [Microsoft Olive](https://github.com/microsoft/Olive).**  
Author ONNX optimization pipelines, then execute them on your hardware with live logs, dependency auto-install, and validation before the run starts.

> **Local-first.** No cloud account required for optimization runs. Optional AI Copilot uses your own API keys.

[About Olive Studio](ABOUT.md) · [Microsoft Olive docs](https://microsoft.github.io/Olive/) · [Olive recipes catalog](https://github.com/microsoft/olive-recipes)

---

## Features

### Guided pipeline (3 steps)

1. **Model source**: Hugging Face model ID, local files, Azure ML path, or a starter recipe from the curated GitHub catalog.
2. **Hardware**: Pick an execution provider; the app probes ONNX Runtime and local drivers, then surfaces only what your machine can run.
3. **Recipe & run**: Edit passes in a graph or JSON view, validate, execute live, queue batch jobs, or export.

### Optimization passes

| Pass                 | What it does                                                               |
| -------------------- | -------------------------------------------------------------------------- |
| **Graph conversion** | PyTorch / TensorFlow / JAX → ONNX, OpenVINO IR, QNN context, or TensorRT   |
| **Quantization**     | PTQ, AWQ, QAT, GPTQ, HQQ, RTN, SpinQuant, and QuaRot across INT8/INT4/FP16 |
| **Pruning**          | Magnitude, SparseGPT, Wanda: structured or unstructured                    |
| **ORT transforms**   | Transformer-specific ONNX Runtime graph optimizations                      |
| **PEFT**             | LoRA / QLoRA, including diffusion LoRA                                     |
| **Model splitting**  | Shard large models across devices                                          |

Pass combinations are checked against your execution provider (for example, AWQ needs a GPU, OpenVINO IR needs OpenVINO, QAT conflicts with splitting).

### Execution providers

| Provider                         | Target hardware                       |
| -------------------------------- | ------------------------------------- |
| `CPUExecutionProvider`           | Broad compatibility                   |
| `CUDAExecutionProvider`          | NVIDIA GPUs                           |
| `TensorrtExecutionProvider`      | NVIDIA datacenter / full TensorRT SDK |
| `NvTensorRTRTXExecutionProvider` | Consumer GeForce RTX (TensorRT-RTX)   |
| `OpenVINOExecutionProvider`      | Intel CPU / GPU / NPU                 |
| `QNNExecutionProvider`           | Qualcomm Snapdragon NPU               |
| `ROCMExecutionProvider`          | AMD GPUs                              |
| `WebGpuExecutionProvider`        | In-browser GPU via ONNX Runtime Web   |

### Runtime intelligence

- **Hardware probe**: Detects available ORT providers and local NVIDIA / AMD / Intel / Qualcomm drivers, then recommends a default.
- **VRAM estimates**: Per-pass and provider memory guidance.
- **Recipe validation**: Structural schema, pipeline compatibility, pass-parameter checks, and Olive preflight (`--list_required_packages`) before spawn.
- **Auto dependency install**: On first run, creates `.venv/`, installs `olive-ai`, pins `onnxruntime-gpu`, and pulls CUDA 12 runtime / TensorRT / TensorRT-RTX packages when a GPU recipe needs them.
- **GPU launcher**: Preloads CUDA DLLs and works around Windows EP-registration issues with Olive 0.13+.
- **In-browser validation**: Smoke-test exported ONNX models in the browser with WebGPU or CPU.
- **WebGPU benchmark**: Measure browser GPU inference performance.
- **Batch queue**: Run and track multiple jobs with shared validation rules.
- **Diagnosis history**: Track MCP-assisted troubleshooting suggestions across sessions.
- **MCP diagnostics**: Query the bundled Olive MCP server for pass guidance, troubleshooting, and error workarounds.

### Developer experience

- **Recipe graph**: Visual pass pipeline with per-pass inspectors and conflict banners.
- **JSON editor**: Full Olive recipe export/import.
- **Export helpers**: Starter configs for ONNX Runtime Web / Mobile deployment.
- **AI Copilot** (optional): Recipe Q&A, advisory review, and state analysis via Gemini, OpenAI API, Anthropic, Mistral, xAI, OpenRouter, Groq, Together, **OpenAI Codex** (ChatGPT Plus/Pro sign-in via local Codex CLI), GitHub Copilot token, Kilo Gateway, or local LM Studio / Ollama.
- **Storybook**: Component development and visual testing.

---

## Quick start

### Prerequisites

- **Node.js** 22+ (pnpm 11 requirement)
- **pnpm** 11.17.0+ (the project uses `packageManager: pnpm@11.17.0`; `npm install` is blocked)
- **Python** 3.9+ (on `PATH`, or set from the app header **Runtime** control if missing)
- **Optional:** NVIDIA / Intel / Qualcomm / AMD tooling for GPU or NPU recipes
- **Optional:** [Hugging Face token](https://huggingface.co/settings/tokens) for gated models

If Python or Olive is not on the system PATH, open **Runtime** in the app header: save a path to `python.exe`, and optionally **Add project .venv to user PATH** so terminals outside the app can find Olive too.

### Install and run

```bash
git clone https://github.com/tonythethompson/Olive-Studio.git
cd Olive-Studio
pnpm install
pnpm dev
```

Open **<http://localhost:3000>**.

On the first **Execute Live** or batch run, the server creates `.venv/` in the project root and installs Olive automatically.

### Production build

```bash
pnpm build
pnpm start
# equivalent after build:
# node bin/cli.js
```

Open **<http://localhost:3000>**.

### Desktop app (Tauri, experimental)

Runs the same Node server inside a native window (WebView) instead of your browser.

**Extra prerequisites:** [Rust](https://rustup.rs/) toolchain, Windows WebView2 (usually preinstalled), Node 22+, Python 3.9+.

```bash
pnpm install
pnpm tauri:dev      # starts `pnpm dev` + native window → http://127.0.0.1:3000
# production-style package (Windows NSIS/MSI):
pnpm tauri:build
```

The desktop shell still requires **Node** and **Python** on `PATH` (Olive runs are not reimplemented in Rust). Browser/`pnpm start` remains fully supported.

> **Not published to npm.** Olive Studio is distributed via this GitHub repository and [GitHub Releases](https://github.com/tonythethompson/Olive-Studio/releases). It creates local Python virtualenvs and may install CUDA / TensorRT packages for GPU recipes — clone and run from source rather than expecting a public `npx` package.

---

## Typical workflow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│  Model / recipe │ ──▶ │  Hardware (EP)   │ ──▶ │  Graph or JSON      │
│  HuggingFace,   │     │  CUDA, OpenVINO, │     │  Validate → Run     │
│  catalog preset │     │  QNN, CPU, …     │     │  Stream logs (SSE)  │
└─────────────────┘     └──────────────────┘     └─────────────────────┘
```

1. Load a model or pick a **Starter Curated** recipe (fetched from [microsoft/olive-recipes](https://github.com/microsoft/olive-recipes)).
2. Select an execution provider that matches your hardware probe results.
3. Enable passes, resolve any conflict banners, then **Execute Live** or add to the batch queue.

---

## Environment variables

Create `.env` or `.env.local` in the project root:

| Variable                                                      | Required | Purpose                                 |
| ------------------------------------------------------------- | -------- | --------------------------------------- |
| `GEMINI_API_KEY`, `GOOGLE_API_KEY`, or `GOOGLE_GENAI_API_KEY` | No       | Gemini for AI Copilot / AI Review       |
| `HF_TOKEN`                                                    | No       | Hugging Face token passed to Olive runs |
| `OPENAI_API_KEY`                                              | No       | OpenAI / OpenAI-compatible providers    |
| `ANTHROPIC_API_KEY`                                           | No       | Anthropic Claude                        |
| `MISTRAL_API_KEY`                                             | No       | Mistral                                 |
| `XAI_API_KEY`                                                 | No       | xAI Grok                                |
| `OPENROUTER_API_KEY`                                          | No       | OpenRouter                              |
| `GROQ_API_KEY`                                                | No       | Groq                                    |
| `TOGETHER_API_KEY`                                            | No       | Together AI                             |

You can also set AI credentials in-app under **AI Copilot → Settings**.

---

## GPU notes (NVIDIA)

For CUDA / TensorRT recipes on Windows or Linux:

- The server pins `onnxruntime-gpu==1.26.0` and installs the matching CUDA 12 runtime wheels (`nvidia-cudnn-cu12`, `nvidia-cublas-cu12`, `nvidia-cuda-runtime-cu12`, and related packages) into `.venv`.
- **Classic TensorRT** (`tensorrt==10.9.0.34`) is installed when a recipe targets `TensorrtExecutionProvider`.
- **TensorRT RTX** (`tensorrt-rtx`) is installed for `NvTensorRTRTXExecutionProvider` recipes.
- Restart `pnpm dev` after server-side dependency changes so PATH and the GPU launcher pick up new packages.

---

## Scripts

| Command                 | Description                                     |
| ----------------------- | ----------------------------------------------- |
| `pnpm dev`              | Vite + Express development server               |
| `pnpm build`            | Production frontend + server bundle             |
| `pnpm start`            | Run `dist/server.cjs`                           |
| `pnpm test`             | Run Vitest unit tests                           |
| `pnpm test:coverage`    | Run Vitest with coverage                        |
| `pnpm test:watch`       | Run Vitest in watch mode                        |
| `pnpm lint`             | TypeScript typecheck and ESLint                 |
| `pnpm lint:quick`       | Fast lint with Oxlint                           |
| `pnpm validate:recipe`  | Recipe builder + schema smoke tests             |
| `pnpm generate:recipes` | Regenerate catalog from microsoft/olive-recipes |
| `pnpm deepcheck`        | Typecheck + Prettier + ESLint                   |
| `pnpm format`           | Format TS/TSX with Prettier                     |
| `pnpm format:check`     | Check Prettier formatting                       |
| `pnpm a11y:scan`        | Accessibility scan with Python tool             |
| `pnpm storybook`        | Start Storybook dev server                      |
| `pnpm build-storybook`  | Build static Storybook                          |

---

## Validation architecture

Olive Studio validates at several layers so bad recipes fail fast:

1. **Pipeline compatibility**: `src/lib/pipelineValidation.ts` (pass ↔ EP rules, auto-sanitize)
2. **Recipe structure**: `src/lib/oliveRecipeSchema.ts`
3. **Single builder**: `src/lib/recipePipeline.ts` (`buildRecipeFromState`)
4. **Server preflight**: JSON schema + `olive run --list_required_packages`
5. **In-browser validation**: Quick smoke test of exported ONNX models in the browser
6. **AI Review** (optional): `POST /api/ai/validate`; advisory only
7. **MCP diagnostics**: `POST /api/mcp/tool` for Olive MCP server-assisted troubleshooting

---

## MCP integration

The repository includes `olive-mcp-server/`, a Python MCP server that exposes Olive pass, hardware, troubleshooting, and compatibility tools.

- `.mcp.json` wires the server to Claude via `olive-mcp-server/run.py`.
- `server.ts` exposes `POST /api/mcp/tool` so the web UI can proxy tool calls.
- `MCPDiagnosticCard` renders MCP troubleshooting results inside the recipe workspace.

See [olive-mcp-server/README.md](olive-mcp-server/README.md) for setup and tool details.

---

## Project layout

```
Olive-Studio/
├── src/                    # React UI + shared recipe logic
│   ├── components/         # Panels, recipe graph, inspectors
│   ├── lib/                # Recipe builder, validation, hardware probe, MCP mapping
│   └── data/               # Generated olive-recipes catalog
├── server.ts               # Express API, Olive spawn, SSE logs, AI endpoints, MCP proxy
├── olive-mcp-server/       # Python MCP server for Olive guidance
├── scripts/                # Catalog generator, GPU launcher, smoke tests
├── bin/                    # Production CLI entrypoint
└── .venv/                  # Created on first Olive run (gitignored)
```

---

## Catalog maintenance

The **Starter Curated** tab lazy-loads recipes from GitHub. Device tags on cards are folder-inferred. After upstream catalog changes:

```bash
pnpm run generate:recipes
```

---

## CI

GitHub Actions runs on push/PR to `main` / `master`:

- `pnpm install --frozen-lockfile`
- `pnpm audit --audit-level high`
- `pnpm lint`
- `pnpm test`
- `pnpm validate:recipe`
- CodeQL analysis

See [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

---

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, conventions, and PR checklist.

---

## Related projects

- [Microsoft Olive](https://github.com/microsoft/Olive): optimization engine
- [microsoft/olive-recipes](https://github.com/microsoft/olive-recipes): official recipe catalog
- [ONNX Runtime](https://onnxruntime.ai/): inference runtime

---

## License

Copyright © 2026 Anthony Thompson.

Olive Studio is licensed under the [MIT License](LICENSE).

Microsoft Olive and related names are trademarks of Microsoft Corporation. This project is community tooling and is not affiliated with or endorsed by Microsoft.
