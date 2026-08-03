# Requirements Document

## Introduction

This feature adds a fourth top-level navigation entry called "Playground" to the Olive Studio left sidebar, alongside the existing Model Source (01), Hardware (02), and Recipe & Run (03) sections. The Playground tab consolidates three existing or new sub-views: Browser Test (in-browser ONNX inference validation, currently buried in the Recipe & Run "More" menu), Benchmark (WebGPU latency/throughput benchmarking, also currently in the "More" menu), and a new Arena mode for side-by-side model comparison. Because these tools are model-agnostic exploratory utilities rather than pipeline configuration steps, elevating them to a first-class tab improves discoverability and keeps the pipeline sections focused on optimization workflow.

## Glossary

- **Playground**: The fourth top-level navigation tab added to the Olive Studio left sidebar, hosting the Browser Test, Benchmark, and Arena sub-views.
- **Sidebar**: The fixed left navigation panel (`<aside>`) in `App.tsx` that renders step-numbered pipeline entries and is controlled by the `SECTIONS` array.
- **ActiveView**: The TypeScript union type in `App.tsx` that identifies which top-level section is currently visible.
- **SECTIONS**: The configuration array in `App.tsx` that defines id, step number, label, description, and icon for each sidebar entry.
- **Browser_Test**: The in-browser ONNX inference validation sub-view, rendered by `InBrowserValidation.tsx`.
- **Benchmark**: The WebGPU-based latency and throughput benchmarking sub-view, rendered by `WebGpuBenchmarkPanel.tsx`.
- **Arena**: A new sub-view inside Playground where the user loads two models and compares their outputs side-by-side against a shared prompt.
- **Model_Slot**: One of two named positions in the Arena (Slot A and Slot B), each accepting an independent ONNX model file and optional inference configuration.
- **Arena_Run**: The act of executing inference on both Model_Slots and collecting their outputs for comparison.
- **Local_Model**: An ONNX or ORT model file loaded from the user's filesystem for in-browser inference.
- **Cloud_Model**: An external model reached via a REST API endpoint; not downloaded locally.
- **Olive_Output_Root**: A filesystem directory the Arena is allowed to scan for Olive-produced `.onnx` / `.ort` files. Roots are **server-owned canonical paths** resolved on the server from the same cache/output configuration the pipeline uses (defaulting to `~/.cache/olive` and `./models/optimized`). Clients MUST NOT supply arbitrary root paths.
- **Olive_Output_Artifact_Id**: An opaque server-minted identifier for a discovered model file under an Olive_Output_Root. Clients list and download by this id only; absolute filesystem paths are never returned to or accepted from the browser.
- **Olive_Output_Entry**: A discovered `.onnx` or `.ort` file under an Olive_Output_Root, exposed to the client as `{ id, displayPath, sizeBytes, mtimeMs, rootLabel }` (no absolute path).
- **Assistant_Cloud_Snapshot**: A one-shot copy of the active AI Assistant provider's OpenAI-compatible endpoint URL, API key, and model id, written into an Arena Cloud_Model slot at click time. Later Assistant settings changes do not update the slot. The snapshot endpoint is subject to the same local-first access boundary as `POST /api/arena/cloud-inference`.
- **OpenAI_Compat_Provider**: An Assistant provider the Arena cloud proxy can call: `openai-compat` / Custom, or any catalog provider whose configured `baseUrl` targets an OpenAI-compatible chat-completions API **and** passes the same outbound endpoint policy as `pinnedFetch` (reject local/loopback/private destinations unless `OLIVE_ALLOW_LOOPBACK_HTTP` explicitly permits them, or the URL is an approved trusted local path). Native Gemini, Codex OAuth, Devin, and similar non-compat providers are not OpenAI_Compat_Providers for Arena fill.
- **PlaygroundStore**: The Zustand store slice that persists Playground sub-view selection and Arena slot configuration. Deliberately separate from `pipelineStore` — see Design "Separate Zustand store" for the rationale and the conditions under which the two would be merged.
- **Session_Scoped**: State that lives for the lifetime of a single browser tab session and is intentionally lost on reload. `File` handles, ONNX sessions, and run results are all Session_Scoped. Nothing in the Playground is persisted to `localStorage` or the server. (Requirement 16's history toggle in `localStorage` is the intentional exception for a UI preference, not model or credential state.)
- **Sub_View_Tabs**: The horizontal tab bar rendered inside the Playground section for switching between Browser Test, Benchmark, and Arena.
- **ExecutionWorkspace**: The existing component (`ExecutionWorkspace.tsx`) currently hosting Browser Test and Benchmark as hidden sub-views inside its "More" dropdown.

---

## Requirements

### Requirement 1: Playground Sidebar Entry

**User Story:** As a developer, I want a dedicated Playground tab in the left sidebar, so that I can quickly access exploratory tools without navigating through the Recipe & Run section.

#### Acceptance Criteria

1. THE Sidebar SHALL render a fourth navigation entry with id `"playground"`, step label `"04"`, display label `"Playground"`, and a descriptive subtitle reflecting its three sub-views.
2. WHEN the user clicks the Playground sidebar entry, THE Sidebar SHALL scroll the main content area to the Playground section and set `activeView` to `"playground"`.
3. WHILE an Olive optimization run is in progress (i.e., `isOliveRunning` is `true`), THE Sidebar SHALL render the Playground entry as enabled and navigable (not disabled), because Playground tools are independent of the pipeline execution state.
4. WHEN the Playground section is the topmost visible section during scroll, THE Sidebar SHALL highlight the Playground entry with the active indicator (electric-blue left border and background tint) consistent with other SECTIONS entries.
5. THE Sidebar SHALL preserve the existing behavior of entries 01, 02, and 03 without visual or functional regression.

---

### Requirement 2: Playground Section Layout

**User Story:** As a developer, I want the Playground section to appear as a proper scroll-anchored section in the main content area, so that it integrates seamlessly with the existing scroll-spy navigation pattern.

#### Acceptance Criteria

1. THE Playground section SHALL be rendered as a `<section>` element with `id="playground"` and `aria-labelledby="playground-heading"` in the main scrollable area, following the same structural pattern as the existing `input`, `ihv`, and `execute` sections.
2. THE Playground section SHALL render a section header containing the step number `"04"`, the heading `"Playground"`, and a subtitle describing the available sub-views.
3. THE Playground section SHALL contain Sub_View_Tabs for navigating between Browser Test, Benchmark, and Arena.
4. WHEN the user navigates directly to the Playground entry via sidebar click, THE Playground section SHALL be scrolled into view using smooth scrolling consistent with the other sections.
5. THE PlaygroundStore SHALL persist the last-selected sub-view across re-renders within the same session so the selected tab is not lost on scroll.
6. THE Playground section SHALL keep every sub-view that the user has opened mounted for the remainder of the session, hiding inactive sub-views with CSS rather than unmounting them. This preserves each sub-view's loaded model file, run results, and log output — none of which are recoverable after an unmount, because a `File` handle obtained from a drop-zone cannot be re-derived programmatically.
7. ALL Playground state SHALL be Session_Scoped: no sub-view selection, slot configuration, `File` handle, run result, or vote SHALL be written to `localStorage`, `sessionStorage`, `IndexedDB`, or the server. WHEN the user reloads the page, THE Playground SHALL return to its default state (`activeSubView === "browser-test"`, both slots empty).
8. WHEN the user clears a Model_Slot's file or replaces it with a different file, THE Arena sub-view SHALL drop the reference to the previous `File` object and SHALL revoke any object URL it created from that file, so the browser can release the underlying blob.

---

### Requirement 3: Browser Test Sub-View Promotion

**User Story:** As a developer, I want the Browser Test panel to be a proper sub-view inside Playground, so that I can find and use in-browser ONNX inference without hunting through dropdown menus.

#### Acceptance Criteria

1. THE Playground section SHALL render the `InBrowserValidation` component as the content of the "Browser Test" Sub_View_Tab.
2. WHEN the user selects the "Browser Test" tab, THE Playground section SHALL display `InBrowserValidation` using lazy loading (React `Suspense` with a spinner fallback) consistent with the existing pattern in `ExecutionWorkspace`.
3. THE ExecutionWorkspace component SHALL no longer expose "Browser Test" as an option in its "More" dropdown menu; that menu item SHALL be removed.
4. IF the `InBrowserValidation` component throws a render error, THEN THE Playground section SHALL display an `ErrorBoundary` fallback labeled "Browser Test" without crashing the rest of the application.
5. THE `InBrowserValidation` component SHALL accept an optional `recipeJson` prop carrying the current pipeline recipe string, enabling cross-section context (this prop is already defined; the Playground invocation MAY omit it or pass `undefined`).

---

### Requirement 4: Benchmark Sub-View Promotion

**User Story:** As a developer, I want the Benchmark panel to be a proper sub-view inside Playground, so that I can run WebGPU latency benchmarks without navigating through the Recipe & Run section.

#### Acceptance Criteria

1. THE Playground section SHALL render the `WebGpuBenchmarkPanel` component as the content of the "Benchmark" Sub_View_Tab.
2. WHEN the user selects the "Benchmark" tab, THE Playground section SHALL display `WebGpuBenchmarkPanel` using lazy loading consistent with the existing pattern.
3. THE ExecutionWorkspace component SHALL no longer expose "Benchmark" as an option in its "More" dropdown menu; that menu item SHALL be removed.
4. IF the `WebGpuBenchmarkPanel` component throws a render error, THEN THE Playground section SHALL display an `ErrorBoundary` fallback labeled "Benchmark" without crashing the rest of the application.
5. WHILE the user is on the Benchmark sub-view and a benchmark run is in progress, THE Playground section SHALL preserve the run state if the user scrolls away and returns within the same session (component is not unmounted).

---

### Requirement 5: Arena Sub-View — Slot Configuration

**User Story:** As a developer, I want to configure two independent model slots in the Arena, so that I can choose which models to compare before running inference.

#### Acceptance Criteria

1. THE Arena sub-view SHALL display two named columns — Slot A and Slot B — each capable of accepting an independent model source.
2. WHEN the user selects "Local file" for a Model_Slot, THE Arena sub-view SHALL render a file drop-zone accepting `.onnx` and `.ort` files, consistent with the upload UX in `InBrowserValidation` and `WebGpuBenchmarkPanel`.
3. WHEN the user selects "Cloud / API" for a Model_Slot, THE Arena sub-view SHALL render input fields for an endpoint URL, an optional API key, and an optional model identifier string.
4. THE Arena sub-view SHALL allow Slot A and Slot B to be independently configured with different source types (e.g., Slot A = local file, Slot B = cloud API).
5. WHEN a file is loaded into a Model_Slot, THE Arena sub-view SHALL display the filename and file size in the slot header.
6. THE Arena sub-view SHALL provide a shared prompt input field above both slots, accepting free-form text that is sent as input to both models during an Arena_Run.
7. WHEN the shared prompt field is empty and the user attempts to start an Arena_Run, THE Arena sub-view SHALL display an inline validation message and prevent the run from starting.

---

### Requirement 6: Arena Sub-View — Sequential Execution for Two Local Models

**User Story:** As a developer, I want the Arena to run two local models sequentially rather than concurrently, so that the inference runs do not compete for GPU/CPU resources and produce reliable comparison results.

#### Acceptance Criteria

1. WHEN both Model_Slots are configured as Local_Model sources and the user initiates an Arena_Run, THE Arena sub-view SHALL run inference on Slot A to completion before starting inference on Slot B.
2. WHILE Slot A inference is executing, THE Arena sub-view SHALL display a loading indicator in Slot A's output column and a "waiting" state indicator in Slot B's output column.
3. WHEN Slot A inference completes, THE Arena sub-view SHALL display Slot A's output and immediately begin Slot B inference without requiring additional user input.
4. THE Arena sub-view SHALL display the total elapsed wall-clock time for each slot's inference run in that slot's result panel.
5. IF inference on Slot A fails, THEN THE Arena sub-view SHALL display the error in Slot A's output column, SHALL NOT start Slot B inference, and SHALL allow the user to retry Slot A independently.

---

### Requirement 7: Arena Sub-View — Concurrent Execution for Local vs. Cloud

**User Story:** As a developer, I want the Arena to run a local model and a cloud model concurrently when one slot is local and the other is cloud, so that the wall-clock comparison time is minimized.

#### Acceptance Criteria

1. WHEN one Model_Slot is a Local_Model and the other is a Cloud_Model and the user initiates an Arena_Run, THE Arena sub-view SHALL start both inferences concurrently (local ONNX session run and cloud API fetch in parallel).
2. WHILE concurrent inference is running, THE Arena sub-view SHALL display independent loading indicators in both slot output columns simultaneously.
3. WHEN each slot's inference completes, THE Arena sub-view SHALL display that slot's result immediately without waiting for the other slot to finish.
4. IF the Cloud_Model request fails (network error, non-2xx HTTP response, or timeout), THEN THE Arena sub-view SHALL display an error in the cloud slot's output column and SHALL NOT suppress or modify the local slot's result.
5. THE Arena sub-view SHALL apply a configurable request timeout to Cloud_Model API calls, defaulting to `ARENA_CLOUD_TIMEOUT_MS = 30_000`. THE timeout SHALL be owned by the client: the Arena sub-view SHALL send `timeoutMs` explicitly in every `POST /api/arena/cloud-inference` request body rather than relying on the server's default. WHEN the timeout is exceeded, THE Arena sub-view SHALL treat the cloud call as a failure and display a timeout error message in the cloud slot's output column.

6. THE `ARENA_CLOUD_TIMEOUT_MS` default SHALL be defined once, as an exported constant in `src/lib/arenaConstants.ts`, and imported by both the client (`ArenaPanel.tsx`) and the server route (`src/server/routes/arena.ts`). No numeric timeout literal SHALL appear in either file.

7. THE server route SHALL clamp any client-supplied `timeoutMs` to the inclusive range `[1_000, 120_000]`. IF `timeoutMs` is absent, non-numeric, non-finite, or outside that range, THEN THE server SHALL substitute the nearest valid value (`ARENA_CLOUD_TIMEOUT_MS` when absent or non-numeric) rather than rejecting the request. This prevents a malformed client from disabling the timeout entirely or pinning a server socket open indefinitely.

---

### Requirement 8: Arena Sub-View — Output Display and Comparison

**User Story:** As a developer, I want to see the outputs from both models displayed side-by-side with timing information, so that I can quickly assess quality and latency differences.

#### Acceptance Criteria

1. THE Arena sub-view SHALL display the output text or structured result from each Model_Slot in a scrollable read-only panel within that slot's column.
2. THE Arena sub-view SHALL display the inference latency (wall-clock time from request start to result received) for each slot beneath its output panel.
3. WHEN both slots have completed an Arena_Run, THE Arena sub-view SHALL highlight the faster slot's latency in a visually distinct accent color (e.g., emerald) and the slower slot's latency in a neutral color.
4. THE Arena sub-view SHALL provide a "Copy" button for each slot's output panel, allowing the user to copy the raw output text to the clipboard.
5. THE Arena sub-view SHALL preserve the last Arena_Run results in the component's local state so they remain visible if the user navigates away and returns within the same session.
6. WHEN the user starts a new Arena_Run, THE Arena sub-view SHALL clear the previous run's output panels and latency values before displaying new results.

---

### Requirement 9: ExecutionWorkspace Cleanup

**User Story:** As a developer maintaining the codebase, I want the "Browser Test" and "Benchmark" items removed from the ExecutionWorkspace "More" dropdown, so that there are no duplicate entry points and the code stays coherent.

#### Acceptance Criteria

1. THE ExecutionWorkspace component SHALL remove the `"browser-test"` and `"benchmark"` values from its `recipeView` state type union and from the `visitedRecipeViews` set initialization.
2. THE ExecutionWorkspace component SHALL remove the lazy imports for `InBrowserValidation` and `WebGpuBenchmarkPanel` from its module scope; those imports SHALL live only in the Playground component.
3. THE ExecutionWorkspace component SHALL remove the "Browser Test" and "Benchmark" `<button>` elements from the "More" dropdown menu.
4. THE ExecutionWorkspace component SHALL remove the `CardContent` render branches for `view === "browser-test"` and `view === "benchmark"`.
5. IF any TypeScript type or constant in `ExecutionWorkspace.tsx` references `"browser-test"` or `"benchmark"` as valid view identifiers after this change, THEN THE TypeScript compiler SHALL report a type error (i.e., no `@ts-ignore` or `as any` suppression is introduced).

---

### Requirement 10: Navigation State and Type Safety

**User Story:** As a developer, I want the `ActiveView` type and `pipelineNavigation` helpers to include `"playground"`, so that cross-component navigation events work consistently.

#### Acceptance Criteria

1. THE `PipelineViewId` type (defined in `src/lib/pipelineNavigation.ts`) SHALL include `"playground"` as a valid value.
2. THE `SECTIONS` array in `App.tsx` SHALL include an entry with `id: "playground"` typed as `PipelineViewId`, ensuring TypeScript validates it without casting.
3. WHEN the `OLIVE_PIPELINE_NAVIGATE` custom event is dispatched with `detail: "playground"`, THE Dashboard component's navigation handler SHALL respond by scrolling to the playground section, consistent with how it handles `"input"`, `"ihv"`, and `"execute"`.
4. THE scroll-spy `syncActiveFromScroll` effect in `App.tsx` SHALL include `"playground"` in its iteration over `SECTIONS` so scroll position correctly activates the Playground sidebar entry.
5. THE `ActiveView` type alias in `App.tsx` (which is `PipelineViewId`) SHALL remain a single-source-of-truth alias; no additional ad-hoc string literals for `"playground"` SHALL be introduced outside of `pipelineNavigation.ts` and `SECTIONS`.

---

### Requirement 11: Benchmark — Task-Appropriate Input Profiles

**User Story:** As a developer, I want the Benchmark panel to use realistic input tensors for the detected model type, so that benchmark results reflect actual inference conditions for Olive-optimized models.

#### Acceptance Criteria

1. THE Benchmark panel SHALL provide a set of built-in **Input Profiles** that the user can select before running a benchmark. At minimum the following profiles SHALL be offered:
   - **Synthetic (current)** — random Float32 tensors with user-configurable shape (default `[1, 128]`); this is the existing behavior and must remain as a profile option.
   - **NLP / Causal LM** — integer token ID tensors mimicking a transformer decoder sequence; shape `[1, seq_len]` with dtype `int64`; default seq_len configurable (default 128); values are token IDs in range `[0, vocab_size)` (default vocab_size 32000).
   - **NLP / Encoder (BERT-style)** — three `int64` tensors (`input_ids`, `attention_mask`, `token_type_ids`) each of shape `[1, seq_len]` (default seq_len 128); `input_ids` random in `[0, 30522)`, `attention_mask` all-ones, `token_type_ids` all-zeros.
   - **Vision / Image Classification** — a Float32 NCHW tensor of shape `[1, 3, H, W]` (default H=224, W=224) with pixel values normalized to `[-1, 1]`; suitable for ViT, ResNet, EfficientNet ONNX exports.
   - **Embedding / Sentence** — a single `int64` tensor `input_ids` of shape `[1, seq_len]` (default seq_len 64) with random token IDs in `[0, 30522)`.

2. WHEN the user selects an Input Profile, THE Benchmark panel SHALL display the resulting tensor shapes and dtypes that will be fed to the model before the user starts the run.

3. WHEN the user selects the "NLP / Encoder (BERT-style)" profile and the loaded model has exactly the input names `["input_ids", "attention_mask", "token_type_ids"]`, THE Benchmark panel SHALL map the generated tensors by name to the session inputs. For all other profiles or name mismatches, THE Benchmark panel SHALL assign tensors positionally (first tensor to first input, etc.), with any excess inputs receiving a synthetic Float32 tensor.

4. THE Benchmark panel SHALL allow the user to override the **sequence length** (for NLP profiles) or **image height/width** (for vision profiles) via numeric input fields that appear when a non-synthetic profile is selected.

5. WHEN the benchmark completes with a non-synthetic profile, THE results panel SHALL include the selected profile name and the actual tensor shapes used as part of the "Run Details" display.

6. THE Benchmark panel SHALL export benchmark results (latency stats + profile metadata) as a **JSON snapshot** via a "Export Results" button that appears after a successful run. The exported file SHALL follow the schema: `{ modelName, profileId, profileLabel, tensorShapes, epUsed, iterations, avgMs, minMs, maxMs, p50Ms, p99Ms, throughputPerSec, exportedAt }`.

7. THE Benchmark panel SHOULD surface known public benchmark baselines where applicable:
   - For BERT-base (detected by model name containing "bert-base"), display a reference baseline of ~25ms avg latency on CPU WASM as a comparison annotation in the results panel.
   - For ViT-B/16 or similar (detected by model name containing "vit"), display a reference baseline of ~40ms on CPU WASM.
   - These baselines are informational only — they SHALL NOT affect the measured benchmark values.

8. THE Tensor Preview SHALL recompute synchronously on every change to the selected profile or to any profile parameter (`seqLen`, `vocabSize`, `imageH`, `imageW`, `syntheticShape`), so the preview always describes what the *next* run will feed the model — never what a previous run fed it. It SHALL be derived during render from the current profile and parameter state, not stored in state and not deferred until the run starts.

9. WHILE a benchmark run is in progress, THE profile selector and all parameter override inputs SHALL be disabled, so the preview cannot diverge from the tensors the in-flight run is actually using.

10. WHEN a parameter input is empty or holds a value outside its documented range, THE Tensor Preview SHALL display a validation message naming the offending field instead of a tensor list, and THE run button SHALL be disabled. THE panel SHALL NOT silently substitute a default in this case, because a silently-corrected shape would make the reported benchmark describe a different tensor than the user asked for.

---

### Requirement 12: Playground — Knowledge Base and Troubleshooting Integration (Sidebar-Routed)

**User Story:** As a developer using the Playground, I want to reach Olive knowledge base context and troubleshooting guidance for a Playground error or question through the existing AI assistant sidebar, so that I get the same guidance the rest of Olive Studio already surfaces there, without a second inline diagnostic surface duplicated into three sub-views.

**Revision note:** The original draft of this requirement specified a `MCPDiagnosticCard` embedded inline below the error output of each of Browser Test, Benchmark, and Arena — mirroring the pattern already used in `ExecutionWorkspace` and `BatchProcessingPanel`. That approach was reconsidered before implementation: `GeminiSidebar` already has an Audit tab, and `ExecutionWorkspace` already opens it via `onOpenAiAudit`/`openToAudit` for exactly this "surface AI help for what just happened" purpose. Duplicating a second inline pattern into Playground — with its own layout-defense rules (Requirement 12.9–12.11 in the original draft) — was judged to be more surface area for the same outcome the sidebar already exists to provide. See design.md "Why the sidebar, not a third inline surface" for the full reasoning.

#### Acceptance Criteria

1. WHEN `InBrowserValidation` encounters a runtime error (ONNX Runtime Web session creation failure, inference error, or WebGPU unavailability error), THE Browser Test sub-view SHALL render a small inline "Diagnose with Assistant" affordance next to the error output. WHEN clicked, IT SHALL open `GeminiSidebar`, switch it to Audit tab in Playground-Diagnostic_Mode, and invoke `troubleshoot_olive_error` with `domain: "auto"` and the error message as `error_message`. IF the MCP server is unavailable, THE affordance SHALL still be clickable and the sidebar SHALL display "MCP unavailable" rather than crashing; the raw error message in the sub-view itself is unaffected either way.

2. WHEN a benchmark run fails (session creation error or inference error), THE Benchmark sub-view SHALL render the same "Diagnose with Assistant" affordance. WHEN clicked, it SHALL open the sidebar into Playground-Diagnostic_Mode and call `troubleshoot_olive_error` with the error message and `pass_name: "OnnxRuntime"` as context.

3. WHEN the sidebar's Audit tab is in Playground-Diagnostic_Mode with the Benchmark sub-view active, and the current `pipelineStore` state has at least one active Olive pass (conversion, quantization, pruning, or ONNX transforms enabled), THE sidebar SHALL proactively call `get_context_for_pipeline` with the active pass names and model identifier, and display the returned context snippets in a collapsible "Pipeline Context" section within the sidebar. This section SHALL be collapsible and collapsed by default. IF confidence is below 0.3 OR snippet_count is 0, THE section SHALL NOT be rendered. This panel does **not** appear inline in `WebGpuBenchmarkPanel` itself.

4. WHEN a Cloud_Model inference request fails (network error, non-2xx HTTP response, or timeout), THE Arena sub-view SHALL render the "Diagnose with Assistant" affordance next to that slot's error message. WHEN clicked, it SHALL call `troubleshoot_olive_error` with `domain: "studio"` in the sidebar. IF no KB match is found (title is "No exact match found"), THE sidebar SHALL display a "no guidance found" state rather than an empty diagnostic.

5. WHEN a Local_Model inference request fails, THE Arena sub-view SHALL render the same affordance for that slot. WHEN clicked, it SHALL call `troubleshoot_olive_error` with `domain: "auto"` in the sidebar. IF no KB match is found, THE sidebar SHALL display the same "no guidance found" state.

6. THE sidebar's Audit tab, while in Playground-Diagnostic_Mode, SHALL expose a "Search Olive docs" entry point (a search icon that opens an inline query field within the sidebar). WHEN the user submits a query, it SHALL call `search_olive_documentation` via `POST /api/mcp/tool` and display the top results (up to 5) within the sidebar. This replaces a separate search entry point in the Playground section header — there is exactly one docs-search UI in the app, and it lives in the sidebar.

7. ALL knowledge integration features SHALL be non-blocking. IF the MCP server is unavailable, uninstalled, or returns an error, THE Playground sub-views SHALL continue to function normally regardless of sidebar state — the diagnostic content, context panel, and docs search SHALL display an appropriate "MCP unavailable" message within the sidebar rather than crashing anything in the main content area. KB-dependent features SHALL never block or alter the primary inference result or error already shown in the sub-view.

8. THE sidebar SHALL reuse the existing `MCPDiagnosticCard` component and `useMcpDiagnosticKeyed` hook to render diagnostic content within Playground-Diagnostic_Mode, keyed independently per trigger (Browser Test, Benchmark, Arena Slot A, Arena Slot B) so re-opening the sidebar from a different trigger does not clobber a previous diagnosis still worth reading. No new diagnostic card component SHALL be created; the existing component is relocated to a new host (the sidebar) rather than duplicated.

9. THE `AuditPanel`/`GeminiSidebar` component SHALL support two mutually exclusive Audit-tab render modes: **Pipeline_Audit_Mode** (existing `/api/ai/analyze-state` score-and-suggestions behavior, used for Input/IHV/Execute) and **Playground-Diagnostic_Mode** (KB-diagnostic behavior described above, used only in response to an explicit Playground trigger). Opening the sidebar via the existing pipeline-audit path (e.g. `ExecutionWorkspace`'s "Open AI Audit") SHALL always show Pipeline_Audit_Mode, regardless of which pipeline section happens to be scrolled into view; Playground-Diagnostic_Mode SHALL only activate via an explicit "Diagnose with Assistant" click from a Playground sub-view, and SHALL revert to Pipeline_Audit_Mode when the user dismisses the diagnostic or manually triggers a pipeline audit.

10. WHEN a KB diagnostic includes an `updated_config`/`relevant_quirks` patch that maps onto `pipelineStore` fields, THE sidebar's existing "Apply Fix" mechanism (shared with Pipeline_Audit_Mode's autofix) SHALL be offered. WHEN the diagnostic has no such mapping (expected for most Arena and Browser Test errors, which are local input/config problems rather than recipe problems), THE sidebar SHALL omit the Apply Fix control and show the guidance text only — this is not an error state, just a diagnostic with no mechanical fix.

11. Opening the sidebar for a Playground diagnostic SHALL NOT auto-scroll the main content area. The user's scroll position in the Playground section SHALL be preserved — only the sidebar (a fixed-position panel) changes state.

- **Efficiency_Index**: A dimensionless score computed as `throughput_per_sec / model_size_mb`. Higher is better. Works without a baseline and captures what Olive optimization delivers: more inferences per second per MB of model weight.
- **Relative_Speed_Score**: `(baseline_p50_ms / run_p50_ms) × 100`. A value of 100 means identical speed; >100 means the run is faster than the baseline; <100 means slower. Only available after a Baseline_Run has been pinned.
- **Compression_Ratio**: `baseline_size_mb / run_size_mb`. A value of 2.0 means the optimized model is half the size. Only available after a Baseline_Run has been pinned.
- **Optimization_Score**: A composite score (0–100+) computed as `(0.4 × relative_speed_score_normalized) + (0.4 × compression_ratio_normalized) + (0.2 × p99_stability_score)` where each sub-score is normalized to a 0–1 range against the baseline. Only available after a Baseline_Run has been pinned.
- **Baseline_Run**: A benchmark result that has been explicitly pinned by the user as the reference point for relative scoring. The Benchmark sub-view stores at most one Baseline_Run at a time.
- **Scoring_Mode**: The selected scoring strategy for the Benchmark sub-view. One of: `"efficiency"` (Efficiency_Index, no baseline needed) or `"relative"` (Relative_Speed_Score + Compression_Ratio + Optimization_Score, requires Baseline_Run).
- **Quality_Winner**: The Arena slot chosen by the user as having produced the better output quality, selected via A/B vote after both slots complete an Arena_Run.
- **Performance_Winner**: The Arena slot with the better combined Efficiency_Index (higher throughput per MB), computed automatically after both slots complete an Arena_Run when both slots are Local_Model.
- **Baseline_Catalog**: A curated list of well-known ONNX model identifiers on Hugging Face that can be downloaded as baseline references. Populated from the active pipeline's `hfModelId` when available, and supplemented by a short static list of common model families.
- **Baseline_Download**: The server-side process of fetching a base ONNX model from Hugging Face via the Python venv, caching it locally under `models/baselines/`, and making it available to the Benchmark panel.
- **Run_Record**: A single persisted entry describing one completed Benchmark run or one completed Arena_Run (both slots). Stored server-side, independent of the browser session that created it.
- **Run_History**: The ordered collection of Run_Records for a given model (Benchmark) or a given slot-pair (Arena), retrievable across sessions and across page reloads.
- **Recommendation**: A short, actionable suggestion surfaced next to a completed run, derived either from a local heuristic over Run_History (**Heuristic_Recommendation**) or from an MCP tool call that incorporates run history as context (**MCP_Recommendation**).
- **History_Store**: The server-side persistence layer for Run_Records — an append-only JSON file under `data/playground-history/`, mirrored into an in-memory `Map` at startup for fast reads, following the existing `jobRegistry` pattern in `src/server/services/olive/state.ts`.

---

### Requirement 13: Benchmark Scoring

**User Story:** As a developer, I want the Benchmark panel to produce a meaningful score for each run, so that I can quickly assess how much my Olive optimization improved model efficiency.

#### Acceptance Criteria

1. WHEN a benchmark run completes, THE Benchmark panel SHALL always compute and display the **Efficiency_Index** (`throughput_per_sec / model_size_mb`) for that run, regardless of whether a Baseline_Run has been pinned. THE Efficiency_Index SHALL be displayed in the results grid alongside the existing latency metrics.

2. THE Benchmark panel SHALL expose a **Scoring_Mode selector** (pill toggle) with two options: "Efficiency" (default) and "Relative". WHEN "Efficiency" is selected, THE panel SHALL display only the Efficiency_Index score. WHEN "Relative" is selected, THE panel SHALL additionally display the Relative_Speed_Score, Compression_Ratio, and Optimization_Score — but only if a Baseline_Run has been pinned.

3. WHEN "Relative" mode is selected and no Baseline_Run has been pinned, THE Benchmark panel SHALL display an inline prompt: "Pin a baseline first to enable relative scoring" with a "Pin current run as baseline" button active only after a run completes.

4. WHEN the user clicks "Pin as baseline", THE Benchmark panel SHALL store the current run's results as the Baseline_Run and display a visual indicator (e.g. a "Baseline" badge on the result) confirming the pin. At most one Baseline_Run SHALL be stored at a time; pinning a new run replaces the previous baseline.

5. WHEN a Baseline_Run is pinned and a new run completes in "Relative" mode, THE Benchmark panel SHALL compute and display: Relative_Speed_Score, Compression_Ratio, and Optimization_Score. Values better than baseline SHALL be highlighted in emerald; worse values SHALL be highlighted in amber.

6. WHEN the Optimization_Score exceeds 100 (the run outperforms the baseline), THE Benchmark panel SHALL display a "Better than baseline" indicator. WHEN the Optimization_Score is below 80, THE panel SHALL display a "Worse than baseline" indicator.

7. THE Benchmark panel SHALL include the score values (Efficiency_Index and, if available, Optimization_Score) in the JSON export snapshot defined in Requirement 11.6. The export schema SHALL be extended with optional fields: `efficiencyIndex`, `optimizationScore`, `relativeSpeedScore`, `compressionRatio`.

---

### Requirement 14: Arena Scoring and Quality Vote

**User Story:** As a developer, I want the Arena to score both model slots on efficiency and let me vote on which produced a better output, so that I can compare Olive-optimized models against baselines on both performance and quality.

#### Acceptance Criteria

1. WHEN both Arena slots have completed an Arena_Run and both are Local_Model sources, THE Arena panel SHALL compute and display the **Efficiency_Index** for each slot beneath its latency display. The slot with the higher Efficiency_Index SHALL receive a "Performance Winner" badge.

2. WHEN both Arena slots have completed an Arena_Run, THE Arena panel SHALL display an A/B quality vote prompt: "Which response was better?" with two buttons — "Slot A" and "Slot B" — and an optional "Too close to call" option. This vote SHALL be recorded as the **Quality_Winner** and displayed as a badge on the winning slot's header.

3. WHEN the user has voted for a Quality_Winner, THE Arena panel SHALL display a summary row showing: Performance Winner (slot label + Efficiency_Index), Quality Winner (slot label + "User preferred"), and whether the same slot won both.

4. IF one slot is a Cloud_Model (no local file size available), THE Arena panel SHALL display the Efficiency_Index only for the Local_Model slot and SHALL NOT attempt to compute a Performance_Winner between a local and a cloud slot (since cloud response size is undefined). The quality vote SHALL still be available.

5. THE Arena panel SHALL preserve the Quality_Winner vote and Efficiency_Index values in the component's local state alongside the run results, consistent with Requirement 8.5 (results preserved on tab switch within session).

6. WHEN the user starts a new Arena_Run, THE Arena panel SHALL clear the previous Quality_Winner vote along with the previous run's output panels (consistent with Requirement 8.6).

---

### Requirement 15: Baseline Model Download

**User Story:** As a developer, I want to download the base (unoptimized) ONNX version of the model I just optimized through Olive directly from the Playground, so that I can use it as a benchmark baseline without leaving the application.

#### Acceptance Criteria

1. WHEN the Playground section is active and `pipelineStore` has `modelSource === "huggingface"` and a non-empty `hfModelId`, THE Benchmark sub-view SHALL display a "Download base model as baseline" callout banner. This banner SHALL show the model identifier and a "Download" button.

2. WHEN the user clicks "Download", THE Benchmark panel SHALL initiate a download via `POST /api/playground/download-baseline` with `{ hfModelId, hfTask }`. The server SHALL use the Python venv to export the base ONNX model via `optimum-cli` or `huggingface_hub`, saving it to `models/baselines/<model-slug>/model.onnx`. Progress SHALL be streamed back via SSE at `GET /api/playground/baseline-status/:jobId`.

3. BEFORE initiating the download, THE server SHALL check system RAM reported by the hardware probe against the estimated model size. IF the estimated model size exceeds `systemRamGb × 0.7` (70% of system RAM as a safety margin), THE server SHALL return a `{ blocked: true, reason: string, estimatedSizeGb: number }` response and THE Benchmark panel SHALL display a warning dialog rather than starting the download. The user SHALL be able to acknowledge and proceed anyway.

4. WHEN the download completes successfully, THE Benchmark panel SHALL automatically load the downloaded model file and offer to pin it as the Baseline_Run with a "Pin as baseline" prompt, without requiring the user to manually locate the file.

5. WHEN `pipelineStore` has `modelSource === "local"` (user-provided file, no HF identifier), THE Benchmark panel SHALL NOT show the "Download base model" callout. Instead, THE Benchmark panel SHALL show a "Upload baseline file" drop-zone as an alternative baseline entry point, consistent with the existing file upload UX.

6. THE Benchmark panel SHALL also expose a **Baseline Catalog** — a short searchable list of well-known ONNX model identifiers on Hugging Face (e.g. `bert-base-uncased`, `openai/whisper-tiny`, `microsoft/phi-2`, `meta-llama/Llama-3.2-1B`) — accessible via a "Browse catalog" link in the baseline section. Each catalog entry SHALL show model name, architecture, approximate size, and a "Download" button. Selecting a catalog model SHALL follow the same download flow as Requirement 15.2.

7. WHEN a download is in progress, THE Benchmark panel SHALL display a progress indicator (percentage or spinner) and a "Cancel" button. IF the user cancels, THE server SHALL abort the download process and delete any partially downloaded files.

8. IF the download fails (network error, model not available in ONNX format, venv not set up), THE Benchmark panel SHALL display a descriptive error message and a "Retry" button. The error message SHALL distinguish between: "Model not available in ONNX format on HuggingFace" and "Network or venv error".

---

### Requirement 16: Run History Persistence

**User Story:** As a developer, I want my past Benchmark and Arena runs saved across sessions, so that I can track how a model's performance changes over time without re-running everything after every reload.

#### Acceptance Criteria

1. WHEN a Benchmark run completes (successfully or with an error), THE server SHALL persist a Run_Record to the History_Store via `POST /api/playground/history/benchmark`. The record SHALL include: `id` (server-generated UUID), `timestamp`, `modelName`, `modelSizeMb` (if known), `profileId`, `profileLabel`, `tensorShapes`, `epUsed`, `iterations`, `avgMs`, `minMs`, `maxMs`, `p50Ms`, `p99Ms`, `throughputPerSec`, `efficiencyIndex`, and, if a Baseline_Run was pinned, `optimizationScore`.

2. WHEN both slots of an Arena_Run complete (successfully or with an error), THE server SHALL persist a Run_Record to the History_Store via `POST /api/playground/history/arena`. The record SHALL include: `id`, `timestamp`, `prompt` (truncated to 500 chars), per-slot `{ sourceLabel, elapsedMs, status, efficiencyIndex? }` for A and B, `performanceWinner`, and `qualityWinner` if voted.

3. THE client SHALL send the persist request fire-and-forget: a failure to persist (network error, server unavailable) SHALL be logged to the console and SHALL NOT block, delay, or visibly interrupt the user's view of the run result that already rendered. Run History is a convenience layer over the primary result display, never a precondition for it.

4. THE Benchmark sub-view SHALL expose a "History" panel (collapsible, collapsed by default) showing the most recent Run_Records for the currently loaded model, fetched via `GET /api/playground/history/benchmark?modelName=<name>&limit=20`. Each row SHALL show timestamp, profile, avg latency, and Efficiency_Index. Selecting a row SHALL NOT overwrite the current run's display — it SHALL open a read-only detail view alongside it.

5. THE Arena sub-view SHALL expose an equivalent "History" panel via `GET /api/playground/history/arena?limit=20`, showing timestamp, truncated prompt, both slots' latency, and the recorded winners.

6. THE History_Store SHALL cap retained records per model (Benchmark) or globally (Arena) at `HISTORY_MAX_RECORDS = 500`. WHEN a new record would exceed the cap, THE server SHALL evict the oldest record for that key before appending the new one — the store is a lightweight local history, not an unbounded audit log.

7. THE Benchmark and Arena History panels SHALL each expose a "Clear history" action, scoped to the current model (Benchmark) or globally (Arena), calling `DELETE /api/playground/history/benchmark?modelName=<name>` or `DELETE /api/playground/history/arena`. THE action SHALL require a confirmation step before the request is sent, because deletion is irreversible.

8. IF the History_Store file is missing, empty, or fails to parse on server startup, THE server SHALL start with an empty in-memory history rather than crash, and SHALL log a warning. A corrupted history file SHALL NOT prevent the Playground or any other Studio feature from functioning.

9. Run_Records SHALL contain no file contents, file paths outside `modelName`, API keys, or endpoint URLs from Cloud_Model slots — only the metrics and labels listed in 16.1–16.2. This keeps the persisted history free of the same secrets Requirement 7's cloud proxy already declines to store server-side.

10. THE Playground SHALL expose a single global "Save run history" toggle, defaulting to **on**, accessible from the Playground section header. THE toggle's state SHALL be stored client-side in `localStorage` under the key `olive-studio:playground:history-enabled`, since it is a local UI preference, not data that needs to sync across devices or survive a `pipelineStore` reset. (An earlier draft placed this "alongside the docs-search entry point from Requirement 12.6" — that entry point has since moved into the sidebar per Requirement 12's rewrite, so the toggle stands alone in the Playground header now.)

11. WHILE the toggle is off, THE Benchmark and Arena sub-views SHALL NOT send Requirement 16.1/16.2 POST requests at all — the write is skipped client-side before any network call is made, not sent-and-discarded server-side. Turning the toggle off SHALL take effect for the next run to complete; a run already in flight when the toggle is switched off SHALL still be governed by the toggle state at the moment it completes, read fresh at that moment rather than cached at run start.

12. WHILE the toggle is off, THE History and Recommendations panels (Requirements 16.4–16.5, 17.1) SHALL remain visible and SHALL continue to display previously persisted Run_Records fetched via `GET` — turning history off stops new writes, it does not hide or delete what was already saved. THE panel SHALL display a small inline note ("History paused — turn on to save new runs") when the toggle is off, so the absence of new entries after a run is explained rather than silent.

13. THE toggle SHALL NOT gate reads or the "Clear history" action from Requirement 16.7 — a user with the toggle off SHALL still be able to view and delete existing history for a model.

---

### Requirement 17: Run History Recommendations

**User Story:** As a developer, I want the Playground to point out what my run history suggests I should try next, so that I can act on trends without manually comparing rows myself.

#### Acceptance Criteria

1. WHEN the Benchmark sub-view has at least 2 Run_Records for the currently loaded model, THE Benchmark panel SHALL compute and display up to 3 Heuristic_Recommendations in a "Recommendations" panel adjacent to the History panel. Heuristic_Recommendations SHALL be computed client-side, purely from the fetched Run_History — no network call beyond the history fetch itself. At minimum, the heuristics SHALL cover:
   - **Regression**: the most recent run's `p50Ms` is more than 15% worse than the best `p50Ms` among the prior 5 records for the same profile → "Latest run regressed Xx vs your best result on this profile."
   - **Untried profile**: the model has runs recorded for some profiles but not others → "You haven't benchmarked this model with the [Profile] input yet."
   - **Stale baseline**: a Baseline_Run is pinned but is more than 20 records old relative to the current history for this model → "Your pinned baseline is from N runs ago — consider re-pinning."

2. WHEN the user clicks "Get AI recommendation" (a manual, explicit action — never automatic) on the Benchmark or Arena Recommendations panel, THE client SHALL call `POST /api/mcp/tool` with `toolName: "get_context_for_pipeline"` (Benchmark) or `toolName: "troubleshoot_olive_error"` / `"search_olive_documentation"` as applicable (Arena), passing a compact summary of the last 10 Run_Records as additional context in the tool arguments. THE returned guidance SHALL render as an MCP_Recommendation card, visually distinguished from Heuristic_Recommendations (e.g. a small "AI" badge) so the user can tell a computed heuristic from a model-generated suggestion apart.

3. MCP_Recommendation fetches SHALL be explicitly user-triggered, not automatic on every run completion — Requirement 12.7's "non-blocking" contract extends here, but this requirement additionally makes the MCP call opt-in per click, since summarizing 10 records is a heavier prompt than a single error message and should not fire silently in the background.

4. IF the MCP server is unavailable when "Get AI recommendation" is clicked, THE panel SHALL display "MCP unavailable" in place of the card, consistent with Requirement 12.7, and SHALL leave any already-displayed Heuristic_Recommendations untouched.

5. Heuristic_Recommendations SHALL be pure functions of the fetched `Run_Record[]` array — `computeBenchmarkRecommendations(records: RunRecord[]): Recommendation[]` and `computeArenaRecommendations(records: ArenaRunRecord[]): Recommendation[]` — living in `src/lib/playgroundRecommendations.ts`, so they are unit-testable without a server or network mock.

6. THE Arena sub-view SHALL compute a Heuristic_Recommendation when the same slot configuration (by `sourceLabel`) has won Performance_Winner or Quality_Winner in at least 4 of the last 5 Arena Run_Records → "[Slot config] has won N of the last 5 comparisons."

7. WHEN Run_History for the current model/config is empty (fewer than 2 records), THE Recommendations panel SHALL NOT render — there is nothing to compare yet, and an empty or placeholder panel would be visual noise on every first run.

---

### Requirement 18: Arena Slot Convenience Sources

**User Story:** As a developer, I want easy ways to load Olive-optimized local models and my active AI Assistant API model into Arena slots, so that I can compare outputs without re-finding files or re-typing endpoint credentials.

#### Acceptance Criteria

1. WHEN a Model_Slot is in `"Local file"` mode, THE Arena sub-view SHALL render a "From Olive outputs" control beneath (or adjacent to) the existing file drop-zone. THE control SHALL remain available alongside manual drop/select; it does not replace Requirement 5.2.

2. WHEN the user opens "From Olive outputs", THE Arena sub-view SHALL fetch Olive_Output_Entry items via `GET /api/arena/olive-outputs` (no client-supplied root paths) and display:
   - a **Recent** section: up to 10 entries sorted by modification time descending across all Olive_Output_Roots;
   - a **Browse** section: a flat or shallow-tree listing of `.onnx` / `.ort` files under those roots (depth and pagination may be capped server-side; see design).
   THE server SHALL resolve Olive_Output_Roots from its own canonical configuration (empty cache → `~/.cache/olive`; missing output → `./models/optimized`). List responses SHALL expose only opaque Olive_Output_Artifact_Id values plus display metadata — never absolute filesystem paths.

3. WHEN the user selects an Olive_Output_Entry, THE Arena sub-view SHALL request the file bytes via `GET /api/arena/olive-outputs/file?id=<Olive_Output_Artifact_Id>`, construct a Session_Scoped browser `File` (or equivalent `Blob` assigned as the slot's `file`) with the entry's basename, and write it into that Model_Slot via the same store path as a drop-zone pick (`setSlotA` / `setSlotB` with `{ file }`). THE slot header SHALL then show filename and size per Requirement 5.5.

4. THE server-side list and file endpoints SHALL sandbox reads to Olive_Output_Roots only, with separate list vs download contracts:
   - **List (`GET /api/arena/olive-outputs`)**: THE server SHALL scan only server-owned canonical Olive_Output_Roots and SHALL validate each discovered candidate (containment inside a resolved root, regular file, allowed extension `.onnx` / `.ort`) before minting an opaque Olive_Output_Artifact_Id and including the entry. Listing SHALL NOT require a client-supplied opaque id.
   - **Download (`GET /api/arena/olive-outputs/file`)**: THE server SHALL resolve the opaque id to a candidate path, then re-validate root containment, regular-file status, allowed extension (`.onnx` / `.ort`), positive file size (reject zero-byte), and response-size limits before reading or streaming any bytes.
   IF the id is unknown, the path escapes roots (including symlink escape), the file is not a regular model file, the file is empty (zero bytes), or the size exceeds the limit, THEN THE download handler SHALL return `403` (or `400`) with an empty body (no JSON error payload and no model bytes) and SHALL NOT read or stream any bytes. Both endpoints SHALL reject client-supplied `path`, `absolutePath`, `cacheDir`, and `outputDir` query parameters with an empty `400`/`403` response.

5. IF no Olive_Output_Entry files are found under any allowed root, THE "From Olive outputs" UI SHALL show an empty state explaining that no `.onnx`/`.ort` files were found under the cache/output directories, and SHALL leave the drop-zone usable. IF the list or file fetch fails (network/server error), THE UI SHALL show an inline error and SHALL NOT clear an already-loaded slot file.

6. WHEN a Model_Slot is in `"Cloud / API"` mode, THE Arena sub-view SHALL render a "Use active Assistant provider" control above or beside the manual endpoint/API key/model fields. THE control SHALL remain available alongside manual editing; it does not replace Requirement 5.3.

7. WHEN the user activates "Use active Assistant provider", THE Arena sub-view SHALL call `GET /api/arena/assistant-cloud-snapshot`. IF the active Assistant provider is an OpenAI_Compat_Provider and credentials/endpoint/model are available, THE endpoint SHALL return an Assistant_Cloud_Snapshot and THE Arena sub-view SHALL write `{ type: "cloud", endpointUrl, apiKey, modelId }` into that slot as a one-time snapshot. Fields SHALL remain editable afterward. Subsequent changes in Assistant settings SHALL NOT mutate the slot unless the user clicks the control again. THE endpoint SHALL send `Cache-Control: no-store, private` on every response (eligible, ineligible, and forbidden).

8. IF there is no active Assistant provider, OR the active provider is not an OpenAI_Compat_Provider (including when `baseUrl` fails the shared outbound endpoint policy), OR required snapshot fields cannot be resolved, THEN `GET /api/arena/assistant-cloud-snapshot` SHALL return `{ eligible: false, reason: string }` (HTTP 200) with `Cache-Control: no-store, private` and THE Arena sub-view SHALL disable or soft-fail the control with that reason (e.g. "No Assistant provider configured", "Active provider is not OpenAI-compatible; use Custom / openai-compat, or enter endpoint fields manually"). THE manual cloud fields SHALL remain usable.

9. THE Assistant_Cloud_Snapshot response MAY include the API key because Olive Studio is local-first and Arena already sends `apiKey` from the client to `POST /api/arena/cloud-inference`. `GET /api/arena/assistant-cloud-snapshot` SHALL enforce the same local-first access boundary as the cloud-inference proxy (loopback-only by default, or an equivalent authenticated gate); unauthorized / non-local requests SHALL be rejected (`403`) with `Cache-Control: no-store, private` and MUST NOT return `apiKey`. THE key SHALL NOT be logged server-side (same contract as Requirement 7's cloud proxy). THE snapshot SHALL NOT be written to `localStorage`, history records, or any persisted Playground state.

10. Convenience fills (Olive file or Assistant snapshot) SHALL be independent per Model_Slot. Filling Slot A SHALL NOT alter Slot B. Switching a slot's type between local and cloud SHALL clear the opposite-mode fields for that slot only (file cleared when switching to cloud; cloud fields cleared when switching to local), consistent with existing Arena slot behavior.

11. Requirements 6–8 (execution, concurrent local+cloud, result display) SHALL treat convenience-filled slots identically to manually configured slots of the same `type`. No separate execution path is required beyond obtaining the `File` or cloud credentials into `ArenaSlotConfig`.
