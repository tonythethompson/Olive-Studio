# Olive Studio — Project Steering

## Identity

Olive Studio is a local-first desktop web app (React 19 + Express + Vite 8) that provides a guided UI for Microsoft Olive model optimization. It wraps `olive-ai` CLI in a three-step pipeline: model source → hardware target → recipe & run.

- **Repo**: https://github.com/tonythethompson/olive-studio
- **License**: AGPL-3.0-or-later
- **Package manager**: pnpm (enforced via preinstall guard — `npm install` is blocked)
- **Node**: >=18
- **Language**: TypeScript (strict)

## Architecture

| Layer | Stack |
|-------|-------|
| UI | React 19, Tailwind CSS 4, Radix UI, Motion, Recharts, Lucide icons |
| State | Single Zustand store (`src/lib/stores/pipelineStore.ts` → `usePipelineStore`) |
| Server | Express 4, SSE log streaming, Vite dev middleware |
| Build | Vite 8 (client) + esbuild (server bundle → `dist/server.cjs`) |
| AI | Optional: Gemini, OpenAI, Anthropic, Mistral (user-provided keys) |
| Optimization | Python 3.9+, `olive-ai` in project `.venv` |

### Key patterns

- `UIState` (defined in `src/types.ts`) — all UI state mutations go through `commitUiStateUpdate` in `src/lib/pipelineValidation.ts`
- `usePipelineState()` shorthand hook; `replaceState` for recipe import / preset load
- Pipeline navigation: `src/lib/pipelineNavigation.ts` (module-level pub/sub singleton)
- Recipe pipeline: `src/lib/recipePipeline.ts` converts `UIState` → `OliveRecipe` JSON
- Schema validation: `src/lib/oliveRecipeSchema.ts`
- Pass metadata: `src/lib/passCatalog.ts` + `src/lib/passGuidance.ts`
- Quantization/pruning presets: `src/lib/quantPresets.ts`, `src/lib/pruningPresets.ts`
- One file per AI provider: `detect.ts` fingerprints provider from endpoint/model; `arena.ts` for parallel multi-provider

### UI pipeline steps

| Step | View ID | Panel |
|------|---------|-------|
| 01 | `input` | `InputEnvironmentPanel` — model source (HF/local/Azure) |
| 02 | `ihv` | `IHVIntegrationPanel` — execution provider + hardware |
| 03 | `execute` | `ExecutionWorkspace` + `BatchProcessingPanel` (lazy) |
| 04 | `playground` | In-browser inference, WebGPU benchmarks, Arena (lazy) |

`Dashboard` is a single scrollable page with 4 sections, sidebar nav, scroll-sync navigation via `CustomEvent('olive-studio:navigate')`.

### Server routes

Each route file exports a `mountXxxRoutes(router)` function wired into `server.ts`.

### `GeminiSidebar`

Lazy-loaded AI assistant panel toggled from the top header.

## Commands

```bash
pnpm dev                    # Express + Vite dev → http://localhost:3000
pnpm build                  # Vite + esbuild → dist/server.cjs
pnpm start                  # Serve production build
pnpm test                   # Unit tests (src/lib/)
pnpm test:watch             # Watch mode
pnpm lint                   # tsc --noEmit + eslint (exit 0 with warnings ≤20)
pnpm format                 # prettier --write src/**/*.{ts,tsx}
pnpm deepcheck              # tsc + prettier --check + eslint
pnpm validate:recipe        # tsx scripts/validate-recipe-builder.ts
pnpm a11y:scan              # python tools/a11y-scan.py src
```

## Conventions

- **`@` alias** resolves to `src/` in all vitest configs
- **No barrel exports** (`export *`) — hurts Vite tree-shaking and test isolation
- **ESLint**: `--max-warnings 0` in `pnpm eslint`; `pnpm lint` uses `--max-warnings 20`
- **Commits**: conventional commits enforced via commitlint + husky
- **No Olive live runs in CI/VM** — recipe building, JSON export, and validation are CPU-only; don't trigger "Execute Live" or batch runs
- **`python` alias**: `pnpm a11y:scan` calls `python`, not `python3` — ensure `python` on PATH
