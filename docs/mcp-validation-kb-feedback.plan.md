## Goal

Make Olive Studio’s MCP guidance more actionable and trustworthy by exposing UIState-backed recipe validation/building, evidence-validating the compatibility matrix, automating reviewable KB refreshes, and using local diagnostic feedback to improve future troubleshooting ranking.

## Approach

The TypeScript app already owns recipe construction and validation in `src/lib/recipePipeline.ts:32`; the Python MCP server cannot import those functions directly. Add one authenticated-local Studio bridge endpoint that runs the existing builder and validators, then make two Python MCP tools call that bridge through a fixed, configured local base URL and fail explicitly when Studio is unavailable. Keep feedback local and aggregate-only, and make KB updates reviewable through a scheduled PR rather than allowing generated source data to auto-merge.

## File Changes

- **Modify** `src/lib/recipePipeline.ts:32-54` — expose a stable, JSON-safe UIState recipe-validation payload derived from the existing sanitized state, recipe, pipeline validation, schema validation, advisories, and local-execution issues.
- **Modify** `src/lib/stores/pipelineStore.ts:6-49` — export/reuse a default-state factory so the server bridge can safely merge a proposed partial UIState with the same defaults used by the UI.
- **Create** `src/server/services/mcp/studioRecipeBridge.ts` — validate untrusted bridge input, construct the effective UI state, call the recipe pipeline once, and map results into the MCP response contract.
- **Modify** `src/server/routes/mcp.ts:1-210` — add a rate-limited, loopback-only `POST /api/mcp/studio-recipe` bridge endpoint separate from the generic Python-MCP proxy.
- **Modify** `src/server/middleware/rateLimit.ts` — add the narrow rate-limit policy for the new no-side-effect bridge request.
- **Modify** `src/server/__tests__/routes.integration.test.ts:235-278` — test valid UIState recipe/validation responses, malformed state rejection, and the no-execution guarantee.
- **Modify** `src/lib/__tests__/recipePipeline.test.ts` — lock the shared payload to existing schema and pipeline validation behavior.
- **Create** `olive-mcp-server/olive_mcp_server/tools/studio_recipe.py` — implement `validate_ui_state_recipe` and `get_recipe_for_ui_state`, with a fixed `OLIVE_STUDIO_API_URL` loopback configuration, timeout, response-shape checks, and a clear unavailable-bridge response.
- **Modify** `olive-mcp-server/olive_mcp_server/mcp_server.py:20-48` and `olive-mcp-server/olive_mcp_server/tools/__init__.py:16-41,164-187` — lazily register and export the two bridge tools.
- **Modify** `olive-mcp-server/tests/test_integration.py:13-23` and **Create** `olive-mcp-server/tests/test_studio_recipe.py` — verify MCP registration, successful bridge forwarding with mocked HTTP, timeout/unavailable behavior, and response contracts without invoking Olive.
- **Modify** `olive-mcp-server/schemas/compatibility-v1.json:1-91` — require per-pass provenance and a canonical Olive pass identifier for every matrix claim, retaining the existing support/warning/unsupported status model.
- **Modify** `olive-mcp-server/olive_mcp_server/knowledge_base/compatibility_matrix.json:1+` — expand source-backed model/hardware/pass coverage and annotate each compatibility claim with its evidence and canonical pass name.
- **Create** `olive-mcp-server/tests/test_compatibility_matrix.py` — assert schema-level required fields, unique model/hardware/pass rows, valid support states, and that every referenced canonical pass exists in `knowledge_base/passes.json`.
- **Modify** `.github/workflows/ci.yml` — add a lightweight, pinned-Olive availability job that imports/enumerates the installed Olive pass registry and compares it against matrix claims; it must not execute a model optimization.
- **Modify** `.github/workflows/kb-update.yml:1-39` — run both `update_kb.py` and `expand_kb.py`, validate generated KB data, and open/update a labeled refresh PR when the generated knowledge files change; retain the artifact upload for traceability.
- **Modify** `olive-mcp-server/scripts/update_kb.py:1-120` and `olive-mcp-server/scripts/expand_kb.py:674-681` — emit deterministic refresh metadata (source timestamp, generator version, changed files) consumed by the workflow and compatibility validation.
- **Modify** `olive-mcp-server/olive_mcp_server/tools/troubleshooting.py:32-85,448-570` — add bounded, local persistent aggregate feedback keyed by matched-entry ID and integrate a small capped ranking adjustment into the existing hybrid scorer.
- **Create** `olive-mcp-server/olive_mcp_server/tools/feedback.py` — expose `record_troubleshoot_feedback` with `matched_entry`, thumbs-up/down rating, and optional bounded reason code; write atomically to a user-data location, never storing the log or traceback.
- **Modify** `olive-mcp-server/olive_mcp_server/mcp_server.py:20-48` and `olive-mcp-server/olive_mcp_server/tools/__init__.py:16-41,164-187` — register/export the feedback tool.
- **Modify** `src/types.ts:157-171`, `src/lib/hooks.ts:77-175`, and `src/components/features/MCPDiagnosticCard.tsx:8-190` — carry the stable matched-entry identifier, render accessible thumbs-up/down controls for a shown MCP diagnosis, and POST feedback through the existing MCP proxy without blocking diagnosis display.
- **Modify** `src/components/features/ExecutionWorkspace.tsx:171-352,1505+` and `src/components/features/BatchProcessingPanel.tsx:63-806` — wire the card callback through each existing diagnostic surface and preserve local diagnosis history behavior.
- **Modify** `src/components/features/ExecutionWorkspace.test.tsx`, `src/components/features/BatchProcessingPanel.test.tsx`, and **Create** `src/components/features/MCPDiagnosticCard.test.tsx` — cover button state, one submission per selected result/rating, proxy failures, and no controls for unmatched/local-only diagnoses.
- **Modify** `olive-mcp-server/tests/test_troubleshooting_hybrid.py`, `olive-mcp-server/tests/test_troubleshoot_integration.py:40-401`, and **Create** `olive-mcp-server/tests/test_feedback.py` — test atomic local persistence, invalid input, bounded score effects, ranking changes, and reset/isolation via a temporary feedback path.
- **Modify** `olive-mcp-server/README.md:70-135` and `README.md` — document the bridge precondition, both new MCP tools, local-only feedback/privacy behavior, and KB refresh PR process.

## Implementation Steps

### Task 1: Define the UIState recipe bridge contract

1. In `src/lib/stores/pipelineStore.ts:6-49`, extract the current initial state into a factory/export so server-only callers get the same field defaults and pass defaults as UI callers.
2. In `src/lib/recipePipeline.ts:32-54`, add a pure projection helper around `buildRecipeFromState`; return `effectiveState`, `recipe`, schema errors, pipeline issues/counts, advisories, local-execution issues, warnings, and `isRunnable`. Do not launch Olive or create temp files.
3. Create `src/server/services/mcp/studioRecipeBridge.ts` to accept a record, reject non-object and malformed nested `passes` fields, merge allowed partial values into the default state, and invoke the projection helper once. Ignore/reject unknown dangerous fields rather than accepting arbitrary server configuration.
4. Add the private bridge route in `src/server/routes/mcp.ts:196+`. Restrict its host configuration to an explicit loopback Studio URL, preserve normal JSON error conventions, and use the new conservative rate limit.
5. Add focused unit and integration tests proving a blocked pipeline returns its recipe plus structured issues, an invalid proposal produces a 400 response, and the bridge never reaches the `/olive/run` execution route.

### Task 2: Expose bridge-backed MCP tools

1. Create `olive-mcp-server/olive_mcp_server/tools/studio_recipe.py` with a shared request helper that reads only `OLIVE_STUDIO_API_URL`, permits loopback HTTP(S) endpoints, uses a short timeout, and normalizes network/HTTP failures into `studio_unavailable` results.
2. Implement `validate_ui_state_recipe(ui_state)` as the compact validation view (sanitized effective state, schema/pipeline/runtime errors, advisories, runnable boolean) and `get_recipe_for_ui_state(ui_state)` as the same canonical evaluation plus `olive_recipe` and conversion warnings. Both must call the same bridge response and must never shell out to or run Olive.
3. Register both tools in `mcp_server.py:20-48` and `tools/__init__.py:16-41,164-187`, then add direct and FastMCP invocation tests with mocked bridge responses.
4. Update `olive-mcp-server/README.md:70-135` with input/response examples and the clear requirement that a compatible local Studio server is running.

### Task 3: Make compatibility claims evidence-backed and availability-checked

1. Extend `schemas/compatibility-v1.json:1-91` with required pass-level `olive_pass`, evidence URL/reference, evidence type, and evidence/version fields while preserving current clients’ `support`, `note`, and `typical_accuracy_drop` fields.
2. Expand `compatibility_matrix.json` using official Olive/ONNX Runtime sources or recorded availability evidence, naming the precise pass represented by each claim. Do not assert a pass is supported solely from model family inference.
3. Add `test_compatibility_matrix.py` that loads the matrix and `passes.json`, rejects unknown pass names, absent provenance, duplicate claims, malformed version ranges, and claims outside the declared Olive support window.
4. Add a separate CI job in `.github/workflows/ci.yml` that installs the project’s pinned Olive version and enumerates/imports the relevant pass registry. Compare availability only; do not download models or run optimization. Fail the job when a matrix `supported` or `warning` claim names a pass not available in that Olive version.

### Task 4: Turn KB refresh into a reviewable automation loop

1. Modify `update_kb.py:1-120` and `expand_kb.py:674-681` to write deterministic metadata for the sources, generation time, generator version, and changed knowledge files; avoid timestamps in content that cause a no-op refresh to produce a diff.
2. Update `.github/workflows/kb-update.yml:1-39` to run update, expansion, compatibility validation, and the Python MCP tests on the scheduled Monday job.
3. When tracked KB files differ, use a least-privilege GitHub-token workflow to create or refresh one labeled PR containing the changes and generated report; otherwise finish successfully without a PR. Do not auto-merge or overwrite a human-edited PR.
4. Retain artifacts so review can inspect candidate quirks and provenance even when no KB data changes.

### Task 5: Add private feedback-driven troubleshooting refinement

1. Add a feedback data store owned by `troubleshooting.py:32-85` or a dedicated persistence helper: aggregate only per entry ID/rating counts, write atomically under a user configuration directory (overridable for tests), cap entries/count influence, and expose an explicit reset helper for tests.
2. Add `record_troubleshoot_feedback` in `tools/feedback.py`, validate known matched-entry IDs and the two allowed ratings, and return the aggregate acknowledgement without accepting traceback text or arbitrary free-form content.
3. Add a bounded score adjustment after the existing semantic/keyword computation in `troubleshooting.py:448-570`; positive feedback can only break close ties/boost slightly, while negative feedback can only demote slightly. Preserve keyword exact matches and existing no-match behavior.
4. Register the feedback MCP tool, then add persistence, malformed input, score-bound, and cross-process-file fixtures in the Python test suite.
5. In `MCPDiagnosticCard.tsx:8-190`, render accessible thumbs controls only for MCP diagnoses with a matched entry; disable after successful submission, expose retry on failure, and leave “Apply Fix” semantics unchanged.
6. Thread the handler through the existing execution and batch diagnostics and update shared `McpDiagnostic` typing and hook payload guards. Add component tests for positive/negative feedback and API failure without regressions to diagnosis history or fix application.

## Acceptance Criteria

- A complete or allowed-partial UIState sent to `validate_ui_state_recipe` returns schema errors, pipeline issues, runtime-local issues, advisories, effective state, and a deterministic `isRunnable` value without starting an Olive process.
- `get_recipe_for_ui_state` returns the same validation result plus the exact recipe produced by `buildRecipeFromState` for the effective state.
- If Studio is not running or the bridge is misconfigured, both MCP tools return a structured unavailable error within the configured timeout and do not silently duplicate or approximate TypeScript validation.
- Every compatibility-matrix pass claim has a canonical `olive_pass`, nonempty source evidence, and a pass name present in `passes.json`; CI fails if the installed pinned Olive version cannot enumerate/import a claimed supported/warning pass.
- The scheduled KB workflow runs both generators and tests, creates/updates at most one labeled refresh PR only when tracked KB outputs change, and never auto-merges it.
- A diagnosis with a matched MCP entry displays exactly one accessible thumbs-up and one thumbs-down control; local/unmatched diagnoses display neither.
- Feedback persists across MCP process restarts only in the local feedback file, contains no error logs, and changes any candidate’s rank by no more than the documented capped adjustment.
- Existing recipe builder, MCP diagnostics, UI component, server, and Python test suites remain green; no real Olive optimization is invoked by tests or CI.

## Verification Steps

1. Run `pnpm test -- src/lib/__tests__/recipePipeline.test.ts`, `pnpm test:server`, `pnpm test:integration`, and `pnpm test:component` after the TypeScript bridge and feedback UI changes.
2. Run `cd olive-mcp-server && python -m pytest tests/test_studio_recipe.py tests/test_compatibility_matrix.py tests/test_feedback.py tests/test_troubleshooting_hybrid.py tests/test_integration.py -q`.
3. Run the full required regression checks: `pnpm lint`, `pnpm test`, `pnpm test:server`, `pnpm test:integration`, `pnpm test:component`, `pnpm validate:recipe`, and `cd olive-mcp-server && python -m pytest tests -q`.
4. In a local Studio session, submit an intentionally incompatible CPU+AWQ UIState through the MCP bridge and verify returned structured blockers while the job registry remains empty; repeat with a valid CPU PTQ state and compare its returned recipe JSON to the UI export.
5. Trigger the KB workflow manually in a test branch: verify no PR on a clean generated diff, then alter a disposable fixture/source response and verify exactly one labeled PR is created with the report artifact.
6. Use a matched diagnostic twice, submit up/down feedback, restart the MCP process, verify aggregate-only persistence and bounded reranking, then inspect the feedback file to confirm it contains no submitted log text.

## Risks & Mitigations

- **Cross-language boundary:** Python cannot safely import the app’s TypeScript validation functions. Use the explicit loopback bridge and return an unavailable status rather than reimplementing rules or producing divergent output.
- **Bridge exposure/SSRF:** Never accept a caller-supplied bridge URL; allow only a configured loopback URL, validate request shape, and rate-limit the no-side-effect endpoint.
- **Olive package availability is expensive/variable:** The availability job only imports/enumerates a pinned Olive registry and does not execute passes, download models, or use CUDA. Keep hardware/runtime execution out of CI.
- **Automated KB output can be noisy or unreviewed:** Make generation deterministic, publish changes in a single labeled PR, preserve artifacts, and prohibit automatic merge.
- **Feedback can bias results or leak diagnostic contents:** Store only aggregate entry IDs and votes locally, reject unknown IDs, cap scoring influence, and do not collect message text or external telemetry.
- **Existing dirty worktree:** Implement only the listed files and preserve the already modified unrelated files reported by `git status`.
