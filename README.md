# Olive Studio

Olive Studio is a React + Express web app for authoring, validating, and running [Microsoft Olive](https://github.com/microsoft/Olive) optimization recipes. It covers model conversion, quantization, pruning, PEFT/LoRA, execution-provider selection, batch queueing, and optional AI-assisted review.

## Prerequisites

- **Node.js** 20+
- **Python** 3.9+ on `PATH` (used for real `olive run` execution)
- Optional: NVIDIA GPU + CUDA drivers for GPU recipes
- Optional: Hugging Face token for private/gated models

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:3000

On first **Execute Live** or batch run, the server creates `.venv/` in the project root and installs `olive-ai` automatically.

## Environment variables

Create a `.env` file in the project root (or use `.env.local`):

| Variable | Required | Purpose |
|----------|----------|---------|
| `GEMINI_API_KEY` or `GOOGLE_API_KEY` | No | Gemini for AI Copilot / AI Review |
| `HF_TOKEN` | No | Hugging Face token passed to Olive runs |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc. | No | Alternative AI providers (configure in sidebar Settings) |

You can also set AI provider credentials in the in-app **AI Copilot → Settings** panel at runtime.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite + Express dev server |
| `npm run build` | Production frontend build + server bundle |
| `npm run start` | Run production server (`dist/server.cjs`) |
| `npm run lint` | Typecheck (`tsc --noEmit`) |
| `npm run validate:recipe` | CI smoke test: recipe builder + schema validation |
| `npm run generate:recipes` | Regenerate `src/data/olive-recipes-catalog.ts` from [microsoft/olive-recipes](https://github.com/microsoft/olive-recipes) |

## Validation layers

1. **Pipeline compatibility** — shared rules in `src/lib/pipelineValidation.ts` (pass ↔ EP conflicts, auto-sanitize invalid combos)
2. **Recipe structure** — `src/lib/oliveRecipeSchema.ts` (UI, server, CI)
3. **Single builder** — `src/lib/recipePipeline.ts` (`buildRecipeFromState`) used by Execute, batch, and export
4. **Server preflight** — JSON parse + structural schema, then `olive run --list_required_packages` before spawning a full run
5. **AI Review** (optional) — `POST /api/ai/validate` from Execute panel; advisory only, requires AI credentials

## Catalog

The **Starter Curated** tab loads recipes lazily from GitHub. Architecture/device tags on catalog cards are **folder-inferred** (approximate). After upstream catalog changes, run:

```bash
npm run generate:recipes
```

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs typecheck and `npm run validate:recipe` on push/PR.

## License

Copyright © 2026 Anthony Thompson.

Olive Studio is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-or-later). See [LICENSE](LICENSE) for the full text.
