# Handoff: Playground Tab

## Read first, in order

1. `requirements.md` — 18 requirements. 1–10 are core (nav, Browser Test/Benchmark promotion, Arena). 11 is Benchmark input profiles. 12 is MCP knowledge integration (optional, decoupled; rewritten this session to route through the sidebar's Audit tab rather than an inline card — see "Known decisions"). 13–14 are Benchmark/Arena scoring. 15 is baseline model download. 16–17 are run history + recommendations (server-persisted, new). 18 is Arena slot convenience sources (Olive outputs picker + active Assistant OpenAI-compat snapshot; Task 19).
2. `design.md` — architecture, data models, correctness properties (22 total; Properties 20–22 cover Req 18), and several "why not X" sections worth reading before second-guessing the approach (see Known decisions below).
3. `tasks.md` — implementation checklist + JSON dependency graph (waves 0–21) near the end of the file. Includes Task 19 UI wiring (wave 20) and Requirement 18 completion tests (wave 21).

## Current state (as of this session)

**Implemented** (on `feat/playground-tab`, uncommitted):
- `src/lib/pipelineNavigation.ts` — `"playground"` view ID added
- `src/lib/stores/playgroundStore.ts` — Zustand store (sub-view + Arena slots), Session_Scoped doc comment
- `src/lib/arenaConstants.ts` — shared timeout constants + `resolveCloudTimeoutMs`
- `src/server/routes/arena.ts` — cloud inference proxy, server-clamped timeout
- `src/components/features/PlaygroundPanel.tsx` — sub-view tabs, keep-alive rendering
- `src/components/features/ArenaPanel.tsx` — slot config, prompt validation, sequential local execution, concurrent local+cloud execution (`Promise.allSettled`), Copy buttons, `getFasterSlot` highlighting, `items-start` grid fix
- `src/components/features/ExecutionWorkspace.tsx` — Browser Test/Benchmark removed from "More" dropdown
- `src/App.tsx` — `"playground"` SECTIONS entry, nav-disabled wiring, `PlaygroundPanel` lazy-rendered in its section

Waves 0–6 are done (Tasks 1–7.3 complete; 7.4 partially — see below).

**Not implemented:**
- Task 7.4 — **done, not blocked.** Requirement 12 was rewritten this session (see below); the sub-items that used to describe wrapping `MCPDiagnosticCard` inline in each sub-view no longer correspond to anything in the current design, since diagnostics now live in the sidebar. Marked `[x]` in tasks.md with a note explaining why, rather than left open.
- Tasks 8–13 — all test suites (unit, server, component, PBT) and lint/checkpoint passes. `tsc --noEmit` and `eslint` both pass clean as of this session, and the vitest native-binding issue that blocked the suites earlier in this session was fixed with `pnpm install` (`CI=true pnpm install`, ~12 min). Unit: 525/525 passed. Server: 148/150 passed — 2 pre-existing failures unrelated to this branch (see below). Component suite (`vitest.component.config.ts`) **hangs** — traced to the jsdom dependency chain itself hanging on `require()` at 0% CPU (a filesystem/mount-level issue on this `/mnt/d` WSL2 drive, not a code problem); not resolved this session, deprioritized per explicit user instruction to move on.
- Task 12.2 — Tensor Preview reactivity (Req 11, `describeInputFeeds`) — only relevant once Req 11 is scheduled
- Tasks 14–16 — Run History persistence + Recommendations (Req 16–17) — separate epic, schedule after core ships
- Tasks 17–18 — MCP knowledge base integration (Req 12) — **optional, must not gate core; architecture rewritten this session, not yet implemented.** See "Known decisions" below — this is no longer `MCPDiagnosticCard` inline in three sub-views, it's sidebar-routed through `GeminiSidebar`'s Audit tab. `playgroundMcpClient.ts` still doesn't exist yet; when it's created, it's imported by the sidebar only.
- Task 19 — Arena slot convenience sources (Req 18) — Olive outputs picker + Assistant OpenAI-compat snapshot; not implemented. Spec added this session; depends on ArenaPanel + arena router only.

**Also flagged this session, unrelated to any of the above:** 2 server test failures (`detect.test.ts`, `registry.test.ts`) are caused by a real Cloudflare credential file at `.olive-studio/cloudflare-credentials.json` on this machine (gitignored, not part of any commit) — `resolveCloudflareAuth()` reads it directly, bypassing the `readEnvApiKey` mock those tests rely on. The actual token value got printed into a tool-output during this session's test run. If that's a live credential, consider rotating it. This is a pre-existing test-isolation gap in `src/server/services/ai/registry.ts`/`detect.ts`, not something introduced by Playground-tab work.

**Verify before resuming work**, since staged files may drift from what's described here:
```
git status --short
git diff --stat
```

## Immediate next step

Wave 7 in the dependency graph: `9.1` (pipelineNavigation unit tests), `9.2` (playgroundStore unit tests), `10.1` (arena.ts server tests), `11.4` (ExecutionWorkspace cleanup component test). All are pure test-writing and unblocked. Resolve the vitest native-binding environment issue first, or these can't be run to confirm they actually pass.

Full dependency graph: `tasks.md`, "Task Dependency Graph" section (JSON block near end of file, ~line 401).

## Known decisions — do not re-litigate without new information

These were deliberately settled this session after review pushback. If reconsidering one, read the cited design.md section first — the reasoning is written out, not just the conclusion.

- **playgroundStore stays separate from pipelineStore.** Not for the "avoids re-renders" reason (false — Zustand selectors already handle that). Real reason: `pipelineStore` is a serialization contract; `playgroundStore` holds a non-serializable `File`. See design.md "Separate Zustand store."
- **Keep-alive (hidden CSS, not unmount) is mandatory** for Browser Test / Benchmark sub-views. Not because of the ONNX session (ephemeral, cheap to lose) — because `selectedFile: File` and run results are unrecoverable once unmounted. See design.md "Keep-alive rendering."
- **No SQLite/DB dependency for Run History.** Matches existing `jobRegistry` pattern (`src/server/services/olive/state.ts`): in-memory `Map` + append-only `.jsonl` mirror. See design.md "Requirements 16–17 Additions."
- **Run History has a global on/off toggle**, default on, `localStorage`-backed — deliberate narrow exception to the otherwise-strict "Playground state is Session_Scoped, never persisted" rule (Req 2.7), because a UI preference is different in kind from run data. See Req 16.10–16.13 and design.md "History toggle."
- **MCP integration (Req 12) is optional and decoupled from core ship** — unchanged from before. What changed **this session**: it's no longer `MCPDiagnosticCard` embedded inline in three sub-views. It's routed through the existing `GeminiSidebar` Audit tab instead — a new Playground-Diagnostic_Mode alongside the existing Pipeline_Audit_Mode, reached via a small "Diagnose with Assistant" click (not an automatic pop-open) next to each sub-view's error. Reasons, in order of weight: (1) `GeminiSidebar` already exists for "surface AI help for what just happened" — `ExecutionWorkspace` already opens it this way via `onOpenAiAudit`; building a second parallel surface for the same purpose was judged unnecessary duplication. (2) The inline approach needed its own defensive layout rules (bounding error-region height, `items-start` on Arena's grid, no auto-scroll, skeleton loading — originally Req 12.9–12.11) purely because a card of unknown height was going into a grid that didn't expect it; the sidebar already gives every tab its own `overflow-y-auto` region, so none of that is needed. (3) The sidebar's existing `applyAutofix` mechanism is the right shape to reuse for a KB diagnostic's `updated_config` patch — one "apply this to the pipeline" code path, not two. `playgroundMcpClient.ts` is unchanged in purpose (one module owns the `toolName`/`args` shape for all three MCP tools, runtime-validates every response, never throws) — it's now imported by the sidebar alone rather than by three components. Full reasoning: design.md "Why the sidebar, not a third inline surface." **Do not revert to the inline-card design without discussing it again** — this was an explicit user redesign this session (prompted by "isn't there already an assistant with an audit tab"), not a discovered bug.
- **Arena concurrent execution uses `Promise.allSettled`, not `Promise.all`.** `Promise.all` rejects on first failure and would abandon the other slot's result — violates Req 7.4 (cloud failure must not suppress the local result). Already corrected in tasks.md Task 6.4; don't revert it.
- **Cloud timeout is a shared constant** (`ARENA_CLOUD_TIMEOUT_MS = 30_000` in `src/lib/arenaConstants.ts`), sent explicitly by the client, clamped server-side to `[1_000, 120_000]`. Not a bare destructuring default on the server — that pattern silently accepts `timeoutMs: 0` (instant abort) and `timeoutMs: 1e9` (never aborts).
- **Arena convenience sources (Req 18) are fill helpers, not new slot types.** Local stays file-based: server scans **server-owned** cache/`output_dir` roots, returns opaque artifact ids (never absolute paths), and streams bytes only after revalidating containment / regular file / `.onnx`|`.ort` / size limits. Cloud stays OpenAI-compat fields: one-click snapshots the active Assistant provider only when it is OpenAI-compatible **and** the endpoint passes the same outbound policy as `pinnedFetch`; otherwise soft-fail with a reason. Snapshot + olive-output routes share the Arena local-first access boundary (`arenaLocalOnly`). Snapshot copy (editable after click), not live bind. See design.md "Requirement 18 Additions."

## Property tests to not lose track of

Correctness properties live in design.md (Properties 20 / 20b / 21 / 21b / 22 cover Req 18 security + fill contracts). Each has a `// Feature: playground-tab, Property N` tag convention and a minimum-100-iterations requirement (fast-check). Property numbers are non-contiguous by section (8, then 9 twice in different sections — pre-existing doc quirk, not a numbering error to "fix"; 13–19 were added earlier; 20–22 family added with Req 18). Cross-reference tasks.md for which task number implements which property before assuming one is missing.

**Req 18 completion gate (Task 19.5):** do not mark Requirement 18 / Task 19 complete until Task 19.5 includes passing fast-check PBTs for Properties **20, 20b, 21, 21b, and 22** (≥100 iterations each, with the matching `// Feature: playground-tab, Property N` tags). Route/unit/component cases alone are not enough.

## Open scope question not yet resolved

Requirements 11 and 13–15 (input profiles, scoring, baseline download) roughly double the original spec's scope beyond the core Playground tab (1–10). Not yet split into a separate spec file or explicitly deprioritized — still living in the same requirements.md/design.md/tasks.md as core. If picking this up fresh, confirm with the user whether 11/13–15 ship alongside 1–10 or get deferred, before starting Task 12.2 or anything under Req 13–15.
