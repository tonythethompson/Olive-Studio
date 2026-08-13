# Requirements Document

## Introduction

This document specifies the v0.5.0 release of Olive Studio, covering four workstreams: (1) Unified Assistant — merging Audit and Chat into a single experience with a shared finding/action contract, workspace fingerprinting, and MCP-backed retrieval; (2) Agent UI — manual vs agent mode toggle, real-time activity log, and multi-model batch comparison in the Execute panel; (3) Product — optimization report export (Markdown/PDF), recipe catalog version pinning, and MultiLoRA adapter support (blocked); (4) Distribution — MCP Docker deployment docs, PyPI publish of `olive-mcp-server`, and Tauri signed installer.

## Glossary

- **Assistant_Panel**: The unified sidebar panel (`src/components/features/assistant/`) that replaces the separate Audit and Chat tabs with a single conversational experience anchored by a collapsible Pipeline Review section.
- **Pipeline_Review**: A persistent, collapsible summary block at the top of the Assistant_Panel showing the efficiency score, findings with evidence, last-checked timestamp, and staleness state.
- **Finding**: A discrete deficiency or observation reported by the review engine, replacing the legacy `Suggestion` type. Each Finding carries a severity, evidence string, and one or more associated Actions.
- **Action**: A structured next-step attached to a Finding. Action kinds: `applyPatch` (UIState patch), `navigate` (scroll/focus a UI element), `explain` (show rationale in chat), `documentation` (open knowledge-base article).
- **Workspace_Fingerprint**: A deterministic hash derived from the current UIState that identifies the exact pipeline configuration at review time. Used to invalidate stale findings when the workspace changes.
- **MCP_Knowledge_Base**: The Python-side knowledge base (`olive-mcp-server/olive_mcp_server/knowledge_base/`) containing `passes.json`, `hardware_profiles.json`, and related reference data.
- **Agent_Mode**: An execution mode in the Execute panel where the MCP agent loop (`plan_optimization`, `execute_and_observe`, `diagnose_and_fix`) runs autonomously with real-time activity logging.
- **Manual_Mode**: The default execution mode where the user explicitly triggers recipe build, validation, and job submission.
- **Activity_Log**: A chronological stream of agent reasoning steps, tool invocations, decisions, and outcomes displayed in the Execute panel during Agent_Mode.
- **Batch_Comparison_View**: The existing component (`BatchComparisonView.tsx`) that presents a sortable table comparing two or more job history records on duration, VRAM, status, and model metrics.
- **Report_Generator**: The module (`src/lib/reportGenerator.ts`) that produces Markdown reports from job history records and optionally triggers browser-print PDF export.
- **Recipe_Catalog**: The collection of community and official Olive recipes fetched from the `microsoft/Olive` recipes repository, indexed by architecture and device target.
- **Pipeline_Store**: The zustand store (`src/lib/stores/pipelineStore.ts`) that holds all UI state and routes mutations through `commitUiStateUpdate`.
- **Deterministic_Validation**: The synchronous rule engine (`src/lib/pipelineValidation.ts`) that evaluates `CROSS_PASS_RULES` and provider conflicts without AI calls.
- **MCP_Tool**: A Python tool in the FastMCP server invoked via stdio or HTTP proxy (`POST /api/mcp/tool`).

## Requirements

### Requirement 1: Unified Assistant Panel Structure

**User Story:** As a user, I want Audit and Chat merged into a single Assistant experience so that review findings and conversational help share one context without tab-switching.

#### Acceptance Criteria

1. WHEN the Assistant sidebar opens, THE Assistant_Panel SHALL display exactly two top-level tabs: "Assistant" and "Settings".
2. THE Assistant_Panel SHALL render a collapsible Pipeline_Review section at the top of the Assistant tab, above the chat conversation.
3. WHEN the Pipeline_Review section is expanded, THE Assistant_Panel SHALL display the efficiency score (0–100), the level label, the last-checked timestamp, and a list of Findings with their evidence text.
4. WHEN the Pipeline_Review section is collapsed, THE Assistant_Panel SHALL display a compact summary showing only the score badge and the count of unresolved Findings.
5. THE Assistant_Panel SHALL render the chat conversation and message input below the Pipeline_Review section within the same scrollable container.
6. WHEN the Assistant sidebar opens for the first time in a session, THE Pipeline_Review section SHALL be expanded by default.
7. IF no review data exists when the sidebar opens, THE Pipeline_Review section SHALL display a zero-state message ("No review yet — click Refresh to analyze your pipeline") with a visible Refresh button.
8. THE Pipeline_Review expand/collapse toggle SHALL be activatable by clicking the section header or pressing Enter/Space when the header is focused.

### Requirement 2: Shared Finding/Action Contract

**User Story:** As a user, I want every review finding to carry a useful next action so that I always have a clear path forward from a reported deficiency.

#### Acceptance Criteria

1. THE Finding type SHALL define the following fields: `id` (string, unique within a single review run), `title` (string, maximum 120 characters), `description` (string, maximum 2000 characters), `severity` ("critical" | "warning" | "info"), `evidence` (string), and `actions` (array of Action objects containing between 1 and 10 elements).
2. THE Action type SHALL define the following fields: `kind` ("applyPatch" | "navigate" | "explain" | "documentation"), `label` (string, maximum 80 characters), and `payload` (an object whose schema is determined by `kind`: for `applyPatch` the payload conforms to `ChatActionPatch`; for `navigate` the payload contains a target panel identifier; for `explain` the payload contains a markdown-formatted explanation body; for `documentation` the payload contains a documentation URL or topic key).
3. WHEN an Action has kind `applyPatch`, THE Action payload SHALL conform to the validated `ChatActionPatch` schema used by the existing chat action system, meaning `sanitizeChatActionPatch(payload)` returns a non-null result.
4. WHEN a Finding is reported, THE Assistant_Panel SHALL display at least one Action for that Finding.
5. IF `sanitizeChatActionPatch` returns null for every candidate patch associated with a Finding, THEN THE Assistant_Panel SHALL display an `explain` or `documentation` Action as the fallback next step.
6. WHEN the user activates an `applyPatch` Action, THE Pipeline_Store SHALL apply the patch through `commitUiStateUpdate` and THE Pipeline_Review SHALL schedule a re-run no sooner than 300 milliseconds and no later than 1000 milliseconds after the patch is committed.
7. IF `commitUiStateUpdate` produces a coercion that changes the applied patch (i.e., the committed state differs from the requested patch fields), THEN THE Assistant_Panel SHALL display an inline notice indicating which fields were auto-corrected.
8. WHEN the user activates a `navigate`, `explain`, or `documentation` Action, THE Assistant_Panel SHALL execute the action within 200 milliseconds without modifying Pipeline_Store state.

### Requirement 3: Workspace Fingerprint and Staleness

**User Story:** As a user, I want review findings bound to my current pipeline state so that stale results from a previous configuration cannot overwrite my current workspace.

#### Acceptance Criteria

1. WHEN a review is initiated, THE Assistant_Panel SHALL compute a Workspace_Fingerprint by hashing the current UIState excluding transient fields (activeJobId, localFiles) and attach it to the resulting Findings set.
2. WHEN review results arrive, THE Assistant_Panel SHALL compare the result fingerprint against the live Workspace_Fingerprint within 100 milliseconds of result receipt.
3. IF the result fingerprint does not match the current Workspace_Fingerprint, THEN THE Assistant_Panel SHALL discard the stale results without rendering them in the Findings list and display a persistent "Results outdated — re-run review" indicator until the user initiates a new review.
4. WHEN the user applies a patch Action that produces a UIState with a different Workspace_Fingerprint than the previous state, THE Assistant_Panel SHALL recompute the Workspace_Fingerprint and mark all existing Findings as stale by displaying a visual staleness indicator on each Finding entry.
5. THE Workspace_Fingerprint computation SHALL be deterministic: two UIState objects that are deeply equal (identical keys and values after transient-field exclusion) SHALL produce byte-identical fingerprints, and the computation SHALL complete within 50 milliseconds for a UIState containing up to 30 enabled passes.
6. IF a new review is initiated while a previous review is still in-flight, THEN THE Assistant_Panel SHALL abandon the in-flight review results upon arrival (treat them as stale) and use only the results from the most recently initiated review.
7. WHEN UIState changes result in a no-op patch (computed Workspace_Fingerprint is identical before and after the update), THE Assistant_Panel SHALL retain existing Findings without marking them as stale.

### Requirement 4: MCP Knowledge Retrieval Modes

**User Story:** As a user, I want the review engine and chat to share the same MCP knowledge base with appropriate retrieval scopes so that automatic reviews stay focused while my freeform questions can draw on broader context.

#### Acceptance Criteria

1. WHEN the automatic Pipeline_Review runs, THE retrieval system SHALL query only MCP_Knowledge_Base entries tagged with at least one of the active passes, the selected execution provider, or the detected hardware profile, returning a maximum of 10 results per query.
2. WHEN the user asks a freeform question in chat, THE retrieval system SHALL query across all MCP_Knowledge_Base entries without pass, provider, or hardware-profile filtering, returning a maximum of 20 results per query.
3. THE review engine and the chat system SHALL share the same validated `ChatActionPatch` schema for any actions that modify UIState, rejecting patches containing keys not present in the `ChatActionPatch` type definition by returning `null` from `sanitizeChatActionPatch`.
4. THE retrieval system SHALL respect the `OLIVE_MCP_RETRIEVAL_MODE` environment variable for mode selection (values: `auto`, `keyword`, `semantic`; default: `auto`).
5. IF the `OLIVE_MCP_RETRIEVAL_MODE` environment variable is set to an unrecognized value, THEN THE retrieval system SHALL fall back to `auto` mode without raising an error.
6. IF the MCP_Knowledge_Base is unreachable or the semantic retrieval budget (controlled by `OLIVE_MCP_SEMANTIC_BUDGET_MS`, default 8000 ms) is exceeded during `auto` mode, THEN THE retrieval system SHALL fall back to keyword-based retrieval and include `retrieval.degraded = true` in its response metadata.

### Requirement 5: Deterministic Validation Authority

**User Story:** As a developer, I want deterministic pipeline validation to remain authoritative over AI review findings so that rule-engine issues are never contradicted by probabilistic AI output.

#### Acceptance Criteria

1. WHEN the Deterministic_Validation (via `CROSS_PASS_RULES` or `getProviderConflicts()`) reports a `PipelineIssue` and the AI audit produces an `AuditSuggestion` that targets the same pass field with a contradicting recommendation, THEN THE Pipeline_Review SHALL discard the conflicting `AuditSuggestion` and retain only the deterministic issue at its rule-defined severity.
2. WHEN the Deterministic_Validation reports an issue with severity "critical", THE Pipeline_Review SHALL display that issue at "critical" severity regardless of whether an AI `AuditSuggestion` for the same pass field assigns a lower impact level such as "Medium" or "Low".
3. THE automatic review refresh cycle (triggered by `/api/ai/analyze-state`) SHALL NOT append, prepend, or inject its `AuditAnalysis` results into the `chatHistory` array sent to `/api/ai/chat`, and SHALL NOT mutate the `chatMessages` state managed by the chat UI.
4. WHEN a chat message references a pipeline issue for which a matching `PipelineIssue` exists in the current `AiWorkspaceContext.validation.topIssues`, THE chat system SHALL include the deterministic issue's `title`, `severity`, and `description` in the system prompt context rather than generating a novel interpretation of the same concern.
5. IF the AI audit returns an `AuditSuggestion` whose `autofix.pass` field matches a pass already flagged as "critical" by `getProviderConflicts()` and the suggestion's recommended `autofix.value` would not resolve the deterministic conflict, THEN THE Pipeline_Review SHALL suppress that suggestion from the displayed audit results.

### Requirement 6: Agent Mode Toggle in Execute Panel

**User Story:** As a user, I want a Manual vs Agent mode toggle in the Execute panel so that I can choose between hands-on control and autonomous agent-driven optimization.

#### Acceptance Criteria

1. THE Execute panel SHALL display a mode toggle control with two mutually exclusive states: Manual_Mode (selected by default on first load) and Agent_Mode.
2. WHILE Manual_Mode is active, THE Execute panel SHALL display the recipe builder, JSON export, and single-job submission controls, and SHALL hide Agent_Mode controls (Activity_Log, Start Agent button, Stop Agent button).
3. WHILE Agent_Mode is active, THE Execute panel SHALL display a scrollable Activity_Log region (retaining up to the 200 most recent entries for the current session), a "Start Agent" button (enabled when the agent loop is not running), and a "Stop Agent" button (enabled only when the agent loop is running), and SHALL hide Manual_Mode submission controls.
4. WHEN the user presses "Start Agent" and the agent loop fails to begin within 10 seconds, THE Execute panel SHALL append an error entry to the Activity_Log indicating the failure reason and re-enable the "Start Agent" button.
5. WHEN the user switches from Agent_Mode to Manual_Mode while the agent loop is running, THE Execute panel SHALL display a confirmation dialog with "Confirm" and "Cancel" options; selecting "Confirm" SHALL cancel the agent loop and switch to Manual_Mode, and selecting "Cancel" SHALL dismiss the dialog and remain in Agent_Mode with the agent loop still running.
6. WHEN the agent loop terminates (whether by completion, failure, or user-initiated stop), THE Execute panel SHALL disable the "Stop Agent" button, re-enable the "Start Agent" button, and append a final status entry to the Activity_Log indicating the terminal outcome.

### Requirement 7: Agent Activity Log

**User Story:** As a user, I want a real-time activity log during agent execution so that I can observe reasoning steps, tool invocations, and decisions as they happen.

#### Acceptance Criteria

1. WHILE the agent loop is active, THE Activity_Log SHALL append each new entry within 500 ms of the underlying event and display all entries in chronological order with timestamps at second resolution (HH:MM:SS).
2. THE Activity_Log SHALL support the following entry types: `reasoning` (agent thought text, truncated to 512 characters with an expand affordance), `tool_call` (MCP tool name and arguments truncated to 256 characters), `tool_result` (outcome text truncated to 512 characters), `decision` (chosen action text truncated to 256 characters), and `error` (failure description truncated to 512 characters with originating step reference).
3. WHEN a new Activity_Log entry is appended, THE Activity_Log container SHALL auto-scroll to the latest entry unless the user has scrolled the container such that the previous latest entry is no longer visible in the viewport.
4. WHEN the agent loop completes or is stopped, THE Activity_Log SHALL display a terminal entry stating the outcome: success with total step count and elapsed wall-clock duration, failure with the error description from the failing step, or cancellation with the step at which cancellation occurred.
5. THE Activity_Log SHALL retain a maximum of 2000 entries for the current agent session. WHEN a new agent session starts, THE Activity_Log SHALL clear all entries from the previous session before appending new entries.
6. IF the Activity_Log reaches the 2000-entry maximum while the agent loop is still active, THEN THE Activity_Log SHALL discard the oldest entry for each new entry appended, maintaining the maximum count.

### Requirement 8: Multi-Model Batch Comparison Frontend

**User Story:** As a user, I want a batch comparison view connected to the `compare_results` MCP tool so that I can visually compare optimization outcomes across multiple models or configurations.

#### Acceptance Criteria

1. WHEN the batch job queue contains 2 or more jobs with status "completed", THE Execute panel SHALL enable a "Compare Results" action button that opens the Batch_Comparison_View populated with those completed job records.
2. WHEN fewer than 2 jobs in the batch queue have status "completed", THE Execute panel SHALL render the "Compare Results" action button in a disabled state with a tooltip indicating that at least 2 completed jobs are required.
3. THE Batch_Comparison_View SHALL display a sortable table with columns: Model (job identifier), Latency (ms), Model Size (MB), Accuracy, Weighted Score, and Status — matching the metric keys returned by the `compare_results` MCP tool (`latency_ms`, `model_size_mb`, `accuracy`, `score`).
4. WHEN the `compare_results` MCP tool returns a non-null `winner` field, THE Batch_Comparison_View SHALL visually distinguish the recommended configuration row from the other rows (e.g., highlight or badge) and display the tool's `reasoning` string adjacent to the table.
5. IF the `compare_results` MCP tool returns `winner: null` (fewer than 2 scoreable jobs after exclusions), THEN THE Batch_Comparison_View SHALL display an inline notice indicating that no recommendation could be determined and list each excluded job with its `reason` value from the `excluded_jobs` array.
6. THE Batch_Comparison_View SHALL accept a minimum of 2 and a maximum of 10 job records for comparison, matching the `compare_results` tool's input constraint of 2–10 job IDs.
7. THE Batch_Comparison_View SHALL allow the user to select a scoring preference (latency, size, accuracy, or balanced) before invoking the comparison, defaulting to "balanced".

### Requirement 9: Optimization Report Export

**User Story:** As a user, I want to export an optimization report as Markdown or PDF so that I can share results with stakeholders who do not use Olive Studio.

#### Acceptance Criteria

1. WHEN one or more job history records with status "completed", "failed", or "cancelled" exist, THE Execute panel SHALL display an "Export Report" menu item.
2. WHEN the user selects Markdown export, THE Report_Generator SHALL produce a `.md` file download containing: report title, generation timestamp (UTC, format `YYYY-MM-DD HH:mm:ss`), model identifier, hardware provider, memory offload setting, pass names in execution order, duration (formatted as seconds or minutes+seconds), terminal status with exit code, and VRAM estimate if available.
3. WHEN the user selects Markdown export and the report options include recipe JSON or log summary, THE Report_Generator SHALL append an expandable recipe JSON section and/or a log summary section (total log count, error count, last log line truncated to 200 characters) to each job detail block.
4. WHEN the user selects PDF export, THE Report_Generator SHALL open a print-friendly browser window with the rendered report content and trigger the browser print dialog within 500 ms of window load.
5. IF the browser blocks the print-friendly popup window, THEN THE Report_Generator SHALL not throw an unhandled error and SHALL take no further print action for that export attempt.
6. THE Report_Generator SHALL support single-job reports and multi-job comparison reports containing up to 100 job records.
7. WHEN the report includes two or more jobs with status "completed", THE Report_Generator SHALL include a comparison section identifying the fastest job by duration, the lowest VRAM job (if VRAM data is present), and the average duration across completed jobs.
8. WHERE the `reportExport` feature flag is disabled, THE Execute panel SHALL hide the "Export Report" menu item entirely and SHALL not expose report generation functionality.
9. WHEN the user triggers Markdown export, THE Report_Generator SHALL name the downloaded file using the pattern `olive-report-YYYY-MM-DD.md` where the date is the current UTC date.

### Requirement 10: Recipe Catalog Version Pinning

**User Story:** As a user, I want recipe catalog entries pinned to a specific repository commit so that my loaded recipes remain reproducible even when the upstream catalog updates.

#### Acceptance Criteria

1. WHEN the Recipe_Catalog is fetched from the configured repository, THE system SHALL resolve the HEAD commit of the active branch via the GitHub API and record the full 40-character hexadecimal Git commit SHA from which each recipe entry was loaded.
2. WHEN a recipe is loaded into the workspace, THE Pipeline_Store SHALL persist the source commit SHA (40-character hex string) and the branch name alongside the recipe data so that subsequent exports or re-fetches reference the exact same revision.
3. WHEN the user opens the Recipe Catalog panel and the last catalog fetch occurred more than 60 seconds ago, THE system SHALL check the upstream HEAD commit of the active branch and, if it differs from the stored SHA, display an inline notification within the catalog panel indicating that newer recipes are available without automatically replacing pinned recipes.
4. WHEN the user explicitly triggers the catalog refresh action, THE system SHALL fetch the latest HEAD commit from the configured branch, update the stored SHA, and replace the catalog entries with the contents at that new commit.
5. IF the catalog fetch or commit SHA resolution fails due to network error, HTTP non-2xx response, or an unresolvable branch reference, THEN THE system SHALL retain the previously stored catalog and SHA unchanged and display an error message indicating the fetch failure reason (network, authentication, or branch-not-found).
6. THE recipe catalog fetch SHALL use the branch returned by `getRecipesBranch()` (defaulting to `OLIVE_RECIPES_BRANCH_DEFAULT`) and record both the resolved branch name and the full 40-character commit SHA in the stored catalog metadata.
7. IF the user loads a recipe whose pinned commit SHA is no longer reachable in the upstream repository, THEN THE system SHALL serve the recipe from local cache if available, or display an error message indicating the pinned revision is unavailable upstream.

### Requirement 11: MultiLoRA Adapter Support (Blocked)

**User Story:** As a user, I want multi-adapter LoRA switching support so that I can configure and manage multiple LoRA adapters in a single optimization pipeline.

#### Acceptance Criteria

1. WHILE the `multiLora` feature flag is disabled (default), THE recipe builder SHALL hide Multi-LoRA UI panels and documentation links, and SHALL reject recipe configurations containing more than one adapter entry by treating the recipe as single-adapter mode using only the `adapter_path` field.
2. WHEN the `multiLora` feature flag is enabled and the user provides an `adapters` array in the recipe configuration, THE recipe builder SHALL validate each adapter entry requiring: a non-empty string `name` (unique across all entries in the array), a non-empty string `path`, a positive integer `rank`, a positive finite number `alpha`, and an optional `targetModules` array of non-empty strings, and SHALL emit the validated adapters in the recipe JSON using the format compatible with the Olive 0.13.0 `ExtractAdapters` pass schema.
3. IF the `multiLora` feature flag is enabled and any adapter entry in the `adapters` array fails validation, THEN THE recipe builder SHALL report a per-entry error message identifying the adapter index and the invalid field, and SHALL NOT emit the recipe JSON.
4. WHILE the `multiLora` feature flag is enabled, THE recipe builder SHALL enforce a maximum of 2 adapter entries in the `adapters` array for hardware profiles with 12 GB VRAM or less, and SHALL accept up to 8 adapter entries for hardware profiles above 12 GB VRAM.
5. IF duplicate adapter names are detected within the `adapters` array, THEN THE recipe builder SHALL report a validation error identifying the duplicated name and the conflicting entry indices.
6. THE MultiLoRA implementation SHALL remain blocked and SHALL NOT emit runtime adapter-loading artifacts until all graduation-gate conditions documented in `docs/multilora-design.md` are satisfied: (a) Olive >= 0.3.0 documents multi-adapter optimization as supported, (b) end-to-end test demonstrates 2 adapters loaded and switched at runtime with correct output on ORT 1.21+, (c) VRAM budget for 2-adapter configuration does not exceed 110% of single-adapter baseline, and (d) recipe schema extension maintains backward compatibility with v0.2.0 single-adapter recipes.

### Requirement 12: MCP Docker Deployment Documentation

**User Story:** As a user deploying the MCP server independently, I want a user-facing Docker deployment guide so that I can run `olive-mcp-server` in a containerized environment without reading source code.

#### Acceptance Criteria

1. THE documentation SHALL include a `docker run` command example that specifies the `MCP_TRANSPORT`, `MCP_HOST`, `MCP_PORT`, and `OLIVE_MCP_RETRIEVAL_MODE` environment variables, a read-only volume mount for the knowledge base directory, and a port mapping for port 8000.
2. THE documentation SHALL list each configurable environment variable (`OLIVE_MCP_RETRIEVAL_MODE`, `OLIVE_MCP_SEMANTIC_BUDGET_MS`, `OLIVE_MCP_PRELOAD_EMBEDDINGS`, `SYNC_KB_TOKEN`) with its accepted values, default value, and a one-sentence description of its effect on server behavior.
3. THE documentation SHALL include a `docker-compose.yml` example that defines the MCP server service and an Olive Studio Express application service connected on a shared Docker network, with the Express service configured to reach the MCP server by service name.
4. THE documentation SHALL state the minimum Docker Engine version as 20.10 or later, list port 8000 as the single required published port, and identify `GET /sse` on port 8000 as the health-check endpoint with expected connection-open response indicating readiness.
5. THE documentation SHALL reference the `olive-mcp-server/Dockerfile` by relative path, state that the build context is the `olive-mcp-server/` directory, and note that the multi-stage build produces an image of approximately 1.5–3 GB due to bundled CPU PyTorch and sentence-transformers dependencies.
6. THE documentation SHALL include a verification step that the user can execute after `docker run` or `docker compose up` to confirm the server is healthy, consisting of a single `curl` or `docker inspect --format` command with the expected output described.

### Requirement 13: PyPI Publish of olive-mcp-server

**User Story:** As a developer, I want `olive-mcp-server` published on PyPI so that I can install it as a standalone package without cloning the full Olive Studio repository.

#### Acceptance Criteria

1. THE `olive-mcp-server` package SHALL be installable via `pip install olive-mcp-server` from PyPI on Python 3.10 and above.
2. THE published package SHALL include as package data all JSON files in the `knowledge_base/` directory and all files in the `knowledge_base/indexes/` subdirectory, so that pass catalog queries, hardware profile lookups, and semantic retrieval function without network access to the source repository.
3. THE package SHALL declare `mcp<2` as a dependency constraint in its metadata to prevent incompatible `mcp` versions from installing.
4. THE package SHALL expose a `olive-mcp-server` console entry point that launches the FastMCP stdio server.
5. WHEN installed from PyPI, THE package SHALL expose the same set of MCP tools with the same tool names and input schemas, and return knowledge base query results from the same bundled data, as running `python olive-mcp-server/run.py` from the repository checkout at the corresponding version.
6. WHEN a Git tag matching the pattern `mcp-server/v<MAJOR>.<MINOR>.<PATCH>` is pushed, THE CI pipeline SHALL build the sdist and wheel, verify the package version in `pyproject.toml` matches the tag version, and upload the artifacts to PyPI.
7. IF the version declared in `pyproject.toml` does not match the version extracted from the triggering Git tag, THEN THE publish workflow SHALL fail without uploading to PyPI and SHALL report the version mismatch in the workflow logs.

### Requirement 14: Tauri Signed Installer

**User Story:** As a desktop user, I want a signed installer for Olive Studio so that my operating system does not flag the application as untrusted.

#### Acceptance Criteria

1. THE build pipeline SHALL produce a signed installer artifact for Windows (`.msi` or `.exe`) using a code-signing certificate (OV or EV).
2. THE build pipeline SHALL produce a signed and notarized installer artifact for macOS (`.dmg`) using a Developer ID Application certificate, with the notarization ticket stapled to the `.dmg` before upload.
3. WHEN the signed installer is executed on Windows 10 or later, or macOS 12 (Monterey) or later, THE operating system SHALL not display an "untrusted publisher" or Gatekeeper warning.
4. THE signing workflow SHALL store certificate credentials as CI secrets and never embed them in source code or build logs.
5. THE Tauri build configuration (`src-tauri/tauri.conf.json`) SHALL reference the signing identity via environment variable placeholders without hardcoding private keys, passwords, or passphrases.
6. IF the code-signing certificate is unavailable during CI, THEN THE build pipeline SHALL produce an unsigned installer, emit a warning to the CI job log indicating the artifact is unsigned, and complete the job with a non-failure exit code.
7. THE build pipeline SHALL upload signed installer artifacts to the CI run's artifact storage with filenames that include the target platform and build version.
