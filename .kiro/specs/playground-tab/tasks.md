# Implementation Plan: Playground Tab

## Overview

Adds a fourth top-level "Playground" navigation entry to the Olive Studio sidebar. Promotes `InBrowserValidation` and `WebGpuBenchmarkPanel` out of the `ExecutionWorkspace` "More" dropdown into a dedicated section, and introduces a new Arena sub-view for side-by-side model comparison. Implementation proceeds foundation-first: navigation types and the playground store are created before any UI, the server route is wired in parallel, then components are layered in dependency order, and finally `App.tsx` is updated to integrate everything.

---

## Tasks

- [x] 1. Extend `pipelineNavigation.ts` with the `"playground"` view ID
  - [x] 1.1 Add `"playground"` to the `PIPELINE_VIEW_IDS` tuple so `PipelineViewId` includes it
    - Update the `as const` tuple: `["input", "ihv", "execute", "playground"]`
    - `isPipelineViewId` type guard requires no change — it reads from the tuple
    - _Requirements: 10.1_
  - [x] 1.2 Update `attemptPipelineNavigate` to allow `"playground"` during a run
    - Change the guard from `id !== "execute"` to `id !== "execute" && id !== "playground"`
    - `announcePipelineNavBlocked` must not fire for `"playground"` when `olivePipelineRunning` is `true`
    - _Requirements: 1.3, 10.1_

- [x] 2. Create `src/lib/stores/playgroundStore.ts`
  - [x] 2.1 Implement the Zustand store with `activeSubView`, `slotA`, `slotB`, and their setters
    - Export `PlaygroundSubView` type: `"browser-test" | "benchmark" | "arena"`
    - Export `ArenaSlotConfig` interface with `type`, `file`, `endpointUrl`, `apiKey`, `modelId`
    - Export `usePlaygroundStore` created with `create<PlaygroundStore>()`
    - Default `activeSubView` is `"browser-test"`; default slot uses `defaultSlot()` factory
    - `setSlotA` / `setSlotB` apply partial patches via spread: `{ ...s.slotA, ...patch }`
    - _Requirements: 2.5, 5.1–5.3_

- [ ] 3. Create `src/server/routes/arena.ts` and register it in `server.ts`
  - [x] 3.1 Implement `mountArenaRoutes(router: Router)` with `POST /arena/cloud-inference`
    - Validate `endpointUrl` (required, must be `http:` or `https:` protocol only)
    - Validate `prompt` (required string)
    - Forward request to `${targetUrl.origin}${targetUrl.pathname}/chat/completions` with correct headers
    - Include `Authorization: Bearer <apiKey>` header only when `apiKey` is provided
    - Apply `AbortController` timeout defaulting to `30_000` ms
    - Return `{ output: string }` on success; `{ error: string }` with status `400/502/504` on failure
    - _Requirements: 7.1, 7.4, 7.5_
  - [x] 3.3 Extract the cloud timeout into `src/lib/arenaConstants.ts` and clamp it server-side
    - Create `src/lib/arenaConstants.ts` exporting `ARENA_CLOUD_TIMEOUT_MS = 30_000`, `ARENA_CLOUD_TIMEOUT_MIN_MS = 1_000`, `ARENA_CLOUD_TIMEOUT_MAX_MS = 120_000`, and `resolveCloudTimeoutMs(raw: unknown): number`
    - `resolveCloudTimeoutMs` returns the default for non-number / non-finite input, otherwise clamps into `[MIN, MAX]` — it must never return `0` or a non-finite value, and must never throw
    - In `arena.ts`: replace `const { timeoutMs = 30_000 } = req.body` with a destructure of `timeoutMs` (no default) plus `const resolvedTimeoutMs = resolveCloudTimeoutMs(timeoutMs)`; use `resolvedTimeoutMs` for both the `setTimeout` and the 504 error message so the reported number is the one actually enforced
    - Verify no numeric timeout literal remains in `arena.ts` or `ArenaPanel.tsx`
    - _Requirements: 7.5, 7.6, 7.7_
  - [x] 3.2 Register the arena router in `server.ts`
    - Import `mountArenaRoutes` from `./src/server/routes/arena.ts`
    - Create `const arenaRouter = Router()`, call `mountArenaRoutes(arenaRouter)`, mount with `app.use("/api", arenaRouter)` following the existing pattern
    - Place the mount before the API 404 fallback handler
    - _Requirements: 7.1_

- [x] 4. Clean up `ExecutionWorkspace.tsx` — remove Browser Test and Benchmark
  - [x] 4.1 Remove `"browser-test"` and `"benchmark"` from `recipeView` state type and narrowed the type union to `"graph" | "json"`
    - Update `useState<"graph" | "json" | "browser-test" | "benchmark">` → `useState<"graph" | "json">`
    - Update `setRecipeView` parameter type to match
    - Remove `"browser-test"` and `"benchmark"` from `visitedRecipeViews` (they were never in the initial Set, no change needed there)
    - _Requirements: 9.1, 9.5_
  - [x] 4.2 Remove lazy imports and render branches for the two promoted components
    - Delete the `InBrowserValidation` lazy import (`import("@/components/features/InBrowserValidation")`)
    - Delete the `WebGpuBenchmarkPanel` lazy import (`import("@/components/features/WebGpuBenchmarkPanel")`)
    - Remove the `{view === "browser-test" && ...}` and `{view === "benchmark" && ...}` `CardContent` branches from the view-map render loop
    - Simplify the `Card` min-height conditional: `recipeView === "graph"` is now the only non-standard height
    - _Requirements: 9.2, 9.4_
  - [x] 4.3 Remove "Browser Test" and "Benchmark" buttons from the More dropdown
    - Delete the two `<button role="menuitem">` elements for Browser Test and Benchmark inside the `moreToolsOpen` dropdown `div`
    - Ensure no `@ts-ignore` or `as any` is introduced; TypeScript must accept the narrowed `recipeView` type
    - _Requirements: 9.3, 9.5_

- [x] 5. Create `src/components/features/PlaygroundPanel.tsx`
  - [x] 5.1 Scaffold `PlaygroundPanel` with Sub_View_Tabs wired to `usePlaygroundStore`
    - Define `SUB_VIEWS` array: `[{ id: "browser-test", label: "Browser Test", icon: Globe }, { id: "benchmark", label: "Benchmark", icon: Gauge }, { id: "arena", label: "Arena", icon: Swords }]`
    - Read `activeSubView` and `setActiveSubView` from `usePlaygroundStore`
    - Render a pill/button-group tab bar using the same style pattern as the `graph/json` toggle in `ExecutionWorkspace`
    - _Requirements: 2.3, 3.1, 4.1_
  - [x] 5.2 Implement keep-alive rendering with `visitedSubViews` for `InBrowserValidation` and `WebGpuBenchmarkPanel`
    - Track `visitedSubViews` as local `Set<string>` state, initialized to `new Set(["browser-test"])`
    - Update the set when a new sub-view is selected (same pattern as `visitedRecipeViews` in `ExecutionWorkspace`)
    - Render sub-views only when visited; hide (not unmount) inactive sub-views with the `hidden` CSS class
    - Add lazy imports for `InBrowserValidation` and `WebGpuBenchmarkPanel` (moved from `ExecutionWorkspace`)
    - Wrap each sub-view in `<Suspense>` with a spinner fallback and `<ErrorBoundary label="...">`
    - Pass `recipeJson={undefined}` (or omit) to `InBrowserValidation` — the prop is optional
    - _Requirements: 3.2, 3.4, 4.2, 4.4, 4.5, 8.5_
  - [x] 5.3 Render `ArenaPanel` as the third sub-view tab content
    - Import `ArenaPanel` (non-lazy, same bundle chunk as PlaygroundPanel)
    - Render inside its own `<ErrorBoundary label="Arena">` within the keep-alive view map
    - _Requirements: 5.1_

- [ ] 6. Create `src/components/features/ArenaPanel.tsx`
  - [x] 6.1 Build slot configuration UI for both slots (local file and cloud/API modes)
    - Read `slotA`, `slotB`, `setSlotA`, `setSlotB` from `usePlaygroundStore`
    - Each slot header has a toggle `"Local file" / "Cloud / API"` that calls `setSlotA({ type: ... })`
    - Local mode: render a file drop-zone accepting `.onnx` and `.ort`, updating `setSlotA({ file })` on drop/select
    - When a file is loaded, display filename and formatted file size in the slot header
    - Cloud mode: render three inputs — endpoint URL, optional API key, optional model ID — updating store on change
    - _Requirements: 5.1–5.5_
  - [x] 6.2 Add shared prompt input with validation and run button
    - `useState<string>("")` for `prompt`, `useState<boolean>(false)` for `promptError`
    - Render a shared prompt textarea above both slot columns
    - "Run Arena" button is disabled when `prompt.trim() === ""`
    - On click with empty/whitespace prompt: set `promptError(true)` and abort — do not change result state
    - Clear `promptError` when the user types any non-whitespace character
    - Extract `clearRunResults()` as a module-level pure function returning `{ resultA: ArenaRunResult; resultB: ArenaRunResult }` with `output: ""`, `elapsedMs: 0`, `status: "idle"`
    - _Requirements: 5.6, 5.7_
  - [x] 6.3 Implement sequential execution path (both slots local)
    - Extract `computeElapsed(startTime: number, endTime: number): number` as a module-level pure helper (`endTime - startTime`)
    - On run: call `clearRunResults()`, set both results to `status: "running"` for Slot A, `status: "idle"` (waiting) for Slot B
    - Run Slot A via `onnxruntime-web` session; on success update `resultA` with output, elapsedMs, `status: "done"`
    - If Slot A errors: set `resultA.status = "error"`, `resultA.error = message`, do NOT start Slot B
    - On Slot A success: immediately start Slot B with the same session pattern; update `resultB` on completion/error
    - _Requirements: 6.1–6.5_
  - [x] 6.4 Implement concurrent execution path (local + cloud) and result display
    - When one slot is local and the other is cloud: use `Promise.allSettled([localRun, cloudFetch])` — start both immediately. `allSettled`, not `all`: `Promise.all` rejects on the first failure and would abandon the other slot's result, violating Requirement 7.4
    - Cloud fetch: `POST /api/arena/cloud-inference` with `{ endpointUrl, apiKey, modelId, prompt, timeoutMs: ARENA_CLOUD_TIMEOUT_MS }` imported from `src/lib/arenaConstants.ts` — no numeric literal (depends on 3.3)
    - Update each slot's result independently as its promise resolves or rejects (no cross-slot suppression)
    - Extract `getFasterSlot(a: number, b: number): "a" | "b" | "tie"` as a module-level pure helper
    - In result display: when both slots have `status: "done"` and `elapsedMs` values differ, apply emerald accent class to the faster slot and neutral class to the slower slot using `getFasterSlot`
    - Render output in a scrollable read-only `<pre>` or `<textarea>` per slot; render elapsed time beneath the output
    - Add a "Copy" button per slot using `navigator.clipboard.writeText`
    - _Requirements: 7.1–7.5, 8.1–8.4, 8.6_

- [ ] 7. Wire PlaygroundPanel into `App.tsx`
  - [x] 7.1 Add `"playground"` SECTIONS entry and update nav button disabled condition
    - Import `FlaskConical` from `lucide-react`
    - Append to `SECTIONS`: `{ id: "playground", step: "04", label: "Playground", desc: "In-browser inference, WebGPU benchmarks, and model Arena.", icon: FlaskConical }`
    - Change nav button `disabled` condition from `isOliveRunning && id !== "execute"` to `isOliveRunning && id !== "execute" && id !== "playground"`
    - Update the `onNavigate` event handler: remove the manual `id !== "input" && id !== "ihv" && id !== "execute"` allowlist guard — `isPipelineViewId` already validates `detail`, so call `scrollToSection(detail)` directly for any valid ID
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 10.2, 10.3, 10.4, 10.5_
  - [x] 7.2 Render `PlaygroundPanel` inside the `"playground"` section in the main scroll area
    - Import `PlaygroundPanel` (lazy or direct — prefer lazy to keep initial bundle lean)
    - Add a fallback component for the Suspense boundary if lazy
    - Inside the `SECTIONS.map` render loop, add: `{id === "playground" && <ErrorBoundary label="Playground"><PlaygroundPanel /></ErrorBoundary>}`
    - _Requirements: 1.2, 2.1, 2.2, 2.4_

- [x] 7.3 Document and enforce Playground state lifecycle
  - Add a file-header comment to `src/lib/stores/playgroundStore.ts` stating that the store is Session_Scoped and deliberately **not** wrapped in Zustand `persist` — `slotA.file` / `slotB.file` are `File` handles that serialize to `{}` and would rehydrate as slots that look configured but hold no model
  - Note in the same comment that if `activeSubView` is ever worth persisting, it must go through a `partialize` allowlist, never whole-store persistence
  - In `ArenaPanel`, confirm the slot-clear and slot-replace paths drop the previous `File` reference; if any `URL.createObjectURL` is introduced, revoke it in the same effect cleanup
  - Keep run buffers from `file.arrayBuffer()` function-local — never store an `ArrayBuffer`/`Uint8Array` in component state, since that copy outlives the `File` and pins the bytes
  - _Requirements: 2.6, 2.7, 2.8_

- [x] 7.4 Apply diagnostic-card layout constraints (superseded — see note)
  - [x] In `ArenaPanel`, add `items-start` to the two-column slot grid so an unequal-height diagnostic in one column does not vertically shift the other — applied independent of MCPDiagnosticCard since slot columns already differ in height (local drop-zone vs. cloud's 3-field form). This part stands on its own and is done.
  - **Superseded, not blocked.** Requirement 12 was rewritten this session to route all Playground KB diagnostics through the `GeminiSidebar` Audit tab (Playground-Diagnostic_Mode) instead of embedding `MCPDiagnosticCard` inline in each sub-view — see design.md "Why the sidebar, not a third inline surface." `GeminiSidebar` already gives every tab its own `overflow-y-auto` region, so the remaining sub-items below (scroll-bounding the error region, sibling-after placement, `min-w-0`, no-auto-scroll, skeleton loading) describe a problem that no longer exists in this architecture — there is no `MCPDiagnosticCard` call site inside any Playground sub-view to apply them to, now or later. Marking done rather than leaving open, since there is no future state in which this sub-item becomes real work under the current design.
  - _Requirements: 12.9, 12.10, 12.11 — retired; see requirements.md Requirement 12 (rewritten) for the current acceptance criteria_

- [~] 8. Checkpoint — run all test suites and linter
  - Run `pnpm lint` — confirm 0 errors (warnings ≤ 20 acceptable)
  - Run `pnpm test`, `pnpm test:server`, `pnpm test:component` — confirm all existing tests pass
  - Ask the user if questions arise before proceeding to the test-writing tasks

- [ ] 9. Write unit tests for `pipelineNavigation` and `playgroundStore`
  - [~] 9.1 Write unit tests for `pipelineNavigation` changes (`src/lib/__tests__/pipelineNavigation.test.ts`)
    - Assert `isPipelineViewId("playground")` returns `true`
    - Assert `isPipelineViewId("unknown")` returns `false`
    - Assert `attemptPipelineNavigate("playground")` returns `true` even when `olivePipelineRunning` is `true`
    - Assert `attemptPipelineNavigate("input")` returns `false` (and dispatches blocked event) when `olivePipelineRunning` is `true`
    - _Requirements: 1.3, 10.1_
  - [~] 9.2 Write unit tests for `playgroundStore` (`src/lib/__tests__/playgroundStore.test.ts`)
    - Assert default state: `activeSubView === "browser-test"`, both slots have `type: "local"` and `file: null`
    - Assert `setActiveSubView("arena")` updates `activeSubView` to `"arena"`
    - Assert `setSlotA({ type: "cloud", endpointUrl: "https://example.com" })` merges without overwriting other fields
    - Assert `setSlotB` applies partial patches independently of `slotA`
    - _Requirements: 2.5_

- [ ] 10. Write server tests for the arena route
  - [~] 10.1 Write server unit tests for `arena.ts` (`src/server/__tests__/arena.test.ts`)
    - Mock global `fetch`; assert correct `Authorization: Bearer <key>` header forwarding when `apiKey` is provided
    - Assert `Authorization` header is absent when `apiKey` is an empty string
    - Assert `400` response when `endpointUrl` is missing
    - Assert `400` response when `endpointUrl` uses a non-http/https protocol (e.g., `file://`, `javascript:`)
    - Assert `504` response when the mocked fetch throws an `AbortError`
    - Assert `{ output: string }` is returned when the mocked upstream returns a valid OpenAI chat completion JSON
    - _Requirements: 7.1, 7.4, 7.5_

- [ ] 11. Write component tests
  - [~] 11.1 Write component tests for `PlaygroundPanel` (`src/components/features/__tests__/PlaygroundPanel.test.tsx`)
    - Assert the section renders with the three Sub_View_Tab buttons ("Browser Test", "Benchmark", "Arena")
    - Assert `InBrowserValidation` is rendered (or its lazy fallback) when "Browser Test" tab is active by default
    - Assert clicking the "Arena" tab updates `activeSubView` in the store
    - _Requirements: 2.3, 3.1, 3.2_
  - [~] 11.2 Write component tests for `ArenaPanel` slot configuration and validation (`src/components/features/__tests__/ArenaPanel.test.tsx`)
    - Assert selecting "Local file" renders a file drop-zone
    - Assert selecting "Cloud / API" renders endpoint URL, API key, and model ID inputs
    - Assert submitting with an empty prompt renders an inline validation error and does not change result state
    - Assert the "Run Arena" button is disabled when prompt is empty
    - _Requirements: 5.2, 5.3, 5.6, 5.7_
  - [~] 11.3 Write component test for `ArenaPanel` result display highlighting
    - After rendering with mock results `{ resultA: { elapsedMs: 100, status: "done" }, resultB: { elapsedMs: 200, status: "done" } }`, assert Slot A's latency element has the emerald CSS class and Slot B's does not
    - _Requirements: 8.3_
  - [~] 11.4 Write component test for `ExecutionWorkspace` cleanup
    - Render `<ExecutionWorkspace />`, open the More dropdown, and assert neither "Browser Test" nor "Benchmark" appears in the menu
    - _Requirements: 9.3_

- [ ] 11.5 Write component tests for the new layout and lifecycle contracts
  - `ArenaPanel`: render with a diagnostic in one slot only; assert the slot grid carries `items-start` and that both slot columns keep equal width
  - `ArenaPanel`: render with a very long (5000-char) error string; assert the error container has a bounded height class and that the diagnostic card is a sibling of it, not a descendant
  - `ArenaPanel`: assert no `scrollIntoView` call occurs when a diagnostic transitions from absent to present (spy on `Element.prototype.scrollIntoView`)
  - `playgroundStore`: assert the module does not wrap `create` in `persist` — a regression guard for Requirement 2.7
  - _Requirements: 2.7, 12.9, 12.10, 12.11_

- [ ] 12. Write property-based tests
  - [~] 12.1 Add `fast-check` devDependency if not already present, then write PBT suite (`src/lib/__tests__/playgroundPBT.test.ts`)
    - Check `package.json` devDependencies for `fast-check` before adding — install with `pnpm add -D fast-check@3` only if absent
    - **Property 1 — Sub-view selection round-trip** (`playgroundStore`)
      - Generator: `fc.constantFrom("browser-test", "benchmark", "arena")`
      - Assert: `store.setActiveSubView(v); expect(store.getState().activeSubView).toBe(v)`
      - Min 100 iterations; tag: `// Feature: playground-tab, Property 1`
      - _Requirements: 2.5_
    - **Property 3 — Whitespace prompt blocks run** (pure guard logic extracted from `ArenaPanel`)
      - Generator: `fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'))` (whitespace-only including empty)
      - Assert: `prompt.trim() === ""` is truthy for every generated string (validates the guard condition)
      - Min 100 iterations; tag: `// Feature: playground-tab, Property 3`
      - _Requirements: 5.7_
    - **Property 4 — Elapsed time positive for completed runs** (pure `computeElapsed` helper)
      - Generator: `fc.tuple(fc.nat(), fc.nat()).map(([a, b]) => [Math.min(a, b), Math.max(a, b) + 1])`
      - Assert: `computeElapsed(start, end) > 0` when `end > start`
      - Min 100 iterations; tag: `// Feature: playground-tab, Property 4`
      - _Requirements: 6.4_
    - **Property 6 — Faster slot gets emerald highlight** (pure `getFasterSlot` helper)
      - Generator: `fc.tuple(fc.float({ min: 0.1, max: 10000 }), fc.float({ min: 0.1, max: 10000 })).filter(([a, b]) => Math.abs(a - b) > 0.0001)`
      - Assert: `getFasterSlot(a, b) === (a < b ? "a" : "b")`
      - Min 100 iterations; tag: `// Feature: playground-tab, Property 6`
      - _Requirements: 8.3_
    - **Property 7 — New run clears prior outputs** (pure `clearRunResults` helper)
      - Generator: `fc.record({ outputA: fc.string(), outputB: fc.string(), elapsedA: fc.nat(), elapsedB: fc.nat() })`
      - Assert: after `clearRunResults()`, both results have `output === ""` and `elapsedMs === 0`
      - Min 100 iterations; tag: `// Feature: playground-tab, Property 7`
      - _Requirements: 8.6_
    - **Property 13 — Cloud timeout resolution always bounded** (pure `resolveCloudTimeoutMs`)
      - Generator: `fc.anything()` plus explicit edge cases `undefined`, `null`, `NaN`, `Infinity`, `-Infinity`, `0`, `-1`, `1e9`, `"30000"`, `{}`, `[]`
      - Assert: result is always finite, always `>= ARENA_CLOUD_TIMEOUT_MIN_MS`, always `<= ARENA_CLOUD_TIMEOUT_MAX_MS`, and the call never throws
      - Min 100 iterations; tag: `// Feature: playground-tab, Property 13`
      - _Requirements: 7.5, 7.6, 7.7_

- [ ] 12.2 Tensor Preview reactivity (Requirement 11 — only when Req 11 is scheduled)
  - Export `describeInputFeeds(inputNames, profile, params): { name: string; dims: number[]; dtype: string }[]` from `src/lib/benchmarkProfiles.ts` — a shape-only sibling of `buildInputFeeds` that allocates no tensor data
  - Derive both functions' shapes from one shared internal table so the preview cannot drift from what the run feeds
  - In `WebGpuBenchmarkPanel`, compute the preview with `useMemo` during render from `[inputNames, selectedProfile, profileParams]` — never `useState` + `useEffect`, which would allow a render where preview and parameters disagree
  - Disable the profile pills and every parameter input while `runStatus === "running"`
  - Validate each override against its range (`seqLen` 1–2048, `vocabSize` 100–100000, `imageH`/`imageW` 1–1024); on invalid or empty input render a message naming the field and disable the run button — do not silently clamp or substitute a default
  - Treat a mid-edit empty field as invalid-but-not-destructive: disable the run, show the message, but do not overwrite the last valid value
  - **Property 14 — Preview matches the run** (PBT, min 100 iterations)
    - Generators: profile from `fc.constantFrom(...)`, params per the Property 8 ranges, `inputNames` both matching and non-matching the BERT triple
    - Assert: `describeInputFeeds(...)` equals the keys, `dims`, and `type` of the tensors `buildInputFeeds(...)` produces for the same inputs
    - Tag: `// Feature: playground-tab, Property 14`
  - _Requirements: 11.2, 11.8, 11.9, 11.10_

- [ ] 17. MCP knowledge base integration, sidebar-routed (Requirement 12, rewritten this session — optional, decoupled from core; schedule after core Req 1–10 ships)
  - [ ] 17.1 Create `src/lib/playgroundMcpClient.ts`
    - Export `TroubleshootArgs`, `PipelineContextArgs`, `DocsSearchArgs` interfaces — the single source of truth for each tool's args shape
    - Implement `troubleshoot(params)`, `getPipelineContext(params)`, `searchDocs(params)` — each POSTs to the existing `/api/mcp/tool` proxy, and each runs the response through a runtime shape check (`isMcpDiagnostic`, `isPipelineContextResult`, `isDocsSearchResult[]`) before returning
    - Every failure mode — `fetch` rejects, non-2xx response, malformed/reshaped `200` body — resolves to `null` (or `[]` for `searchDocs`) and never throws
    - This module is imported **only** by `GeminiSidebar`/`AuditPanel` (or a child they own for Playground-Diagnostic_Mode) — not by `PlaygroundPanel`, `ArenaPanel`, `InBrowserValidation`, or `WebGpuBenchmarkPanel`. Those four never import `playgroundMcpClient` or `useMcpDiagnosticKeyed` directly; they only call `onPlaygroundDiagnostic(request)`
    - _Requirements: 12.1, 12.2, 12.4, 12.5, 12.7_
  - [ ] 17.2 Create `src/lib/playgroundKnowledge.ts` with `getActivePipelinePassNames`
    - Pure function mapping `pipelineStore` UI state to Olive pass name strings, per the mapping table in design.md
    - No passes active → `[]`
    - _Requirements: 12.3_
  - [ ] 17.3 Add `AuditPanel`/`GeminiSidebar` mode switching (Pipeline_Audit_Mode ↔ Playground-Diagnostic_Mode)
    - Add a `PlaygroundDiagnosticRequest` type and an `onPlaygroundDiagnostic(request)` prop threaded from `App.tsx` → `PlaygroundPanel` → the three sub-views, mirroring the existing `onOpenAiAudit`/`openToAudit` wiring `ExecutionWorkspace` already uses
    - `App.tsx`'s handler opens the sidebar and sets Audit-tab mode to Playground-Diagnostic_Mode with the given request; the existing `onOpenAiAudit` path continues to always set Pipeline_Audit_Mode regardless of which section is scrolled into view
    - Mode reverts to Pipeline_Audit_Mode when the user dismisses the diagnostic or manually re-triggers a pipeline audit — never automatically on scroll/navigation
    - Playground-Diagnostic_Mode renders via `useMcpDiagnosticKeyed()` + `playgroundMcpClient.troubleshoot(...)`, keyed by `request.key`, feeding `MCPDiagnosticCard` — reused as-is, just hosted here instead of inline in a sub-view
    - _Requirements: 12.9 (retired numbering; see rewritten Requirement 12 in requirements.md)_
  - [ ] 17.4 Add the "Diagnose with Assistant" affordance to the three sub-views
    - `InBrowserValidation`: on ONNX Runtime Web session/inference/WebGPU error, render the affordance calling `onPlaygroundDiagnostic({ key: "browser-test-error", errorMessage, domain: "auto" })`
    - `WebGpuBenchmarkPanel`: on run error, same affordance with `{ key: "benchmark-error", errorMessage, domain: "auto", passName: "OnnxRuntime" }`
    - `ArenaPanel`: on a slot error (local or cloud), same affordance per slot with `{ key: "arena-slot-a" | "arena-slot-b", errorMessage, domain: "auto" | "studio" }` (domain follows source type, key follows slot — not source type, so re-toggling a slot's type mid-session doesn't orphan its diagnostic key)
    - None of these three components import `playgroundMcpClient` or `useMcpDiagnosticKeyed` — they only construct and forward the request object
    - _Requirements: 12.1, 12.2, 12.4, 12.5, 12.8_
  - [ ] 17.5 Wire Pipeline Context panel into Playground-Diagnostic_Mode
    - When the sidebar is in Playground-Diagnostic_Mode with Benchmark as the active sub-view context and `getActivePipelinePassNames(pipelineStoreState).length > 0`, call `playgroundMcpClient.getPipelineContext(...)` once; render the collapsible "Pipeline Context" section only when `confidence >= 0.3 && snippet_count > 0`
    - This section lives in the sidebar, not inline in `WebGpuBenchmarkPanel`
    - _Requirements: 12.3_
  - [ ] 17.6 Wire docs search into the sidebar
    - Search icon button inside Playground-Diagnostic_Mode → inline query field within the sidebar → `playgroundMcpClient.searchDocs({ query })` on submit → up to 5 results rendered inline in the sidebar's existing scroll region (no floating panel, no `z-index` layering)
    - Empty/failed search renders "No results found" / "MCP unavailable" rather than closing silently
    - _Requirements: 12.6, 12.7_
  - [ ] 17.7 Verify the "optional" contract holds
    - Confirm the Playground tab (Task 1–13) passes its full test suite with the MCP server entirely unconfigured/unreachable — no test in Tasks 1–13 should depend on `/api/mcp/tool` responding
    - _Requirements: (scope boundary, no single numbered criterion — see design.md "Scope and sequencing")_

- [ ] 18. Write tests for MCP knowledge base integration (Requirement 12 / Task 17)
  - [ ] 18.1 `playgroundMcpClient.test.ts` (`src/lib/__tests__/`)
    - **Property 9 — diagnostic shape contract** (PBT, min 100 iterations): arbitrary non-empty error strings; mock a well-shaped `McpDiagnostic` response; assert the returned object always has string `title`/`root_cause`/`workaround`. Tag: `// Feature: playground-tab, Property 9`
    - `troubleshoot()`/`getPipelineContext()`/`searchDocs()` each return `null`/`null`/`[]` on: network rejection, non-2xx response, and a well-formed-`200`-but-wrong-shape body — three distinct failure modes per function, all collapsing to the same degraded return value
    - None of the three functions ever throws, for any of the above inputs
    - Each function's outgoing request body matches its declared args interface (shape/snapshot assertion)
    - _Requirements: 12.1, 12.2, 12.4, 12.5, 12.7_
  - [ ] 18.2 `playgroundKnowledge.test.ts` (`src/lib/__tests__/`)
    - All `getActivePipelinePassNames` cases from the design doc's mapping table: each quantization method, each pruning method, conversion framework branch, transforms-only, all-active, none-active → `[]`
    - _Requirements: 12.3_
  - [ ] 18.3 Component tests — sub-view side (the trigger)
    - "Diagnose with Assistant" renders on error for each of Browser Test, Benchmark, Arena Slot A, Arena Slot B; absent when there's no error
    - Clicking it calls `onPlaygroundDiagnostic` with the correct `key`/`domain`/`passName` per trigger — assert the payload, not any MCP response, since these components never call MCP themselves
    - _Requirements: 12.1, 12.2, 12.4, 12.5, 12.8_
  - [ ] 18.4 Component tests — sidebar side (`GeminiSidebar`/`AuditPanel` Playground-Diagnostic_Mode)
    - Receiving a request opens the sidebar, selects Audit tab, and renders `MCPDiagnosticCard` with a mocked valid diagnosis
    - Mode switching is exclusive: a Playground diagnostic followed by the existing `onOpenAiAudit` trigger switches back to Pipeline_Audit_Mode and clears the diagnostic view
    - `MCPDiagnosticCard` absent + "MCP unavailable" shown + no uncaught exception when `POST /api/mcp/tool` rejects or returns a malformed `200` body — the regression test for a silently-changed MCP schema
    - Keyed diagnostics from two different triggers in the same session don't clobber each other's stored result
    - Pipeline Context section: absent with no active passes; present + collapsed by default with `confidence >= 0.3`; absent when `confidence < 0.3`
    - Arena-triggered diagnostic suppressed for `"No exact match found"`; rendered for a genuine match
    - Docs search: renders up to 5 results inline in the sidebar; shows "MCP unavailable" on failure without crashing
    - Opening the sidebar for a diagnostic does not change the Playground section's scroll position
    - _Requirements: 12.1, 12.3, 12.4, 12.5, 12.6, 12.7, 12.9, 12.10, 12.11_

- [ ] 14. Run History persistence (Requirement 16 — new epic, schedule after core Req 1–10 ships)
  - [ ] 14.1 Create `src/server/services/playground/historyStore.ts`
    - Define `BenchmarkRunRecord`, `ArenaSlotSummary`, `ArenaRunRecordEntry` types (co-locate or import from a shared `src/lib/playgroundHistoryTypes.ts` so client and server share one definition)
    - Implement `loadHistoryFromDisk()`, `appendBenchmarkRecord()`, `appendArenaRecord()`, `getBenchmarkHistory()`, `getArenaHistory()`, `clearBenchmarkHistory()`, `clearArenaHistory()`
    - `HISTORY_MAX_RECORDS = 500`, evicting the oldest record for the affected key on overflow — per-`modelName` for benchmark, global for Arena
    - `loadHistoryFromDisk` must not throw on a missing or corrupted `data/playground-history/*.jsonl` file: missing → empty history; corrupted line → skip with `console.warn`, keep parsing the rest
    - Persist via `fs.appendFileSync` to `.jsonl` (one JSON object per line); update the in-memory `Map` first so a disk-write failure doesn't desync what the route already told the client was saved
    - _Requirements: 16.1, 16.2, 16.6, 16.8_
  - [ ] 14.2 Create `src/server/routes/playgroundHistory.ts` and register in `server.ts`
    - `POST /api/playground/history/benchmark` and `/arena` — assign `id` (`crypto.randomUUID()`) and `timestamp` server-side, return `201`
    - `GET /api/playground/history/benchmark?modelName=&limit=` and `/arena?limit=` — most-recent-first, `limit` clamped to `[1, 100]` (default 20) rather than rejected on a malformed value
    - `DELETE /api/playground/history/benchmark?modelName=` and `/arena` — return `{ cleared: number }`
    - `modelName` required (400 if missing) on all Benchmark endpoints
    - Register with `app.use("/api", playgroundHistoryRouter)` following the existing route-mounting pattern
    - Call `loadHistoryFromDisk()` once at server startup (alongside other service init in `server.ts`)
    - _Requirements: 16.1, 16.2, 16.4, 16.5, 16.7_
  - [ ] 14.3 Create `useHistoryEnabled` hook and header toggle
    - `src/lib/hooks/useHistoryEnabled.ts` — reads/writes `localStorage["olive-studio:playground:history-enabled"]`, default `true` when unset
    - Render the toggle in the Playground section header (stands alone there — the docs-search entry point that used to share this header now lives in the sidebar, per Requirement 12's rewrite)
    - _Requirements: 16.10_
  - [ ] 14.4 Wire toggle-gated, fire-and-forget history writes into `WebGpuBenchmarkPanel` and `ArenaPanel`
    - On Benchmark run reaching `"done"` or `"error"`, read `useHistoryEnabled()` **at completion time** (not cached from run start); if `false`, skip the write entirely — no POST constructed; if `true`, POST the mapped `BenchmarkRunRecord`, wrapped in `.catch(() => console.warn(...))` — never `await` this in a way that delays the visible result
    - Same toggle check on Arena run reaching both slots terminal, before POSTing the mapped `ArenaRunRecordEntry`
    - For a cloud slot, derive `sourceLabel` as `new URL(endpointUrl).host` — never send `endpointUrl` or `apiKey` in the history payload
    - Truncate `prompt` to 500 chars before sending (defense in depth; server also enforces this)
    - _Requirements: 16.1, 16.2, 16.3, 16.9, 16.11_
  - [ ] 14.5 Build the History panel UI in both sub-views
    - Collapsible, collapsed by default, matching the collapsible-section style Requirement 12.3's Pipeline Context section uses in the sidebar
    - Lazy-fetch on first expand, not on mount, to avoid a network call while collapsed
    - Row: timestamp, profile/prompt summary, key metric, click-to-expand read-only detail — selecting a row must not overwrite the current run's live display
    - "Clear history" action with a confirmation step before the `DELETE` call fires
    - Panel and "Clear history" remain fully functional regardless of toggle state — only the write path checks the toggle, never `GET`/`DELETE`
    - WHILE the toggle is off, render an inline "History paused — turn on to save new runs" note in the panel
    - _Requirements: 16.4, 16.5, 16.7, 16.12, 16.13_

- [ ] 15. Run History recommendations (Requirement 17 — depends on Task 14)
  - [ ] 15.1 Create `src/lib/playgroundRecommendations.ts`
    - `computeBenchmarkRecommendations(records): Recommendation[]` — pure function implementing: regression (>15% worse `p50Ms` vs best of prior 5 for the same profile), untried profile, stale baseline (>20 records since pin)
    - `computeArenaRecommendations(records): Recommendation[]` — pure function implementing the same-config win-streak heuristic (>=4 of last 5)
    - Both return `[]` for `records.length < 2`
    - No `Date.now()` or network access inside either function — all "recency" is relative to record order/timestamps already in the array, so both stay unit-testable with fixed fixtures
    - _Requirements: 17.1, 17.5, 17.6, 17.7_
  - [ ] 15.2 Wire the Recommendations panel into Benchmark and Arena sub-views
    - Renders directly from the already-fetched history array — no separate fetch for the heuristic tier
    - Panel does not render at all when the underlying `computeXxxRecommendations` call returns `[]` (Requirement 17.7)
    - Add a "Get AI recommendation" button, disabled until history is non-empty, that on click (and only on click) calls `POST /api/mcp/tool` with `toolName` per Requirement 17.2 and a summary of the last 10 records as additional args
    - Render the MCP result as a distinctly-badged card (`kind: "mcp"`) alongside any Heuristic_Recommendations, reusing the graceful-degradation pattern from Requirement 12.7 for the unavailable case
    - _Requirements: 17.2, 17.3, 17.4_

- [~] 13. Final checkpoint — ensure all tests pass
  - Run `pnpm lint`, `pnpm test`, `pnpm test:server`, `pnpm test:component`
  - Confirm `pnpm validate:recipe` exits 0 (no regression in pipeline recipe builder)
  - Ask the user if any questions arise

- [ ] 16. Write tests for Run History and Recommendations (Requirements 16–17)
  - [ ] 16.1 `historyStore.test.ts` (`src/server/services/playground/__tests__/`)
    - **Property 15 — cap enforcement never exceeded, always most-recent-N** (PBT, min 100 iterations): generate 1–1000 sequential appends to one key; tag `// Feature: playground-tab, Property 15`
    - Unit: missing history file on load → empty state, no throw
    - Unit: one corrupted `.jsonl` line among valid ones → valid lines survive, corrupted line skipped with a warning
    - _Requirements: 16.6, 16.8_
  - [ ] 16.2 `playgroundHistory.test.ts` (`src/server/__tests__/`)
    - POST assigns `id`/`timestamp` even when absent from the request body
    - GET respects `modelName` filter and `limit` clamp (including malformed `limit` degrading to default, not `400`)
    - DELETE clears only the targeted scope, leaving other `modelName` keys untouched
    - _Requirements: 16.1, 16.2, 16.4, 16.5, 16.7_
  - [ ] 16.3 `playgroundRecommendations.test.ts` (`src/lib/__tests__/`)
    - **Property 16 — empty below 2-record threshold** (PBT, min 100 iterations): tag `// Feature: playground-tab, Property 16`
    - **Property 17 — regression heuristic fires exactly at the 15% boundary** (PBT, min 100 iterations): tag `// Feature: playground-tab, Property 17`
    - Unit: untried-profile heuristic fires/doesn't fire correctly
    - Unit: stale-baseline heuristic fires at >20 records since pin, not before
    - Unit: Arena win-streak fires at 4-of-5, not at 3-of-5
    - _Requirements: 17.1, 17.6, 17.7_
  - [ ] 16.4 Component tests for history + recommendations UI
    - **Property 18 — cloud slot summary never leaks `endpointUrl`/`apiKey`** (PBT, min 100 iterations): tag `// Feature: playground-tab, Property 18`
    - **Property 19 — toggle strictly gates writes, never reads** (PBT, min 100 iterations): generate a sequence of toggle flips interleaved with run completions; assert POST count matches completions where toggle was `true` at completion time, not run-start time; assert `GET`/`DELETE` succeed regardless of toggle state; tag `// Feature: playground-tab, Property 19`
    - History POST does not block or delay the visible run result (mock a hanging history endpoint)
    - History POST failure is silent — no error UI, run result unaffected
    - Toggle off → completing a run makes zero calls to the history POST endpoint
    - Toggle off → History panel still renders previously fetched records and shows the "History paused" note
    - Toggle off → "Clear history" button still functions
    - Recommendations panel absent below 2 history records
    - "Get AI recommendation" MCP call fires only on explicit click, never automatically on run completion
    - _Requirements: 16.3, 16.9, 16.11, 16.12, 16.13, 17.3, 17.4, 17.7_

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP; core functionality is complete without them
- `fast-check` must be added as a devDependency (`pnpm add -D fast-check@3`) if it is not already present — check `package.json` before running the install
- Pure helpers (`computeElapsed`, `getFasterSlot`, `clearRunResults`) must be exported from `ArenaPanel.tsx` at module scope so they are importable by the PBT suite
- The keep-alive pattern (show/hide with `hidden` class rather than conditional unmount) is mandatory for `InBrowserValidation` and `WebGpuBenchmarkPanel`. The reason is **not** the ONNX session — sessions are recreated per run and cost nothing to lose. It is the `selectedFile` handle (unrecoverable: a `File` from a drop-zone cannot be re-created programmatically), plus run metrics and log output the user already paid compute for. Unmounting a sub-view discards user work, not a cache
- Task 3.3 (`arenaConstants.ts`) is a prerequisite for 6.4 — the client must import `ARENA_CLOUD_TIMEOUT_MS` rather than hardcoding `30000`
- Task 12.2 covers Requirement 11 only and should be scheduled with the rest of the Req 11 work, not with the Req 1–10 core
- Tasks 14–16 (Requirements 16–17, Run History and Recommendations) are a separate epic on top of core Req 1–10 — schedule after the core Playground ships. Task 15 depends on Task 14 (recommendations read history that must already be persisted and fetchable). No SQLite or other DB dependency is introduced; persistence follows the existing `jobRegistry`-style in-memory-`Map`-plus-filesystem pattern already used in `src/server/services/olive/state.ts`
- Tasks 17–18 (Requirement 12, MCP knowledge base integration) are **optional and decoupled from core ship** — Requirements 1–10 must pass their full test suite with the MCP server unconfigured or unreachable, and nothing in Tasks 1–13 may depend on `/api/mcp/tool` responding. Requirement 12 was rewritten this session: rather than `MCPDiagnosticCard` embedded inline in three sub-views, all Playground KB diagnostics route through the existing `GeminiSidebar` Audit tab (Playground-Diagnostic_Mode), reached via a "Diagnose with Assistant" click in each sub-view. `playgroundMcpClient.ts` (Task 17.1) is imported **only** by the sidebar — the three sub-views (`InBrowserValidation`, `WebGpuBenchmarkPanel`, `ArenaPanel`) never import it or `useMcpDiagnosticKeyed` directly, they only construct a request object. A future MCP schema change is still one function signature to update, in one file the sidebar alone depends on. That module still closes the gap a bare `try/catch` leaves open: a *reachable* MCP server returning a *reshaped* `200` response degrades to the same `null`/`[]` return as an unreachable one, rather than silently handing the sidebar an `undefined` field it renders unguarded. See design.md "Why the sidebar, not a third inline surface" for the reasoning behind this change
- Task 15.2's "Get AI recommendation" call (Requirement 17.2) is itself an MCP call and should route through `playgroundMcpClient.ts` once Task 17 exists, rather than adding a seventh inline call site — schedule Task 15 after Task 17 if both are being built, even though the dependency graph below shows them as parallel-eligible waves
- The `ExecutionWorkspace` cleanup (Task 4) must happen before or concurrently with `PlaygroundPanel` creation (Task 5) to avoid a window where the same components have two entry points
- All design context documents are available during implementation — tasks reference requirements by number but assume the implementer has read the full design

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "3.1", "3.3"] },
    { "id": 1, "tasks": ["3.2", "4.1", "4.2", "4.3"] },
    { "id": 2, "tasks": ["5.1", "5.2"] },
    { "id": 3, "tasks": ["5.3", "6.1"] },
    { "id": 4, "tasks": ["6.2", "6.3"] },
    { "id": 5, "tasks": ["6.4", "7.1"] },
    { "id": 6, "tasks": ["7.2", "7.3", "7.4"] },
    { "id": 7, "tasks": ["9.1", "9.2", "10.1", "11.4"] },
    { "id": 8, "tasks": ["11.1", "11.2", "11.3", "11.5", "12.1"] },
    { "id": 9, "tasks": ["14.1"] },
    { "id": 10, "tasks": ["14.2"] },
    { "id": 11, "tasks": ["14.3", "14.4"] },
    { "id": 12, "tasks": ["15.1"] },
    { "id": 13, "tasks": ["15.2"] },
    { "id": 14, "tasks": ["16.1", "16.2", "16.3", "16.4"] },
    { "id": 15, "tasks": ["17.1", "17.2"] },
    { "id": 16, "tasks": ["17.3", "17.4", "17.5", "17.6"] },
    { "id": 17, "tasks": ["17.7", "18.1", "18.2", "18.3", "18.4"] }
  ]
}
```

Waves 9–14 (Run History and Recommendations) and waves 15–17 (MCP integration) are both independent of waves 0–8 in principle but should be scheduled after wave 8 completes in practice, since both extend `WebGpuBenchmarkPanel` and `ArenaPanel`, which core Task 6 and the Requirement 11 work (Task 12.2) are still actively changing. Waves 9–14 and 15–17 have no dependency on each other in the direction the graph shows — but if both are being built in the same pass, build wave 15 (`playgroundMcpClient.ts`) before Task 15.2, since Task 15.2's "Get AI recommendation" call is itself an MCP call and should reuse the consolidated client rather than becoming a seventh inline call site.
