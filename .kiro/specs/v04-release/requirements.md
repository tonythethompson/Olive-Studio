# Requirements Document

## Introduction

This document specifies the v0.4.0 release of Olive Studio, covering three workstreams: (1) pipeline validation and pass migration test hardening for the olive-ai 0.13.0 upgrade, (2) agent loop session state for multi-step retry workflows, and (3) SVG deduplication in the GraphCanvas component.

## Glossary

- **Pipeline_Validator**: The module (`src/lib/pipelineValidation.ts`) that evaluates cross-pass compatibility rules, provider conflicts, advisory issues, and recipe chain validity against a UIState.
- **Cross_Pass_Rule**: A declarative entry in the `CROSS_PASS_RULES` array that describes one invalid pass combination, its fix, severity, and whether it auto-coerces.
- **Pass_Migrator**: The module (`src/lib/passMigration.ts`) that applies pass name renames and removals to loaded UIState objects.
- **Recipe_Builder**: The module (`src/lib/oliveRecipeBuilder.ts`) that transforms a UIState into an Olive JSON recipe.
- **Agent_Session_Store**: An Express-side in-memory store that tracks attempt history, last recipe, and failure context for agent retry loops.
- **GraphCanvas**: The React component (`src/components/features/execute/recipe-graph/GraphCanvas.tsx`) that renders an interactive SVG pipeline graph.
- **SVG_Defs_Block**: A single `<defs>` element containing shared SVG definitions (gradients, markers, node shape templates) referenced via `<use>`.
- **MCP_Tool**: A Python tool in the FastMCP server that agents invoke via stdio or HTTP proxy.
- **Session_ID**: A unique identifier generated on first agent tool call, passed through subsequent calls to correlate retry attempts.

## Requirements

### Requirement 1: CROSS_PASS_RULES Unit Test Coverage

**User Story:** As a developer, I want unit tests for the new CROSS_PASS_RULES so that regressions in QairtPipeline, SimplifiedLayerNormToRMSNorm, and kquant EP constraint logic are caught automatically.

#### Acceptance Criteria

1. WHEN the `qairt-pipeline-requires-qnn` rule is evaluated with a non-QNN provider and `qairtPipeline` enabled, THE Pipeline_Validator SHALL return a critical issue with id `qairt-pipeline-requires-qnn`.
2. WHEN the `qairt-pipeline-requires-qnn` rule is evaluated with QNNExecutionProvider and `qairtPipeline` enabled, THE Pipeline_Validator SHALL return no issue for that rule.
3. WHEN the `simplified-layernorm-requires-qnn` rule is evaluated with a non-QNN provider and `simplifiedLayerNormToRMSNorm` enabled, THE Pipeline_Validator SHALL return a critical issue with id `simplified-layernorm-requires-qnn`.
4. WHEN the `simplified-layernorm-requires-qnn` rule is evaluated with QNNExecutionProvider and `simplifiedLayerNormToRMSNorm` enabled, THE Pipeline_Validator SHALL return no issue for that rule.
5. WHEN `isQuantMethodAllowed("kquant", provider)` is called with a provider other than CPUExecutionProvider or CUDAExecutionProvider, THE Pipeline_Validator SHALL return `false`.
6. WHEN `isQuantMethodAllowed("kquant", provider)` is called with CPUExecutionProvider or CUDAExecutionProvider, THE Pipeline_Validator SHALL return `true`.

### Requirement 2: Removed-Pass Advisory Tests

**User Story:** As a developer, I want unit tests for removed-pass advisory warnings so that migration feedback for deprecated passes (QairtPreparation, QairtGenAIBuilder, MobiusModelBuilder) is verified.

#### Acceptance Criteria

1. WHEN `passRecipeOverrides` contains a key `"QairtPreparation"`, THE Pipeline_Validator SHALL emit an advisory warning issue with id `removed-pass-QairtPreparation`.
2. WHEN `passRecipeOverrides` contains a key `"QairtGenAIBuilder"`, THE Pipeline_Validator SHALL emit an advisory warning issue with id `removed-pass-QairtGenAIBuilder`.
3. WHEN `passRecipeOverrides` contains a key `"MobiusModelBuilder"`, THE Pipeline_Validator SHALL emit an advisory warning issue with id `removed-pass-MobiusModelBuilder`.
4. WHEN `passRecipeOverrides` does not contain any deprecated pass key, THE Pipeline_Validator SHALL emit no removed-pass advisory issues.

### Requirement 3: trust_remote_code Advisory Test

**User Story:** As a developer, I want a unit test for the trust_remote_code advisory so that the 0.13.0 default-flip warning is verified.

#### Acceptance Criteria

1. WHEN `passes.trustRemoteCode` is `false` and `modelSource` is `"huggingface"`, THE Pipeline_Validator SHALL emit an info-severity issue with id `trust-remote-code-advisory`.
2. WHEN `passes.trustRemoteCode` is `true` and `modelSource` is `"huggingface"`, THE Pipeline_Validator SHALL emit no trust_remote_code advisory issue.
3. WHEN `passes.trustRemoteCode` is `false` and `modelSource` is `"local"`, THE Pipeline_Validator SHALL emit no trust_remote_code advisory issue.

### Requirement 4: Integration Test Fixtures for Pass Migration

**User Story:** As a developer, I want integration test fixtures for pass migration scenarios so that MobiusModelBuilder rename, QairtPreparation/QairtGenAIBuilder removal, and trust_remote_code emission are verified end-to-end.

#### Acceptance Criteria

1. WHEN `applyMigrations` processes a UIState with `passRecipeOverrides` containing key `"MobiusModelBuilder"`, THE Pass_Migrator SHALL rename the key to `"MobiusBuilder"` in the migrated state.
2. WHEN `applyMigrations` processes a UIState with `passRecipeOverrides` containing keys `"QairtPreparation"` or `"QairtGenAIBuilder"`, THE Pass_Migrator SHALL remove those keys from the migrated state.
3. WHEN `buildOliveRecipe` is called with `passes.trustRemoteCode === true` and `modelSource === "huggingface"`, THE Recipe_Builder SHALL emit `trust_remote_code: true` in the `input_model.config` section of the recipe JSON.
4. WHEN `buildOliveRecipe` is called with `passes.trustRemoteCode === false`, THE Recipe_Builder SHALL not include `trust_remote_code` in the recipe JSON.

### Requirement 5: Recipe Validation Smoke Test

**User Story:** As a developer, I want the recipe validation smoke test to pass so that the recipe builder does not regress across olive-ai version upgrades.

#### Acceptance Criteria

1. WHEN `pnpm validate:recipe` is executed, THE Recipe_Builder SHALL produce valid JSON for all default pipeline configurations without throwing errors.

### Requirement 6: Zero Legacy Version References

**User Story:** As a developer, I want zero references to olive-ai version `0.12.1` in production source code so that stale version dependencies are eliminated.

#### Acceptance Criteria

1. THE source files (excluding test fixture data and CHANGELOG) SHALL contain zero occurrences of the string `"0.12.1"` in import paths, version constants, or configuration defaults.

### Requirement 7: Agent Session Context Storage

**User Story:** As an AI agent, I want persistent session context for agent retry loops so that multi-step optimization attempts retain history across MCP process restarts.

#### Acceptance Criteria

1. WHEN an agent issues the first tool call without a session ID, THE Agent_Session_Store SHALL create a new session with a generated UUID, attempt count of 0, and empty history fields.
2. WHEN a GET request is made to `/api/olive/agent/sessions/:sessionId`, THE Agent_Session_Store SHALL return the session object containing `sessionId`, `attemptCount`, `lastRecipe`, `lastFailure`, `success`, and `diagnosticNotes`.
3. WHEN a PUT request is made to `/api/olive/agent/sessions/:sessionId` with a valid body, THE Agent_Session_Store SHALL merge the body fields into the existing session and increment `attemptCount` when a new attempt is recorded.
4. IF a GET or PUT request targets a non-existent `sessionId`, THEN THE Agent_Session_Store SHALL return HTTP 404 with an error message.
5. THE agent session routes SHALL use `studioLocalOnly` middleware to reject non-loopback requests.
6. THE agent session routes SHALL use `parseBody()` middleware for all POST/PUT request bodies.
7. WHEN the MCP tools (`plan_optimization`, `execute_and_observe`, `diagnose_and_fix`) execute, THE MCP_Tool SHALL read and write session context via HTTP GET/PUT to the Express loopback endpoint.
8. WHILE the Express process is running, THE Agent_Session_Store SHALL retain all session data in memory independent of MCP stdio process lifecycle.

### Requirement 8: GraphCanvas SVG Deduplication

**User Story:** As a user, I want the GraphCanvas SVG to use deduplicated definitions so that render performance improves and DOM size decreases without visual changes.

#### Acceptance Criteria

1. THE GraphCanvas SHALL render a single `<defs>` block containing all shared SVG definitions (gradients, markers, node shape templates).
2. WHEN rendering node shapes that share identical geometry, THE GraphCanvas SHALL use `<use>` elements referencing definitions in the `<defs>` block instead of inline SVG paths.
3. THE GraphCanvas SHALL define an arrow `<marker>` element in the `<defs>` block and reference it via `marker-end` on connection paths.
4. WHEN the GraphCanvas renders with the same UIState before and after the SVG dedup refactor, THE GraphCanvas SHALL produce visually identical output (same colors, positions, sizes, animations).
5. WHEN a user interacts with the graph (click, keyboard navigation, resize), THE GraphCanvas SHALL maintain identical interactive behaviour as before the refactor.
6. THE GraphCanvas component test SHALL assert that no gradient or marker ID appears more than once in the rendered DOM (dedup invariant).
