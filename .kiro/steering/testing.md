# Testing Conventions

## Test suites

| Command | Scope | Config |
|---------|-------|--------|
| `pnpm test` | Unit tests (src/lib/) | `vitest.config.ts` |
| `pnpm test:server` | Server unit tests (src/server/) | `vitest.server.config.ts` |
| `pnpm test:integration` | Integration (real Express, mocked externals) | `vitest.integration.config.ts` |
| `pnpm test:component` | Component tests (jsdom + @testing-library/react) | `vitest.component.config.ts` |
| `pnpm test:coverage` | Coverage report | `vitest.config.ts` |
| `pnpm test:coverage:threshold` | Coverage with gates (90% lines, 88% stmts, 80% branches, 85% functions) | `vitest.config.ts` |

## Running a single test

```bash
pnpm vitest run src/lib/__tests__/someFile.test.ts
pnpm vitest run --config vitest.server.config.ts src/server/routes/some.test.ts
pnpm vitest run --config vitest.component.config.ts src/components/SomeComponent.test.tsx
```

## Integration test setup

Integration tests start a real Express server on a random port. `src/server/__tests__/setup.integration.ts` mocks `child_process`, AI providers, and `fetch`.

## Rules

- The `@` alias resolves to `src/` in vitest configs
- No barrel imports in test files — import from the actual module
- Never trigger Olive live execution in tests — only test recipe building, JSON export, validation
