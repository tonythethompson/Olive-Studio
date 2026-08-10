# Olive Studio v0.1.0

Olive Studio is a local-first GUI for [Microsoft Olive](https://github.com/microsoft/Olive) ONNX model optimization. Configure model sources, hardware targets, and optimization passes visually — then execute locally without cloud dependencies. Ships with an AI assistant (20 providers), hardware validation with one-click autofix, and an MCP server for agent-driven workflows.

## Key Features

- **Visual recipe builder** — drag-and-drop optimization pipeline with live validation and pass graph
- **8 hardware targets** — CPU, CUDA, TensorRT, TensorRT RTX, ROCm, OpenVINO, QNN, DirectML with autofix
- **Real Olive execution** — venv auto-creation, SSE log streaming, batch job queue with cancellation
- **20 AI providers** — Gemini, OpenAI, Anthropic, Mistral, xAI, OpenRouter, Groq, local engines (Ollama, LM Studio), and more
- **MCP server** — 27 tools for pass catalog, strategy advice, troubleshooting, and recipe validation
- **Pipeline validation** — cross-pass compatibility rules, parameter constraints, auto-coercion
- **Export formats** — Olive JSON config, OWR Web/Mobile Runtime config

## Quick Start

```bash
git clone --branch v0.1.0 --depth 1 https://github.com/tonythethompson/Olive-Studio.git
cd Olive-Studio && pnpm install
pnpm dev
```

Open http://localhost:3000. No account or API key required for recipe building and local execution.

To follow `main` instead of this tagged release, omit `--branch v0.1.0`.

### Updating from a tagged clone

`--branch v0.1.0` checks out a tag (detached HEAD). `git pull` will not move you to a newer release. Fetch and check out the next tag instead:

```bash
git fetch --depth 1 origin tag v0.2.0
git checkout v0.2.0
pnpm install
```

Or clone `main` if you want continuous updates with `git pull`.

## Requirements

- Node.js >= 22.16
- pnpm >= 11.17
- Python >= 3.10 (for Olive execution and MCP server)

## Known Limitations

- **No Tauri installer** — desktop app builds but is unsigned (SmartScreen warnings on Windows)
- **MCP subprocess latency** — first MCP tool call has ~2s cold start (Python stdio)
- **Unsigned builds** — no code-signing certificate yet; Windows/macOS may flag the binary
- **No auto-update** — from a tagged clone, fetch and check out a newer tag (see above); do not rely on `git pull`

## What's Next

See [ROADMAP.md](./ROADMAP.md) for later plans. v0.2.0 is published: use the update commands above or the [v0.2.0 release notes](./release-notes-v0.2.0.md).

## License

MIT
