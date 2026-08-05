# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev                    # Express + Vite dev server → http://localhost:3000
pnpm build                  # Vite build + esbuild server bundle → dist/server.mjs
pnpm start                  # Serve production build

pnpm test                   # Unit tests (src/lib/)
pnpm test:server            # Server unit tests (src/server/)
pnpm test:integration       # Integration tests (real Express, mocked externals)
pnpm test:component         # Component tests (jsdom + @testing-library/react)
pnpm test:watch             # Watch mode

pnpm lint                   # tsc --noEmit + eslint (exit 0 with warnings ≤20)
pnpm lint:quick             # oxlint fast pass (no type-check)
pnpm format                 # prettier --write src/**/*.{ts,tsx}

# Single test file
pnpm vitest run src/lib/__tests__/someFile.test.ts
pnpm vitest run --config vitest.server.config.ts src/server/routes/some.test.ts

# Python MCP server tests
cd olive-mcp-server && python -m pytest tests -q
```

**Always use pnpm** — `npm install` is blocked by a preinstall guard.

## Architecture

### Process model

`server.ts` is the Express entry point. In dev (`pnpm dev` via tsx), Vite runs as middleware. In production (`pnpm start`), it serves `dist/` statically. The server starts on port 3000; detection of prod vs dev is based on `process.argv[1]` ending in `dist/server.mjs`, not solely `NODE_ENV`.

### API routes (`src/server/routes/`)

Each route file exports a `mountXxxRoutes(router)` function wired into `server.ts`:

| Route file  | Prefix | Purpose                                       |
| ----------- | ------ | --------------------------------------------- |
| `ai.ts`     | `/api` | Streaming chat with 14+ AI providers          |
| `mcp.ts`    | `/api` | Proxy to Python MCP server, KB sync           |
| `olive.ts`  | `/api` | Olive optimization runs, job registry, cancel |
| `system.ts` | `/api` | Hardware probe, GPU/TensorRT detection        |
| `env.ts`    | `/api` | Runtime environment / API key management      |
| `github.ts` | `/api` | Recipe proxy from GitHub                      |
| `arena.ts`  | `/api` | Model arena / comparison                      |

### Frontend pipeline (`src/App.tsx`)

`Dashboard` is a single scrollable page with 4 sections navigated by scroll-sync and a sidebar nav. Navigation between sections uses a CustomEvent (`olive-studio:navigate`) dispatched from anywhere and handled in `App.tsx`.

| Step | View ID      | Panel                                                   |
| ---- | ------------ | ------------------------------------------------------- |
| 01   | `input`      | `InputEnvironmentPanel` — model source (HF/local/Azure) |
| 02   | `ihv`        | `IHVIntegrationPanel` — execution provider + hardware   |
| 03   | `execute`    | `ExecutionWorkspace` + `BatchProcessingPanel` (lazy)    |
| 04   | `playground` | In-browser inference, WebGPU benchmarks, Arena (lazy)   |

`GeminiSidebar` is a lazy-loaded AI assistant panel toggled from the top header.

### State management

Single Zustand store: `src/lib/stores/pipelineStore.ts` → `usePipelineStore`.

All UI state is `UIState` (defined in `src/types.ts`). Every state mutation goes through `commitUiStateUpdate` (in `src/lib/pipelineValidation.ts`) to enforce invariants. Use `usePipelineState()` shorthand hook; `replaceState` for recipe import / preset load.

`src/lib/pipelineNavigation.ts` maintains a separate module-level running-state singleton (pub/sub, not Zustand) — used to block navigation while an Olive job is active.

### Recipe building

`src/lib/recipePipeline.ts` converts `UIState` → `OliveRecipe` JSON (the Olive config format). Schema validation is in `src/lib/oliveRecipeSchema.ts`. Pass metadata lives in `src/lib/passCatalog.ts` and `src/lib/passGuidance.ts`. Quantization/pruning presets are in `src/lib/quantPresets.ts` and `src/lib/pruningPresets.ts`.

### AI providers (`src/server/services/ai/`)

One file per provider (anthropic, gemini, codex, devin, openai-compat, etc.). `detect.ts` fingerprints the provider from the configured endpoint/model. The `arena.ts` route uses multiple providers in parallel.

### Python MCP server (`olive-mcp-server/`)

Optional stdio FastMCP server — 14 tools, 84 passes, 14 hardware profiles. The web app proxies to it via `POST /api/mcp/tool`. Registered for AI coding agents via `.mcp.json` at repo root.

Setup:

```bash
cd olive-mcp-server
python -m venv .venv
.venv/Scripts/pip install -e ".[dev]" "mcp<2"   # Windows
# .venv/bin/pip install -e ".[dev]" "mcp<2"     # Linux/macOS
```

**`mcp` must be pinned `<2`** — version 2.x removes `mcp.server.fastmcp` and breaks all imports.

### Tauri (`src-tauri/`)

Tauri 2 shell for desktop packaging — optional. The app runs fine as a plain web server. `pnpm tauri:dev` / `pnpm tauri:build` for the desktop path.

## Testing tiers

| Config                         | Scope                                             | Env   |
| ------------------------------ | ------------------------------------------------- | ----- |
| `vitest.config.ts`             | `src/lib/**` unit tests                           | node  |
| `vitest.server.config.ts`      | `src/server/**` unit tests                        | node  |
| `vitest.integration.config.ts` | Integration — real Express, all externals mocked  | node  |
| `vitest.component.config.ts`   | React components — jsdom + @testing-library/react | jsdom |

Integration tests start a real Express server on a random port. `src/server/__tests__/setup.integration.ts` mocks `child_process`, AI providers, and `fetch`.

The `@` alias resolves to `src/` in all vitest configs.

## Gotchas

- **ESLint exit code**: `pnpm lint` runs `eslint --max-warnings 20` and exits 0 with ≤20 warnings. Only a non-zero exit or `error`-level findings are actual failures.
- **No real Olive runs in CI/VM**: Recipe building, JSON export, and validation are CPU-only. Do NOT trigger "Execute Live" or batch runs in CI — they download models and CUDA wheels.
- **`python` alias**: `pnpm a11y:scan` calls `python`, not `python3`. Ensure `python` is on PATH.
- **Barrel imports**: Avoid `export *` barrel files — Vite tree-shaking and component test isolation both suffer. Import from the actual module file.
- **React 19 + Vite 8**: Both are at major versions with breaking changes from prior conventions. Check Context7 docs before assuming API shapes.
