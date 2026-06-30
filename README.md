# Olive Studio

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](package.json)
[![CI](https://github.com/tonythethompson/Olive-Studio/actions/workflows/ci.yml/badge.svg)](https://github.com/tonythethompson/Olive-Studio/actions/workflows/ci.yml)

**A visual recipe builder and local runner for [Microsoft Olive](https://github.com/microsoft/Olive).**  
Author ONNX optimization pipelines — conversion, quantization, pruning, LoRA, and graph transforms — then execute them on your hardware with live logs, dependency auto-install, and validation before the run starts.

> **Local-first.** No cloud account required for optimization runs. Optional AI Copilot uses your own API keys.

[About Olive Studio](ABOUT.md) · [Microsoft Olive docs](https://microsoft.github.io/Olive/) · [Olive recipes catalog](https://github.com/microsoft/olive-recipes)

---

## Features

### Guided pipeline (3 steps)

1. **Model source** — Hugging Face model ID, local files, Azure ML path, or a starter recipe from the curated catalog.
2. **Hardware** — Pick an execution provider; the app probes ONNX Runtime and surfaces only what your machine can run.
3. **Recipe & run** — Edit passes in a graph or JSON view, validate, execute live, export, or queue batch jobs.

### Optimization passes

| Pass | What it does |
|------|----------------|
| **Graph conversion** | PyTorch → ONNX (or OpenVINO IR on Intel EP) |
| **Quantization** | PTQ (static ONNX), AWQ (`AutoAWQQuantizer`), precision INT8/INT4/FP16 |
| **Pruning** | Magnitude, SparseGPT, Wanda — structured or unstructured |
| **ORT transforms** | Transformer-specific ONNX Runtime optimizations |
| **PEFT** | LoRA / QLoRA, including diffusion LoRA |
| **Model splitting** | Shard large models across devices |

Pass combinations are checked against your execution provider (e.g. AWQ requires GPU, OpenVINO IR requires OpenVINO EP, QAT conflicts with splitting).

### Execution providers

| Provider | Target hardware |
|----------|-----------------|
| `CPUExecutionProvider` | Broad compatibility |
| `CUDAExecutionProvider` | NVIDIA GPUs |
| `TensorrtExecutionProvider` | NVIDIA datacenter / full TensorRT SDK |
| `NvTensorRTRTXExecutionProvider` | Consumer GeForce RTX (TensorRT-RTX) |
| `OpenVINOExecutionProvider` | Intel CPU / GPU / NPU |
| `QNNExecutionProvider` | Qualcomm Snapdragon NPU |
| `ROCMExecutionProvider` | AMD GPUs |

### Runtime intelligence

- **Hardware probe** — Detects available ORT providers and recommends a default.
- **VRAM estimates** — Rough memory guidance per pass and provider.
- **Recipe validation** — Structural schema, pipeline compatibility, and Olive preflight (`--list_required_packages`) before spawn.
- **Auto dependency install** — On first run, creates `.venv/`, installs `olive-ai`, pins `onnxruntime-gpu`, and pulls CUDA/cuDNN/TensorRT packages when a GPU recipe needs them.
- **GPU launcher** — Preloads CUDA DLLs and works around Windows EP-registration issues with Olive 0.13+.

### Developer experience

- **Recipe graph** — Visual pass pipeline with per-pass inspectors.
- **JSON editor** — Full Olive recipe export/import.
- **Batch queue** — Run multiple jobs with shared validation rules.
- **ONNX Runtime Web/Mobile export helpers** — Starter configs for OWR deployment.
- **AI Copilot** (optional) — Recipe Q&A and advisory review via Gemini, OpenAI, Anthropic, or Mistral.

---

## Quick start

### Prerequisites

- **Node.js** 18+ (20+ recommended)
- **Python** 3.9+ on `PATH` (used for `olive run`)
- **Optional:** NVIDIA / Intel / Qualcomm tooling for GPU or NPU recipes
- **Optional:** [Hugging Face token](https://huggingface.co/settings/tokens) for gated models

### Install and run

```bash
git clone https://github.com/tonythethompson/Olive-Studio.git
cd Olive-Studio
npm install
npm run dev
```

Open **http://localhost:3000**

On the first **Execute Live** or batch run, the server creates `.venv/` in the project root and installs Olive automatically.

### Production build

```bash
npm run build
npm run start
```

Or use the CLI entrypoint after build:

```bash
npx olive-studio
```

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

| Variable | Required | Purpose |
|----------|----------|---------|
| `GEMINI_API_KEY` or `GOOGLE_API_KEY` | No | Gemini for AI Copilot / AI Review |
| `HF_TOKEN` | No | Hugging Face token passed to Olive runs |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `MISTRAL_API_KEY` | No | Alternative AI providers |

You can also set AI credentials in-app under **AI Copilot → Settings**.

---

## GPU notes (NVIDIA)

For CUDA / TensorRT recipes on Windows or Linux:

- The server pins a stable **onnxruntime-gpu** build and installs **nvidia-cudnn-cu12** and related CUDA 12 runtime wheels into `.venv`.
- **Classic TensorRT** (`tensorrt==10.9.0.34`) is installed when a recipe targets `TensorrtExecutionProvider`.
- **TensorRT RTX** (`tensorrt-rtx` pip) is installed for `NvTensorRTRTXExecutionProvider` recipes.
- Restart `npm run dev` after server-side dependency changes so PATH and the GPU launcher pick up new packages.

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite + Express development server |
| `npm run build` | Production frontend + server bundle |
| `npm run start` | Run `dist/server.cjs` |
| `npm run lint` | Typecheck (`tsc --noEmit`) |
| `npm run validate:recipe` | Recipe builder + schema smoke tests |
| `npm run generate:recipes` | Regenerate catalog from microsoft/olive-recipes |

---

## Validation architecture

Olive Studio validates at several layers so bad recipes fail fast:

1. **Pipeline compatibility** — `src/lib/pipelineValidation.ts` (pass ↔ EP rules, auto-sanitize)
2. **Recipe structure** — `src/lib/oliveRecipeSchema.ts`
3. **Single builder** — `src/lib/recipePipeline.ts` (`buildRecipeFromState`)
4. **Server preflight** — JSON schema + `olive run --list_required_packages`
5. **AI Review** (optional) — `POST /api/ai/validate`; advisory only

---

## Project layout

```
Olive-Studio/
├── src/                    # React UI + shared recipe logic
│   ├── components/         # Panels, recipe graph, inspectors
│   ├── lib/                # Recipe builder, validation, hardware probe
│   └── data/               # Generated olive-recipes catalog
├── server.ts               # Express API, Olive spawn, SSE logs
├── scripts/                # Catalog generator, GPU launcher, smoke tests
└── .venv/                  # Created on first Olive run (gitignored)
```

---

## Catalog maintenance

The **Starter Curated** tab lazy-loads recipes from GitHub. Device tags on cards are folder-inferred. After upstream catalog changes:

```bash
npm run generate:recipes
```

---

## CI

GitHub Actions runs on push/PR to `main` / `master`:

- `npm run lint` (TypeScript)
- `npm run validate:recipe` (recipe builder smoke test)

See [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

---

## Contributing

Issues and pull requests are welcome. Please keep changes focused and run `npm run lint` and `npm run validate:recipe` before opening a PR.

---

## Related projects

- [Microsoft Olive](https://github.com/microsoft/Olive) — optimization engine
- [microsoft/olive-recipes](https://github.com/microsoft/olive-recipes) — official recipe catalog
- [ONNX Runtime](https://onnxruntime.ai/) — inference runtime

---

## License

Copyright © 2026 Anthony Thompson.

Olive Studio is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-or-later). Network use of a modified version must make corresponding source available under the same license.

Microsoft Olive and related names are trademarks of Microsoft Corporation. This project is community tooling and is not affiliated with or endorsed by Microsoft.
