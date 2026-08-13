# Tech Stack & Build System

## Core Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 8, TailwindCSS 4, Zustand 5 |
| Backend | Express 5 (Node.js >=22.16), TypeScript ~6.0 |
| Desktop shell | Tauri 2 (optional sidecar) |
| MCP server | Python >=3.10, FastMCP (stdio) |
| Testing | Vitest 4, Playwright, Testing Library, pytest |

## Package Manager

**pnpm 11.17** — mandatory. A `preinstall` guard script blocks `npm install` and exits with an error. Always use `pnpm install`, `pnpm add`, `pnpm dev`, etc.

## Key Libraries

- **UI:** Radix UI primitives, Lucide icons, clsx + tailwind-merge (`cn()` utility)
- **State:** Zustand (single store: `pipelineStore.ts`)
- **Data fetching:** TanStack React Query
- **Server:** Express with Helmet, express-rate-limit, express-static-gzip
- **AI inference:** @huggingface/transformers, onnxruntime-web
- **Linting:** ESLint 9 + oxlint (quick), Prettier, commitlint (conventional commits)
- **Storybook:** v8.6 for component development

## Common Commands

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Express + Vite dev server on http://localhost:3000 |
| `pnpm build` | Vite build + esbuild server bundle → `dist/server.mjs` |
| `pnpm start` | Serve production build on port 3000 |
| `pnpm lint` | `tsc --noEmit` + eslint (max 20 warnings allowed) |
| `pnpm lint:quick` | oxlint — fast local feedback |
| `pnpm test` | Unit tests (`src/lib/`) |
| `pnpm test:server` | Server unit tests (`src/server/`) |
| `pnpm test:integration` | Integration tests (mocked externals, real Express) |
| `pnpm test:component` | Component tests (jsdom, @testing-library/react) |
| `pnpm validate:recipe` | Recipe builder smoke test |
| `pnpm format` | Prettier write |
| `pnpm format:check` | Prettier check |

## Testing Strategy

- **Do NOT run full test suites locally** — they are very slow on WSL/drive-mounted checkouts.
- Push the branch and let **GitHub Actions CI verify** (gate of record for PRs).
- Locally, prefer **targeted checks**: a single test file or single-file lint.
- Never trigger actual Olive optimization in tests — it downloads models + CUDA wheels.
- Recipe building, JSON export, and pipeline validation are the CPU-only testable flows.

## MCP Server (Python)

```bash
cd olive-mcp-server
python -m venv .venv
.venv\Scripts\pip install -e ".[dev]" "mcp<2"
.venv\Scripts\python -m pytest tests -q
```

**Important:** The `mcp` pip package must be pinned `<2` — version 2.x removes `mcp.server.fastmcp` and breaks all imports.

## Gotchas

- ESLint exits 0 with up to 20 warnings — only non-zero exit or reported errors are failures.
- `pnpm a11y:scan` invokes `python` (not `python3`); ensure `python` is on PATH.
- Integration tests mock child_process, AI providers, and fetch; they start a real Express server on a random port.
