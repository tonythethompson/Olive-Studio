# Implementation Plan: olive-ai 0.13.0 Upgrade

## Overview

Coordinated version bump from olive-ai 0.12.1 to 0.13.0 across TypeScript frontend (pass catalog, recipe builder, validation, issue reporting), Python MCP knowledge base, and venv provisioning layer. Executed as an incremental, non-breaking rollout with a migration mapping layer for backward compatibility with existing 0.12.x user recipes.

## Tasks

- [x] 1. Update version constants and documentation references
  - [x] 1.1 Update `OLIVE_VERSION` constant and header comment in `src/lib/passCatalog.ts`
    - Change `OLIVE_VERSION` from `"0.12.1"` to `"0.13.0"`
    - Update module header comment URL to `https://microsoft.github.io/Olive/0.13.0/reference/pass.html`
    - _Requirements: 1.1, 1.2_

  - [x] 1.2 Update `collectOliveVersion()` in `src/lib/issueReport.ts`
    - Change return string to contain `"Olive: 0.13.0"`
    - Ensure the composed bug report output includes the literal text `"Olive: 0.13.0"`
    - _Requirements: 1.3, 1.4_

  - [x] 1.3 Replace all remaining `"0.12.1"` references in `src/` and `olive-mcp-server/`
    - Scan with `grep -r "0.12.1" src/ olive-mcp-server/ scripts/`
    - For documentation URLs: update path segment from `Olive/0.12.1/` to `Olive/0.13.0/` if URL resolves (2xx); otherwise retain with `// TODO: update when 0.13.0 docs are published` comment
    - Update header comments in `scripts/sync-pass-catalog.mjs` if version-referencing
    - Update any `docs/` or README files referencing `0.12.1`
    - Verify zero hits for `"0.12.1"` in source files after completion
    - _Requirements: 1.5, 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 2. Update venv spec pin
  - [x] 2.1 Bump `VENV_SPEC_VERSION` and update `PINNED_OLIVE_AI_INSTALL` in `src/server/services/venv/spec.ts`
    - Change `VENV_SPEC_VERSION` from `4` to `5`
    - Change `PINNED_OLIVE_AI_INSTALL` from `"olive-ai>=0.9.0,<1"` to `"olive-ai>=0.12.0,<1"`
    - Verify `"requests"` remains in the same installed-packages list
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 2.2 Write unit tests for venv spec changes
    - Assert `VENV_SPEC_VERSION === 5`
    - Assert `PINNED_OLIVE_AI_INSTALL` satisfies PEP 440 parse and includes `0.13.0`
    - Assert `PINNED_OLIVE_AI_INSTALL` excludes `1.0.0`
    - Assert `OLIVE_INSTALL_ARGS` includes `"requests"`
    - _Requirements: 2.1, 2.2, 2.3_

- [x] 3. Enhance sync script with version guard
  - [x] 3.1 Add version check before pass extraction in `scripts/sync-pass-catalog.mjs`
    - After detecting `.venv` python, run `import olive; print(olive.__version__)` and verify output starts with `"0.13"`
    - If version mismatch: print diagnostic message identifying expected vs actual version, exit with non-zero code
    - _Requirements: 3.7_

  - [x] 3.2 Add metadata fields to sync script output
    - Add `olive_version: "0.13.0"`, `version: "0.13.0"`, and `last_updated` (ISO date) fields to the output JSON metadata object
    - Update header comment to reference `0.13.0` as the target version
    - _Requirements: 3.6, 8.4_

- [ ] 4. Checkpoint — Verify version sweep
  - Ensure all tests pass, ask the user if questions arise.
  - Run `grep -r "0.12.1" src/ olive-mcp-server/ scripts/` — expect zero matches
  - Run `pnpm lint:quick` — expect clean pass

- [x] 5. Refresh MCP knowledge base
  - [x] 5.1 Update `olive-mcp-server/olive_mcp_server/knowledge_base/passes.json`
    - Set `olive_version` field to `"0.13.0"`
    - Set `version` field to `"0.13.0"` and `last_updated` to current date
    - Add entries for 8 new 0.13.0 passes with full schema (name, type, class path, inputs, outputs, parameters):
      - `MobiusBuilder` (onnx; inputs: PyTorchModelHandler → outputs: ONNXModelHandler)
      - `QairtPipeline` (qnn; inputs: PyTorchModelHandler → outputs: QNNModelHandler)
      - `KQuant` (pytorch; inputs: PyTorchModelHandler → outputs: PyTorchModelHandler)
      - `OnnxKquantQuantization` (onnx; inputs: ONNXModelHandler → outputs: ONNXModelHandler)
      - `QuantizeEmbeddingInt8` (onnx; graph surgery)
      - `ShareEmbeddingLmHead` (onnx; graph surgery)
      - `SimplifiedLayerNormToRMSNorm` (onnx; graph surgery, QNN-targeted)
      - `OnnxDiscrepancyCheck` (onnx; validation pass, model passes through)
    - No passes removed from 0.12.x that exist in current catalog
    - Ensure total pass count equals or exceeds olive-ai 0.13.0 registered pass classes
    - _Requirements: 7.1, 7.4, 7.5, 7.7, 3.6_

  - [x] 5.2 Update `olive-mcp-server/olive_mcp_server/knowledge_base/compatibility_matrix.json`
    - Bump `version` from `"0.3.3"` to `"0.4.0"` (semver minor bump)
    - Set `olive_version_support.max` to `"0.13.0"`, keep `min` at `"0.12.0"`
    - Set `last_updated` to current ISO 8601 date
    - Update evidence URLs from `/0.12.1/` to `/0.13.0/` where target resolves
    - Add compatibility entries for 8 new passes:
      - `MobiusBuilder`: CPU, CUDA
      - `QairtPipeline`: QNN, QNN ABI
      - `KQuant`: CPU, CUDA
      - `OnnxKquantQuantization`: CPU, CUDA, DirectML
      - `QuantizeEmbeddingInt8`: CPU, CUDA, DirectML
      - `ShareEmbeddingLmHead`: CPU, CUDA, DirectML
      - `SimplifiedLayerNormToRMSNorm`: QNN, QNN ABI
      - `OnnxDiscrepancyCheck`: CPU, CUDA
    - Ensure every pass in `passes.json` has a corresponding compatibility entry
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 7.6_

  - [x] 5.3 Update `olive-mcp-server/olive_mcp_server/knowledge_base/hardware_profiles.json`
    - Add `QnnAbiExecutionProvider` entry (new EP, PR #2434) with passes: QairtPipeline, SimplifiedLayerNormToRMSNorm
    - Update `QNNExecutionProvider` profile to list `QairtPipeline` as recommended pass
    - Add `KQuant` to CPU and CUDA profiles (analogous to Rtn)
    - Increment `version` and set `last_updated`
    - _Requirements: 7.2, 7.5_

  - [x] 5.4 Update `olive-mcp-server/olive_mcp_server/knowledge_base/troubleshooting.json`
    - Add entry: "HuggingFace model fails to load after 0.13.0" → `trust_remote_code` default flipped; fix: set `trust_remote_code: true`
    - Add entry: "QairtPreparation/QairtGenAIBuilder not found" → superseded by QairtPipeline
    - Set `olive_versions: ">=0.13.0"` on new entries
    - Increment `version` and set `last_updated`
    - _Requirements: 7.3, 7.7_

  - [x] 5.5 Run pytest for MCP knowledge base validation
    - Execute `cd olive-mcp-server && python -m pytest tests -q`
    - Verify schema checks pass for all updated JSON files
    - _Requirements: 7.7_

- [x] 6. Synchronize TypeScript pass catalog
  - [x] 6.1 Update `PASS_CATALOG` array in `src/lib/passCatalog.ts` to match `passes.json`
    - Add `PassCatalogEntry` for 8 new passes: MobiusBuilder, QairtPipeline, KQuant, OnnxKquantQuantization, QuantizeEmbeddingInt8, ShareEmbeddingLmHead, SimplifiedLayerNormToRMSNorm, OnnxDiscrepancyCheck
    - Verify existing entries are unchanged (no passes removed in 0.13.0 that exist in current catalog)
    - Ensure `PASS_CATALOG.length` equals `passes.json` entry count
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 6.2 Write unit tests for pass catalog consistency
    - Assert `PASS_CATALOG.length` matches `passes.json` entry count
    - Assert every `PASS_CATALOG` entry has non-empty name, category, description, inputs, outputs
    - Assert `OLIVE_VERSION === "0.13.0"`
    - Assert `collectOliveVersion()` contains `"Olive: 0.13.0"`
    - _Requirements: 1.1, 1.3, 3.5_

- [ ] 7. Update recipe builder for 0.13.0 parameter changes
  - [x] 7.1 Handle `trust_remote_code` default flip in recipe builder
    - When `modelSource === "huggingface"`, emit `trust_remote_code: true` in model config section
    - Add `UIState.passes.trustRemoteCode` boolean (default `true`) for user opt-out via Advanced settings
    - Update `commitUiStateUpdate` to coerce the default when model source changes
    - No existing pass parameter renames or removals confirmed in 0.13.0 release
    - _Requirements: 5.1, 5.2, 5.3, 5.5_

  - [x] 7.2 Add `PASS_BUILDERS` entries for 8 new passes
    - `buildMobiusBuilder()` — emit model_name, cache config. ONNX conversion pass.
    - `buildQairtPipeline()` — emit YAML recipe path, quant config. QNN-only.
    - Add `"kquant"` to `QUANT_METHOD_BUILDERS` — emit bits (2/4/8), symmetric, group_size. Dispatch: PyTorch → KQuant, ONNX → OnnxKquantQuantization
    - `buildQuantizeEmbeddingInt8()` — graph surgery, minimal/empty config
    - `buildShareEmbeddingLmHead()` — graph surgery, minimal/empty config
    - `buildSimplifiedLayerNormToRMSNorm()` — graph surgery, minimal/empty config
    - `buildOnnxDiscrepancyCheck()` — validation pass, optional test_data config
    - Insert each at correct position in `preferredPassOrder()`
    - Add `"kquant"` to `quantMethod` union in `src/types.ts` and all allowlists (`auditAutofix.ts`, `chatActions.ts`, `pipelineValidation.ts`)
    - _Requirements: 5.4, 5.7_

  - [x] 7.3 Update `pipelineValidation.ts` for KQuant method
    - Add `"kquant"` to `isQuantMethodAllowed()` — allowed on CPU and CUDA (same as `"rtn"`)
    - Add `"kquant"` to `getAllowedQuantMethods()` results for CPU and CUDA providers
    - _Requirements: 5.5, 6.1_

  - [ ] 7.4 Run recipe validation smoke test
    - Execute `pnpm validate:recipe`
    - Verify all supported pipeline configurations produce valid recipe JSON
    - Confirm no errors or warnings related to unknown, missing, or invalid-valued parameters
    - _Requirements: 5.6_

- [ ] 8. Checkpoint — Verify catalog and builder
  - Ensure all tests pass, ask the user if questions arise.
  - Run `pnpm validate:recipe` — expect success
  - Run `pnpm test` — expect pass catalog unit tests pass

- [ ] 9. Update pipeline validation rules
  - [ ] 9.1 Add `CROSS_PASS_RULES` entries for new pass EP constraints
    - `QairtPipeline` requires QNN or QNN ABI EP — add rule rejecting it on CPU/CUDA/DirectML/OpenVINO
    - `SimplifiedLayerNormToRMSNorm` is QNN-targeted — add rule requiring QNN/QNN ABI EP
    - `OnnxDiscrepancyCheck` is validation-only — add info-severity advisory that it doesn't modify the model
    - No existing incompatibilities removed in 0.13.0
    - _Requirements: 6.1, 6.2, 6.4_

  - [ ] 9.2 Update `getProviderConflicts()` for QNN ABI EP
    - Add `QnnAbiExecutionProvider` to provider list as new distinct EP
    - Ensure KQuant and other PyTorch-only quant passes are excluded from QNN/QNN ABI
    - _Requirements: 6.3, 6.4_

  - [ ] 9.3 Add removed-pass warning rule for migration
    - Severity: `warning` (not `critical`), no `autoCoerce`
    - Rule emits issue with id `"removed-pass-<passName>"` for: `MobiusModelBuilder` (renamed), `QairtPreparation` (removed), `QairtGenAIBuilder` (removed)
    - _Requirements: 9.2_

  - [ ] 9.4 Add `trust_remote_code` info advisory
    - Info-severity advisory when `passes.trustRemoteCode === false` and `modelSource === "huggingface"`
    - Message: "Some HuggingFace models require trust_remote_code=true. Enable in Advanced settings if model loading fails."
    - _Requirements: 6.1_

  - [ ] 9.5 Write unit tests for new/modified validation rules
    - Test `QairtPipeline` rule rejects non-QNN providers
    - Test `SimplifiedLayerNormToRMSNorm` rule rejects non-QNN providers
    - Test `kquant` allowed on CPU/CUDA but not QNN
    - Test removed-pass warning fires for QairtPreparation, QairtGenAIBuilder, MobiusModelBuilder
    - Test `trust_remote_code` advisory fires when expected
    - _Requirements: 6.5_

- [ ] 10. Implement migration mapping module
  - [ ] 10.1 Create `src/lib/passMigration.ts` with migration types and tables
    - Define `ParamMigration`, `PassNameMigration`, and `MigrationResult` interfaces
    - Populate `PASS_NAME_MIGRATIONS` with concrete entries:
      - `{ oldName: "MobiusModelBuilder", newName: "MobiusBuilder", since: "0.13.0" }`
      - `{ oldName: "QairtPreparation", newName: null, since: "0.13.0" }`
      - `{ oldName: "QairtGenAIBuilder", newName: null, since: "0.13.0" }`
    - Leave `PARAM_MIGRATIONS` empty (no param renames confirmed in 0.13.0)
    - Implement `applyMigrations(state: UIState): MigrationResult` function
    - Handle error cases: transformValue throws → catch, log warning, discard parameter
    - _Requirements: 9.1, 9.4, 9.5_

  - [ ] 10.2 Integrate migration into `pipelineStore.ts` `replaceState()` path
    - Call `applyMigrations(loadedState)` before `commitUiStateUpdate`
    - Display summary notification listing migrated count and discarded count within 2s of load
    - Ensure all other passes preserved in declared order after migration
    - _Requirements: 9.1, 9.2, 9.4, 9.5, 9.6_

  - [ ] 10.3 Write property test: Migration produces valid UIState (Property 1)
    - **Property 1: Migration produces valid UIState**
    - Use `fast-check` to generate UIState with random passes from 0.12.x catalog
    - Assert `applyMigrations(state).state` has all pass names in 0.13.0 PASS_CATALOG and parameters conform to current schema
    - Minimum 100 iterations
    - **Validates: Requirements 9.1**

  - [ ] 10.4 Write property test: Migration idempotence (Property 2)
    - **Property 2: Migration idempotence**
    - Assert `applyMigrations(applyMigrations(state).state).state` deeply equals `applyMigrations(state).state`
    - Assert second application reports zero migrated params and zero discarded params
    - Minimum 100 iterations
    - **Validates: Requirements 9.4, 9.5**

  - [ ] 10.5 Write property test: Renamed parameter value preservation (Property 3)
    - **Property 3: Renamed parameter value preservation**
    - Since PARAM_MIGRATIONS is empty for 0.13.0, use synthetic test-only migration entries to validate the infrastructure
    - Assert output contains `newParam` with same value that `oldParam` held, and `oldParam` is absent
    - Minimum 100 iterations
    - **Validates: Requirements 9.4**

  - [ ] 10.6 Write property test: Removed pass exclusion and counting (Property 4)
    - **Property 4: Removed pass exclusion and counting**
    - Generate UIState containing `QairtPreparation` and/or `QairtGenAIBuilder` (PASS_NAME_MIGRATIONS with `newName: null`)
    - Assert `removedPasses` contains exactly those pass names, output state excludes them, other passes retain original order
    - Minimum 100 iterations
    - **Validates: Requirements 9.2**

  - [ ] 10.7 Write property test: Recipe schema validity after full pipeline (Property 5)
    - **Property 5: Recipe schema validity after full pipeline**
    - Generate valid UIState with random pass combinations from 0.13.0 catalog
    - Assert `buildOliveRecipe(commitUiStateUpdate(state, {}))` produces recipe that passes structural checks
    - Minimum 100 iterations
    - **Validates: Requirements 5.6**

- [ ] 11. Integration tests for migration
  - [ ] 11.1 Write integration test fixtures and assertions
    - Create recipe fixture referencing `MobiusModelBuilder` → verify migration renames to `MobiusBuilder`
    - Create recipe fixture with `QairtPreparation` + `QairtGenAIBuilder` → verify warning surfaced, passes excluded, other passes preserved
    - Create recipe fixture with HuggingFace model → verify `trust_remote_code: true` emitted in built recipe
    - Run `pnpm validate:recipe` after full catalog update
    - _Requirements: 9.1, 9.2, 9.4, 9.5, 9.6_

- [ ] 12. Final checkpoint — Full verification
  - Ensure all tests pass, ask the user if questions arise.
  - `grep -r "0.12.1" src/ olive-mcp-server/ scripts/` returns zero matches
  - `pnpm lint:quick` passes
  - `pnpm validate:recipe` passes
  - `pnpm test` passes

## Scoping Decisions

### In Scope (this upgrade)

- 8 new passes added to catalog, knowledge base, and recipe builder
- `trust_remote_code` default change handled in recipe builder + pipeline advisory
- QNN ABI EP added to hardware profiles and provider conflicts
- KQuant added as new quantization method (`"kquant"` in type union + allowlists)
- Migration mapping for MobiusModelBuilder rename and QairtPreparation/QairtGenAIBuilder removal
- Pipeline validation for new pass EP constraints

### Out of Scope (deferred)

- **Evaluation metrics** (WER, RTFx, exact_match, relaxed_accuracy, word_sort_ratio, vision GenAI) — evaluator-only, no pass/recipe impact
- **`auto-opt` CLI deprecation** — Studio has zero references; no action needed
- **Rtn/KQuant uint2/int2 UI exposure** — UI-only dropdown change; deferred to UI polish pass
- **SelectiveMixedPrecision new optional params** (QKV overrides, AUTO memory, MULTI_GPU) — additive; existing builder works; UI deferred
- **LFM2 hybrid model support** — model-type, no new pass
- **AMD VitisAI SD1.5** — EP already modeled
- **Whisper recipe integration** — recipe template, not a pass
- **Model package CLI alignment** — CLI-only

## Notes

- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation after each major phase
- Property tests validate universal correctness properties from the design document (Properties 1-5)
- Unit tests validate specific examples and edge cases
- The sync script (task 3) cannot be fully exercised without a local 0.13.0 venv — manual verification or CI with the correct venv is required
- Steps 1-3 are complete (version bump). Steps 5-11 form the "substance" PR(s).
- For Property 3 (renamed param preservation): since no PARAM_MIGRATIONS exist yet, test validates infrastructure with synthetic entries
- The `trust_remote_code` change is the most user-impacting behavioral shift — handled in recipe builder (auto-emit) and validation (advisory)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["5.1", "5.3", "5.4"], "note": "KB data updates (parallel)" },
    { "id": 1, "tasks": ["5.2", "5.5"], "note": "Compat matrix + pytest" },
    { "id": 2, "tasks": ["6.1"], "note": "TS catalog sync" },
    { "id": 3, "tasks": ["6.2", "7.1"], "note": "Catalog tests + trust_remote_code" },
    { "id": 4, "tasks": ["7.2", "7.3"], "note": "New pass builders + kquant allowlist" },
    { "id": 5, "tasks": ["7.4", "9.1", "9.2"], "note": "Recipe smoke + CROSS_PASS_RULES + provider conflicts" },
    { "id": 6, "tasks": ["9.3", "9.4"], "note": "Migration warning + trust_remote_code advisory" },
    { "id": 7, "tasks": ["9.5", "10.1"], "note": "Validation tests + migration module" },
    { "id": 8, "tasks": ["10.2"], "note": "pipelineStore integration" },
    { "id": 9, "tasks": ["10.3", "10.4", "10.5", "10.6"], "note": "Property tests" },
    { "id": 10, "tasks": ["10.7", "11.1"], "note": "Recipe schema PBT + integration fixtures" }
  ]
}
```
