# About Olive Studio

**Olive Studio** is a local-first desktop web app for building, validating, and running [Microsoft Olive](https://github.com/microsoft/Olive) optimization workflows without living in YAML and shell scripts.

Microsoft Olive is a powerful model-optimization toolkit — conversion to ONNX, quantization (PTQ, AWQ), pruning, LoRA/QLoRA, graph transforms, and deployment targeting across CPU, NVIDIA GPU, Intel OpenVINO, Qualcomm QNN, and AMD ROCm. Olive Studio wraps that capability in a guided three-step pipeline: **model source → hardware target → recipe & run**.

## Why it exists

Olive recipes are JSON documents with strict pass ordering, execution-provider constraints, and dependency chains. Getting them wrong usually means a long stderr trace, not a friendly UI hint. Olive Studio:

- **Maps your intent to valid Olive configs** — pass toggles, provider selection, and compatibility rules stay in sync.
- **Probes your machine** — detects ONNX Runtime execution providers, estimates VRAM, and flags impossible pass combinations before you click Run.
- **Runs Olive locally** — creates a Python `.venv`, installs `olive-ai` and GPU dependencies on demand, and streams logs over SSE.
- **Stays optional-cloud** — the core workflow needs no API keys. AI Copilot and AI Review are additive when you choose to enable them.

## Who it's for

- **ML engineers** shipping ONNX models to edge, mobile, or datacenter targets.
- **Hobbyists** with a consumer NVIDIA GPU who want curated recipes from [microsoft/olive-recipes](https://github.com/microsoft/olive-recipes) without manual JSON editing.
- **Teams** queuing batch optimization jobs with consistent validation rules across runs.

## What it is not

- A replacement for Microsoft Olive — it is a **front end and runner** on top of the official Olive CLI.
- A hosted training platform — PEFT/QAT paths assume you bring models and (where needed) datasets.
- A cloud service — runs execute on your machine; nothing is uploaded unless you configure external AI APIs.

## Technology

| Layer | Stack |
|-------|--------|
| UI | React 19, Tailwind CSS, Radix UI |
| Server | Express, Vite (dev), SSE log streaming |
| Optimization | Python 3.9+, `olive-ai` in project `.venv` |
| Optional AI | Gemini, OpenAI, Anthropic, Mistral (user-provided keys) |

## License & attribution

Olive Studio is **AGPL-3.0-or-later** — see [LICENSE](LICENSE).  
Microsoft Olive and related trademarks belong to Microsoft Corporation. This project is independent community tooling, not an official Microsoft product.

## Maintainer

Created by **Anthony Thompson** — [github.com/tonythethompson/Olive-Studio](https://github.com/tonythethompson/Olive-Studio)

---

### Suggested GitHub repository “About” settings

Paste these into **Repository → Settings → General → About** on GitHub:

| Field | Value |
|-------|--------|
| **Description** | Visual recipe builder and local runner for Microsoft Olive — ONNX conversion, quantization, pruning, and multi-vendor GPU/NPU deployment. |
| **Website** | *(leave blank or link to your demo/docs)* |
| **Topics** | `microsoft-olive` `onnx` `onnxruntime` `model-optimization` `quantization` `huggingface` `tensorrt` `openvino` `react` `local-first` `llm` `edge-ai` |
