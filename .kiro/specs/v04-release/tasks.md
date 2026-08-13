# Implementation Plan: v0.4.0 Release

## Overview

Three workstreams implemented in parallel where possible: (1) test hardening for olive-ai 0.13.0 validation rules, (2) agent loop session state with REST API, (3) GraphCanvas SVG dedup. All code is TypeScript (React/Express/Vitest) except MCP tool integration which is Python.

## Tasks

- [ ] 1. Pipeline validation unit tests for new CROSS_PASS_RULES
  - [ ] 1.1 Add unit tests for `qairt-pipeline-requires-qnn` rule
    - Test that enabling `qairtPipeline` with each non-QNN provider (CPU, CUDA, ROCm, OpenVINO, TensorRT, WebGPU) produces a critical issue with id `qairt-pipeline-requires-qnn`
    - Test that enabling `qairtPipeline` with QNNExecutionProvider and QnnAbiExecutionProvider produces no issue for that rule
    - File: `src/lib/__tests__/pipelineValidation.test.ts` (extend existing file)
    - _Requirements: 1.1, 1.2_

  - [ ] 1.2 Add unit tests for `simplified-layernorm-requires-qnn` rule
    - Test that enabling `simplifiedLayerNormToRMSNorm` with each non-QNN provider produces a critical issue with id `simplified-layernorm-requires-qnn`
    - Test that enabling `simplifiedLayerNormToRMSNorm` with QNN providers produces no issue
    - File: `src/lib/__tests__/pipelineValidation.test.ts`
    - _Requirements: 1.3, 1.4_

  - [ ] 1.3 Add unit tests for kquant EP constraint
    - Test `isQuantMethodAllowed("kquant", provider)` returns `true` only for CPU and CUDA
    - Test that all other providers (ROCm, QNN, QnnAbi, OpenVINO, TensorRT, WebGPU) return `false`
    - File: `src/lib/__tests__/pipelineValidation.test.ts`
    - _Requirements: 1.5, 1.6_

  - [ ]* 1.4 Write property test for kquant provider constraint
    - **Property 1: kquant provider constraint**
    - For any IHVProvider, isQuantMethodAllowed("kquant", p) === (p is CPU or CUDA)
    - **Validates: Requirements 1.5, 1.6**

- [ ] 2. Removed-pass advisory and trust_remote_code unit tests
  - [ ] 2.1 Add unit tests for removed-pass advisory warnings
    - Test that `passRecipeOverrides` with key `"QairtPreparation"` emits `removed-pass-QairtPreparation` warning
    - Test that `passRecipeOverrides` with key `"QairtGenAIBuilder"` emits `removed-pass-QairtGenAIBuilder` warning
    - Test that `passRecipeOverrides` with key `"MobiusModelBuilder"` emits `removed-pass-MobiusModelBuilder` warning
    - Test that `passRecipeOverrides` without deprecated keys emits no removed-pass issues
    - File: `src/lib/__tests__/pipelineValidation.test.ts`
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ]* 2.2 Write property test for removed-pass advisory emission
    - **Property 2: Removed-pass advisory emission**
    - For any deprecated pass name in REMOVED_PASSES present in passRecipeOverrides, advisory fires; for any non-deprecated key set, no advisory fires
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4**

  - [ ] 2.3 Add unit test for trust_remote_code advisory
    - Test that trustRemoteCode=false + modelSource="huggingface" emits info issue `trust-remote-code-advisory`
    - Test that trustRemoteCode=true + modelSource="huggingface" emits no such issue
    - Test that trustRemoteCode=false + modelSource="local" emits no such issue
    - File: `src/lib/__tests__/pipelineValidation.test.ts`
    - _Requirements: 3.1, 3.2, 3.3_

- [ ] 3. Integration test fixtures for pass migration
  - [ ] 3.1 Add integration tests for MobiusModelBuilder rename
    - Construct UIState with `passRecipeOverrides: { MobiusModelBuilder: { someParam: true } }`
    - Call `applyMigrations`, assert result has key `MobiusBuilder` and no `MobiusModelBuilder`
    - Assert `renamedPasses` array contains the rename entry
    - File: `src/lib/__tests__/passMigrationIntegration.test.ts`
    - _Requirements: 4.1_

  - [ ] 3.2 Add integration tests for QairtPreparation/QairtGenAIBuilder removal
    - Construct UIState with both keys in `passRecipeOverrides`
    - Call `applyMigrations`, assert both keys are absent from migrated state
    - Assert `removedPasses` array contains both pass names
    - File: `src/lib/__tests__/passMigrationIntegration.test.ts`
    - _Requirements: 4.2_

  - [ ] 3.3 Add integration tests for trust_remote_code emission in recipe
    - Test `buildOliveRecipe` with trustRemoteCode=true, modelSource="huggingface" → recipe contains `trust_remote_code: true`
    - Test `buildOliveRecipe` with trustRemoteCode=false → recipe does not contain `trust_remote_code`
    - File: `src/lib/__tests__/passMigrationIntegration.test.ts`
    - _Requirements: 4.3, 4.4_

- [ ] 4. Checkpoint — Validation tests
  - Ensure all tests pass (`pnpm test` and `pnpm validate:recipe`), ask the user if questions arise.

- [ ] 5. Agent session store implementation
  - [ ] 5.1 Create `AgentSession` interface and in-memory store module
    - Define `AgentSession` interface with all fields (sessionId, attemptCount, lastRecipe, lastFailure, success, diagnosticNotes, createdAt, updatedAt)
    - Implement `createSession()`, `getSession()`, `updateSession()`, `recordAttempt()` functions
    - Export from `src/server/services/olive/agentSessions.ts`
    - _Requirements: 7.1, 7.8_

  - [ ] 5.2 Add Express routes for agent sessions
    - `POST /api/olive/agent/sessions` — creates new session, returns 201
    - `GET /api/olive/agent/sessions/:sessionId` — returns session or 404
    - `PUT /api/olive/agent/sessions/:sessionId` — merges patch into session or 404
    - All routes use `studioLocalOnly` middleware and `parseBody()` for PUT
    - Mount in `src/server/routes/olive.ts`
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6_

  - [ ]* 5.3 Write server unit tests for agent session store
    - Test createSession returns valid structure with UUID, attemptCount=0, null fields
    - Test getSession returns undefined for unknown ID
    - Test updateSession merges fields correctly
    - Test recordAttempt increments attemptCount and updates fields
    - **Property 3: Session ID uniqueness** — For any N calls, all IDs distinct
    - **Property 4: Session update merge semantics** — attemptCount increments, fields merge
    - **Validates: Requirements 7.1, 7.3**
    - File: `src/server/__tests__/agentSessions.test.ts`

  - [ ] 5.4 Add MCP tool session integration (Python)
    - Add `_ensure_session()` helper to `olive-mcp-server/olive_mcp_server/tools/studio_loopback.py`
    - Add `_record_attempt()` helper for writing attempt results
    - Update `plan_optimization`, `execute_and_observe`, `diagnose_and_fix` to accept `session_id` parameter and call session helpers
    - _Requirements: 7.7_

  - [ ]* 5.5 Write Python unit tests for session helpers
    - Mock httpx calls, verify GET/PUT request shapes
    - Test `_ensure_session` creates new session when ID is None
    - Test `_ensure_session` retrieves existing session when ID is valid
    - Test `_record_attempt` sends correct PUT body
    - File: `olive-mcp-server/tests/test_agent_sessions.py`
    - _Requirements: 7.7_

- [ ] 6. Checkpoint — Agent loop state
  - Ensure all tests pass (`pnpm test:server`), ask the user if questions arise.

- [ ] 7. GraphCanvas SVG dedup
  - [ ] 7.1 Extract SVG defs into shared module
    - Create `src/components/features/execute/recipe-graph/svgDefs.ts`
    - Export `GraphSvgDefs` component with linearGradient, arrow marker, and any repeated symbol definitions
    - Export ID constants (`WIRE_GRADIENT_ID`, `ARROW_MARKER_ID`)
    - _Requirements: 8.1, 8.3_

  - [ ] 7.2 Refactor GraphCanvas to use shared defs and `<use>` references
    - Remove inline `<linearGradient>` from `renderSVGConnections`
    - Import and render `<GraphSvgDefs />` inside a single `<defs>` block
    - Add `markerEnd` referencing `ARROW_MARKER_ID` on terminal connection paths
    - Replace duplicated node shape SVG with `<use>` references where applicable
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ]* 7.3 Write component test for SVG dedup invariants
    - Assert exactly one `<defs>` element in rendered SVG
    - Assert no duplicate `id` attributes among gradient/marker/symbol elements
    - Assert arrow marker element exists and is referenced by at least one path
    - Assert interactive behaviour (click, keyboard nav) still works
    - **Property 5: Single SVG defs container**
    - **Property 6: No duplicate SVG definition IDs**
    - **Validates: Requirements 8.1, 8.6**
    - File: `src/components/features/execute/recipe-graph/__tests__/GraphCanvas.test.tsx`

- [ ] 8. Final checkpoint — All tiers green
  - [ ] 8.1 Verify zero `0.12.1` references in production source
    - Search src/ for "0.12.1" excluding test fixtures, CHANGELOG, and docs
    - Remove or update any stale references found
    - _Requirements: 6.1_

  - [ ] 8.2 Run full lint and validate all test tiers
    - `pnpm lint` exits 0 (warnings OK, errors not)
    - `pnpm test`, `pnpm test:server`, `pnpm test:integration`, `pnpm test:component` all green
    - `pnpm validate:recipe` green
    - _Requirements: 5.1, 6.1_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The test hardening workstream (tasks 1-3) adds no production code — only test files
- Agent session store (task 5) adds new production code in server services and routes
- GraphCanvas dedup (task 7) refactors existing production code with no functional change
- All tests run via vitest; Python tests via pytest in olive-mcp-server/

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "2.1", "2.3", "3.1", "3.2", "3.3", "5.1", "7.1"] },
    { "id": 1, "tasks": ["1.4", "2.2", "5.2", "7.2"] },
    { "id": 2, "tasks": ["5.3", "5.4", "7.3"] },
    { "id": 3, "tasks": ["5.5", "8.1"] },
    { "id": 4, "tasks": ["8.2"] }
  ]
}
```
