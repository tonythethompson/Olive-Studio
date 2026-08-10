---
inclusion: always
---

# Olive Studio — Development Conventions

## Branding

Do not call Olive Studio "local-first", "Local First", or "Local-First" in docs, UI, release notes, or comments. Prefer "local GUI", "runs on your machine", or "loopback-only" / "local-only" for access boundaries. Canonical rule: `.cursor/rules/no-local-first-branding.mdc`.

## Package Manager

Always use **pnpm** (v11.17). Never use `npm install` — a `preinstall` guard script blocks it and exits with an error. All commands: `pnpm install`, `pnpm add`, `pnpm dev`, etc.

## Testing Strategy

- **Do NOT run full test suites locally** on WSL or drive-mounted checkouts — they take tens of minutes to hours.
- **Push the branch and let GitHub Actions CI verify.** CI is the gate of record for PRs.
- For local development, prefer **targeted checks**: a single test file (`vitest run src/lib/myFile.test.ts`) or single-file lint.
- Never trigger actual Olive optimization ("Execute Live" / batch run) in tests — it downloads models + CUDA wheels.
- Recipe building, JSON export, and pipeline validation are the CPU-only testable flows.

### Test Commands

| Command | Scope |
|---------|-------|
| `pnpm test` | Unit tests (src/lib/) |
| `pnpm test:server` | Server unit tests (src/server/) |
| `pnpm test:integration` | Integration tests (mocked externals, real Express) |
| `pnpm test:component` | Component tests (jsdom, @testing-library/react) |
| `pnpm validate:recipe` | Recipe builder smoke test |
| `cd olive-mcp-server && python -m pytest tests -q` | Python MCP tests |

## Architecture Rules

### State Management
- All UI state flows through `usePipelineStore` (zustand) in `src/lib/stores/pipelineStore.ts`.
- Every `setState` call passes through `commitUiStateUpdate` which runs auto-coercion rules.
- Never mutate state directly — always use the store's `setState` or `replaceState`.

### Recipe Builder
- New optimization passes must add a `PassBuilder` entry in the `PASS_BUILDERS` map in `src/lib/oliveRecipeBuilder.ts`.
- Pass ordering is controlled by `preferredPassOrder()` — insert new passes at the correct pipeline position.
- Quantization methods use first-match dispatch via `QUANT_METHOD_BUILDERS` with optional `gate` predicates.

### Pipeline Validation
- Cross-pass compatibility rules go in `CROSS_PASS_RULES` array in `src/lib/pipelineValidation.ts` (declarative).
- Each rule declares `applies`, `fix`, `autoCoerce`, severity, and description — coercion and validation derive from the same source.
- Provider hardware conflicts live in `getProviderConflicts()`.

### AI Providers
- New providers register via `registerProvider(plugin)` at module import time in `src/server/services/ai/`.
- Never modify the registry Map directly — use the plugin interface.
- Provider files are side-effect imported in `src/server/services/ai/index.ts`.

### MCP Tools
- New tools must be added to both `_TOOL_IMPORTS` in `olive-mcp-server/olive_mcp_server/mcp_server.py` AND the allowlist in `src/server/services/mcp/allowedTools.ts`.
- The `mcp` pip package MUST be pinned `<2` — version 2.x removes `mcp.server.fastmcp` and breaks all imports.
- Tools are lazy-imported via `importlib` for startup performance.
- Knowledge base lives in `olive-mcp-server/olive_mcp_server/knowledge_base/`.

## Route Patterns

- **UI routes**: `/olive/...` — no agent policy checks, hides MCP-origin jobs.
- **Agent routes**: `/olive/agent/...` — requires agent-access policy, respects job source filtering.
- All POST routes MUST use `parseBody()` from `src/server/middleware/bodyGuard.ts`.
- Rate limiters are named and defined in `src/server/middleware/rateLimit.ts`.
- Loopback-only gates: `mcpToolLocalOnly` (MCP proxy), `studioLocalOnly` (agent policy), `studioRecipeLocalOnly` (recipe bridge).

## File Organization

```
src/components/features/{feature}/   Feature panels (React)
src/lib/stores/                      Zustand store (pipelineStore.ts)
src/lib/                             Recipe builder, validation, hooks, utilities
src/server/routes/                   Express route modules
src/server/services/                 AI providers, olive jobs, venv, MCP client
src/server/middleware/               bodyGuard, rateLimit, localOnly, cors
olive-mcp-server/                    Python FastMCP server (26 tools)
olive-mcp-server/olive_mcp_server/knowledge_base/   passes.json, hardware_profiles.json, etc.
src-tauri/                           Tauri 2 desktop shell (optional)
```

## Code Style

- Prefer `Record<string, unknown>` over `any`. No `@typescript-eslint/no-explicit-any` suppressions.
- Use `cn()` from `@/lib/utils` for conditional Tailwind class merging.
- Lazy load heavy panels with `React.lazy()` + `<Suspense>`.
- Pattern matching (task inference, model type) uses ordered lookup tables — first regex match wins, order is significant.
- ESLint allows up to 20 warnings (`--max-warnings 20`). Only non-zero exit or reported errors are failures.
- `pnpm lint:quick` (oxlint) for fast local feedback; `pnpm lint` (tsc + eslint) for full check.
