# Project Structure

```
olive-studio/
├── server.ts                       Express entry point (modular routes)
├── index.html                      Vite HTML entry
├── vite.config.ts                  Vite + React + TailwindCSS config
├── vitest.config.ts                Unit test config (src/lib/)
├── vitest.server.config.ts         Server test config (src/server/)
├── vitest.integration.config.ts    Integration test config
├── vitest.component.config.ts      Component test config (jsdom)
├── eslint.config.js                ESLint flat config
├── tsconfig.json                   TypeScript config
│
├── src/
│   ├── App.tsx                     Root React component
│   ├── main.tsx                    Vite client entry
│   ├── types.ts                    Shared frontend types
│   │
│   ├── components/
│   │   ├── features/               Feature panels (React, zustand-connected)
│   │   │   ├── assistant/          AI assistant chat UI
│   │   │   ├── execute/            Job execution panels
│   │   │   ├── ihv/                IHV (hardware vendor) panels
│   │   │   ├── input/              Model input configuration
│   │   │   └── playground/         Inference playground
│   │   └── ui/                     Shared UI primitives (Radix-based)
│   │
│   ├── lib/
│   │   ├── stores/                 Zustand store (pipelineStore.ts is the single source of truth)
│   │   ├── hooks/                  React hooks
│   │   ├── types/                  Type definitions
│   │   ├── oliveRecipeBuilder.ts   Builds Olive JSON recipes from UI state
│   │   ├── pipelineValidation.ts   Cross-pass validation rules (declarative)
│   │   ├── pipelineStateCommit.ts  Auto-coercion via commitUiStateUpdate()
│   │   ├── aiResponse.ts           AI response parsing
│   │   ├── passCatalog.ts          Pass metadata catalog
│   │   ├── utils.ts                cn() and shared utilities
│   │   └── __tests__/              Unit test files
│   │
│   └── server/
│       ├── config.ts               Server configuration
│       ├── routes/                  Express route modules
│       │   ├── ai/                 AI provider routes
│       │   ├── arena.ts            Arena inference routes
│       │   ├── env.ts              Environment/config routes
│       │   ├── github.ts           GitHub integration routes
│       │   ├── mcp.ts              MCP proxy routes
│       │   ├── olive.ts            Olive job routes (run, status, stream, cancel)
│       │   ├── system.ts           System info/health routes
│       │   └── tensorrt.ts         TensorRT-specific routes
│       ├── services/
│       │   ├── ai/                 AI provider plugins (20+ providers, plugin registry)
│       │   ├── arena/              Arena/inference services
│       │   ├── mcp/                MCP client and allowed tools
│       │   ├── olive/              Olive job management, venv orchestration
│       │   ├── playground/         Playground inference services
│       │   └── venv/               Python virtual environment management
│       ├── middleware/             bodyGuard, rateLimit, localOnly, cors
│       ├── shared/                 Shared server utilities
│       └── __tests__/              Server integration tests
│
├── olive-mcp-server/               Python FastMCP stdio server
│   ├── olive_mcp_server/           Package source
│   │   ├── mcp_server.py           Server + tool registry (_TOOL_IMPORTS)
│   │   └── knowledge_base/         passes.json, hardware_profiles.json, etc.
│   ├── tests/                      pytest tests
│   ├── scripts/                    Utility scripts (smoke, benchmark, build index)
│   ├── schemas/                    JSON schemas for tools
│   ├── run.py                      MCP server entry point
│   └── pyproject.toml              Python package config
│
├── src-tauri/                      Tauri 2 desktop shell (optional)
├── bin/                            CLI entry (olive-studio command)
├── scripts/                        Build/validation scripts
├── docs/                           Documentation
├── e2e/                            Playwright end-to-end tests
├── tools/                          Dev utilities (a11y-scan, etc.)
├── config/                         App configuration files
├── data/                           Static data assets
└── public/                         Static public assets
```

## Key Architectural Patterns

- **State:** All UI state flows through `usePipelineStore` (Zustand). Every `setState` passes through `commitUiStateUpdate` for auto-coercion.
- **Recipe builder:** Pass ordering controlled by `preferredPassOrder()`. New passes need a `PassBuilder` entry in `PASS_BUILDERS`.
- **Validation:** Cross-pass rules are declarative in `CROSS_PASS_RULES` array — coercion and validation derive from the same source.
- **AI providers:** Register via `registerProvider(plugin)` at import time. Side-effect imported in `src/server/services/ai/index.ts`.
- **MCP tools:** Must be added to both `_TOOL_IMPORTS` in Python AND `allowedTools.ts` on the Node side.
- **Routes:** UI routes at `/olive/...`, agent routes at `/olive/agent/...` (with policy checks). All POST routes use `parseBody()`.
