---
name: olive-test-runner
description: Run and write tests for Olive Studio. Use when running any of the five test tiers (unit, server, integration, component, MCP pytest), running a single test file, writing new tests, or deciding whether to run suites locally vs push to CI.
---

# Olive Test Runner

Olive Studio has **five independent test tiers**, each with its own config and command. The biggest mistake is running the full suites locally in WSL/drive-mounted checkouts — they take tens of minutes to hours. Push the branch and let GitHub Actions verify.

## Test Tier Matrix

| Command | Scope | Config file |
|---------|-------|-------------|
| `pnpm test` | Unit tests (`src/lib/`) | `vitest.config.ts` |
| `pnpm test:server` | Server unit tests (`src/server/`) | `vitest.server.config.ts` |
| `pnpm test:integration` | Integration (real Express, mocked externals) | `vitest.integration.config.ts` |
| `pnpm test:component` | Component tests (jsdom + @testing-library/react) | `vitest.component.config.ts` |
| `cd olive-mcp-server && python -m pytest tests -q` | Python MCP tools | `olive-mcp-server/tests/` |

Coverage: `pnpm test:coverage` (report) and `pnpm test:coverage:threshold` (gates: 90% lines, 88% stmts, 80% branches, 85% functions).

## Local Strategy — Targeted, Not Total

Prefer a **single file or tier**, not the whole matrix:

```bash
# One unit test file
pnpm vitest run src/lib/__tests__/oliveRecipeBuilder.test.ts

# One server test file
pnpm vitest run --config vitest.server.config.ts src/server/routes/olive.test.ts

# One component test
pnpm vitest run --config vitest.component.config.ts src/components/features/SomePanel.test.tsx

# One Python test
cd olive-mcp-server && .venv/bin/python -m pytest tests/test_passes.py -q
```

Run a full **tier** locally only when it's small and fast (usually `pnpm test` on `src/lib/`). For integration / component / the full matrix, push the branch and let CI run it.

## CI Is the Gate of Record

`.github/workflows/ci.yml` runs in order:

```
lint → unit tests → server tests → integration tests → component tests
     → recipe validation → build → artifact assert → prod smoke → CodeQL
```

A separate `python-tests` job runs MCP pytest; `docker-build` builds + smoke-runs the MCP server image.

**GitHub Actions is the gate of record for PRs.** The full suites are very slow on WSL/drive-mounted checkouts; push the branch and let CI verify instead of running the full suites locally.

## Quick Checks (always safe, fast)

```bash
pnpm lint:quick           # oxlint on src/  (fast)
pnpm validate:recipe      # recipe builder smoke test (CPU-only)
pnpm test                 # src/lib unit tests (usually fast)
```

`pnpm lint` (full) runs `tsc --noEmit && eslint --max-warnings 0` — **any warning is a failure**, same as an error. ESLint warnings fail the build.

## Integration Test Setup

Integration tests start a **real Express server** on a random port. `src/server/__tests__/setup.integration.ts` mocks `child_process`, AI providers, and `fetch`. Externals are mocked; the Express server is real.

## Writing Tests — Rules

- The `@` alias resolves to `src/` in vitest configs
- **No barrel imports** in test files — import from the actual module (e.g. `import { buildRecipe } from "@/lib/oliveRecipeBuilder"`, not `from "@/lib"`)
- **Never trigger live Olive execution** in tests — only test recipe building, JSON export, and validation. No `submit_optimization_job` / `execute_and_observe` / "Execute Live".
- Do not put `pnpm install` in `.serena/project.yml` activation.

## Python (MCP server) Notes

- `mcp` must be pinned `<2` — v2.x removes `mcp.server.fastmcp` and breaks imports
- Install: `cd olive-mcp-server && .venv/bin/pip install -e ".[dev]" "mcp<2"`
- Run: `cd olive-mcp-server && .venv/bin/python -m pytest tests -q`
- `pnpm a11y:scan` invokes `python` (not `python3`) — ensure `python` is on PATH
