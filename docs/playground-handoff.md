# Playground Tab — status handoff

Specs originally lived under `.kiro/specs/playground-tab/` (requirements, design, tasks, HANDOFF). That tree was untracked via `.gitignore` on main; this note tracks ship status for core Req 1–10.

## Core (Req 1–10) — implemented + verified

| Area | Status |
| --- | --- |
| Nav / `pipelineNavigation` / App wiring | Done |
| `playgroundStore` (session-scoped, no `persist`) | Done |
| Arena cloud proxy + SSRF boundary | Done |
| `PlaygroundPanel` / `ArenaPanel` / ExecutionWorkspace cleanup | Done |
| Unit tests (navigation, store, arena constants, local inference) | Done |
| Server arena tests | Done |
| Component tests (Tasks 11.1–11.5) | Done — co-located under `src/components/features/*.test.tsx` |
| PBT suite Properties 1, 4, 6, 13 | Done — pure helpers in `src/lib/__tests__/playgroundPBT.test.ts` |
| Property 3 (blank cloud prompt blocks run) | Done — helper PBT (`isArenaPromptBlank` ⇔ `trim()`) + behavior component test (cloud slot, blank prompt does not start fetch; prior results preserved) |
| Property 7 (new run clears prior outputs) | Done — helper PBT (clear replaces any prior slot pair) + behavior component test (second run drops prior outputs before inference) |

Parent tasks **6** and **7** are complete (all sub-items landed). Checkpoint **8** / **13**: lint green (warnings only); unit + server + component + `validate:recipe` green on Windows after:

- POSIX path expectations in `arenaOliveOutputs` unit tests
- Cloudflare credential isolation mocks in `detect.test.ts` / `registry.test.ts`

## Req 18 (partial)

| Piece | Status |
| --- | --- |
| Path helpers + Olive-output scan + list/file routes | Done |
| Properties 20 / 20b (server PBT) | Done |
| `GET /arena/assistant-cloud-snapshot` | **Not done** (Track 2) |
| ArenaPanel “From Olive outputs” / Assistant snapshot UI | **Not done** (Track 2) |
| Properties 21 / 21b / 22 | **Not done** (Track 2) |

## Deferred (not in core ship)

- Req 11 — benchmark input profiles
- Req 12 — MCP KB via GeminiSidebar
- Req 13–15 — scoring + quality vote + baseline download (no tasks yet)
- Req 16–17 — run history + recommendations
