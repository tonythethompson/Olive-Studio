# Olive Studio Architecture Reference

## Data Flow

```
UIState (zustand) → commitUiStateUpdate (coercion) → buildOliveRecipe (memoized)
                                                    → getPipelineValidation (issues + recipe)
```

## Key Files

| Concern | File |
|---------|------|
| State store | `src/lib/stores/pipelineStore.ts` |
| Recipe builder | `src/lib/oliveRecipeBuilder.ts` |
| Pipeline validation | `src/lib/pipelineValidation.ts` |
| Default pass values | `src/lib/defaultPasses.ts` |
| UI types | `src/types.ts` |
| AI provider registry | `src/server/services/ai/registry.ts` |
| MCP client (Node) | `src/server/services/mcp/client.ts` |
| MCP server (Python) | `olive-mcp-server/olive_mcp_server/mcp_server.py` |
| Venv management | `src/server/services/venv/index.ts` |
| Job execution | `src/server/routes/olive.ts` |
| Hardware probe | `src/server/routes/system.ts` |

## Component Structure

- `src/components/features/input/` — Model source selection, recipe catalog
- `src/components/features/ihv/` — Hardware/EP configuration
- `src/components/features/execute/` — Recipe visualization, execution, batch jobs
- `src/components/features/playground/` — In-browser inference, WebGPU benchmarks, Arena
- `src/components/features/assistant/` — AI assistant sidebar (18+ providers)

## Server Architecture

- **Routes:** `ai/`, `mcp.ts`, `olive.ts`, `env.ts`, `system.ts`, `github.ts`, `arena.ts`
- **Services:** `ai/` (registry + 18 providers), `olive/` (jobs, GPU, agent access), `venv/` (multi-family), `mcp/` (client + breaker)
- **Middleware:** `bodyGuard.ts`, `rateLimit.ts`, `localOnly.ts`

## MCP Server

- 32 tools registered via lazy `_TOOL_IMPORTS` dict
- Knowledge base: `passes.json` (92 passes), `hardware_profiles.json` (22 profiles), `compatibility_matrix.json`, `troubleshooting.json`
- Transport: stdio (default) or SSE
- Launcher: `olive-mcp-server/run.py` — finds project venv, sets PYTHONPATH

## Quick Commands

| Task | Command | Notes |
|------|---------|-------|
| Dev server | `pnpm dev` | Express + Vite on http://localhost:3000 |
| Fast lint | `pnpm lint:quick` | oxlint (seconds) |
| Full lint | `pnpm lint` | tsc --noEmit + eslint |
| Unit tests | `pnpm test` | src/lib/ (vitest) |
| Server tests | `pnpm test:server` | src/server/ (vitest) |
| Integration tests | `pnpm test:integration` | Mocked externals, real Express |
| Component tests | `pnpm test:component` | jsdom, @testing-library/react |
| Recipe smoke | `pnpm validate:recipe` | Recipe builder validation |
| Python MCP tests | `cd olive-mcp-server && python -m pytest tests -q` | Requires venv with `mcp<2` |
| Build | `pnpm build` | Vite + esbuild → dist/ |
| Production start | `pnpm start` | Serves from dist/server.mjs |
| Bundle analysis | `ANALYZE=1 pnpm build` | Opens rollup-plugin-visualizer |

## Best Practices

- Always run `pnpm validate:recipe` after modifying the recipe builder
- Use `vitest run path/to/specific.test.ts` for targeted local testing
- Check `docs/Tech Debt & Issues.md` before starting large refactors
- CI passes are required before merge — don't fight slow local runs
- The MCP circuit breaker (3 failures → 30s cooldown) protects against subprocess spam
