# Requirements Document

## Introduction

Upgrade Olive Studio's target runtime from olive-ai 0.12.1 to olive-ai 0.13.0. This is a coordinated version bump across the TypeScript frontend (pass catalog, recipe builder, validation, issue reporting), the Python MCP knowledge base (compatibility matrix, hardware profiles, passes, troubleshooting), and the venv provisioning layer (pip install pins). The upgrade must preserve backward compatibility with existing user recipes targeting 0.12.x models while enabling any new passes, configuration options, or deprecations introduced in 0.13.0.

## Glossary

- **Pass_Catalog**: The TypeScript module `src/lib/passCatalog.ts` containing the `PASS_CATALOG` array and `OLIVE_VERSION` constant that enumerate all available Olive optimization passes
- **Recipe_Builder**: The module `src/lib/oliveRecipeBuilder.ts` that converts UI state into Olive recipe JSON using `PASS_BUILDERS` and `QUANT_METHOD_BUILDERS`
- **Pipeline_Validator**: The module `src/lib/pipelineValidation.ts` containing `CROSS_PASS_RULES` that enforce pass compatibility constraints
- **Compatibility_Matrix**: The JSON file `olive-mcp-server/olive_mcp_server/knowledge_base/compatibility_matrix.json` declaring supported Olive versions and model/hardware/pass support entries
- **Venv_Spec**: The module `src/server/services/venv/spec.ts` containing `PINNED_OLIVE_AI_INSTALL` that controls which olive-ai version range pip installs into venv families
- **Issue_Report**: The module `src/lib/issueReport.ts` containing the `collectOliveVersion()` function that embeds version strings in bug reports
- **Sync_Script**: The script `scripts/sync-pass-catalog.mjs` that extracts available passes from a live olive-ai install into the MCP knowledge base
- **Knowledge_Base**: The directory `olive-mcp-server/olive_mcp_server/knowledge_base/` containing passes.json, hardware_profiles.json, compatibility_matrix.json, and troubleshooting.json
- **VENV_SPEC_VERSION**: The integer constant in Venv_Spec that triggers isolated venv rebuilds when bumped

## Requirements

### Requirement 1: OLIVE_VERSION Constant Update

**User Story:** As a developer using Olive Studio, I want the application to identify itself as targeting olive-ai 0.13.0, so that recipes, UI labels, and documentation links reference the correct version.

#### Acceptance Criteria

1. THE Pass_Catalog SHALL export `OLIVE_VERSION` with the value `"0.13.0"`
2. THE Pass_Catalog module header comment SHALL reference the 0.13.0 documentation URL `https://microsoft.github.io/Olive/0.13.0/reference/pass.html`
3. THE Issue_Report `collectOliveVersion()` function SHALL return a string containing `"Olive: 0.13.0"`
4. WHEN a user generates a bug report, THE Issue_Report SHALL include the literal text `"Olive: 0.13.0"` (derived from the `OLIVE_VERSION` constant) in the composed report output
5. THE codebase SHALL contain no remaining hardcoded references to the previous version string `"0.12.1"` in any source file under `src/` or `olive-mcp-server/`

### Requirement 2: Pip Install Pin Update

**User Story:** As an operator provisioning venv families, I want the pip install pin to permit olive-ai 0.13.0, so that runtime environments install the new version.

#### Acceptance Criteria

1. THE Venv_Spec SHALL export `PINNED_OLIVE_AI_INSTALL` with a PEP 440 version specifier string that includes olive-ai 0.13.0 and excludes versions >= 1.0.0
2. WHEN the pip install range changes or the existing pin already satisfies a target release without modification, THE Venv_Spec `VENV_SPEC_VERSION` constant SHALL be incremented by 1 (from 4 to 5) to trigger isolated venv rebuilds for all families
3. THE Venv_Spec SHALL include `"requests"` in the same installed-packages list as olive-ai, preserving its existing version constraint if any
4. IF `VENV_SPEC_VERSION` is not exactly 1 greater than its prior value after the change, THEN THE build validation SHALL fail, indicating the version was not incremented correctly

### Requirement 3: Pass Catalog Synchronization

**User Story:** As a developer configuring optimization pipelines, I want the pass catalog to reflect all passes available in olive-ai 0.13.0, so that new passes appear in the UI and removed passes are flagged.

#### Acceptance Criteria

1. WHEN olive-ai 0.13.0 introduces new passes not present in the current catalog, THE Pass_Catalog `PASS_CATALOG` array SHALL include entries for each new pass with `name` (non-empty string), `category` (valid PassCategory value), `description` (non-empty string), `inputs` (non-empty string array), and `outputs` (non-empty string array) fields
2. WHEN olive-ai 0.13.0 removes a pass that exists in the current catalog, THE Pass_Catalog SHALL remove that entry from the `PASS_CATALOG` array
3. WHEN olive-ai 0.13.0 renames a pass, THE Pass_Catalog SHALL update the `name` field of the corresponding entry to the new name
4. WHEN olive-ai 0.13.0 changes the input/output handler types for an existing pass, THE Pass_Catalog entry SHALL reflect the updated handler types
5. THE Sync_Script SHALL be executed against a 0.13.0 install to produce an authoritative passes.json, and the TypeScript Pass_Catalog `PASS_CATALOG` array entry count SHALL equal the passes.json entry count, with field-by-field correspondence for name, category, inputs, and outputs
6. WHEN the Sync_Script is run, THE Knowledge_Base `passes.json` SHALL contain a `version` field set to `"0.13.0"` and a `last_updated` field set to the execution date
7. IF the Sync_Script detects that olive-ai is not installed or the installed version is not 0.13.x, THEN the script SHALL exit with a non-zero code and print a diagnostic message identifying the expected version

### Requirement 4: Compatibility Matrix Update

**User Story:** As an MCP tool consumer, I want the compatibility matrix to declare support for olive-ai 0.13.0, so that version-aware tooling does not reject 0.13.0 workflows.

#### Acceptance Criteria

1. THE Compatibility_Matrix `olive_version_support.max` field SHALL be updated to `"0.13.0"`
2. THE Compatibility_Matrix `olive_version_support.min` field SHALL remain `"0.12.0"` (backward compatibility preserved)
3. WHEN an evidence reference in the Compatibility_Matrix has `type` equal to `"olive_docs"` and its `reference` URL contains a version path segment (e.g., `/0.12.1/`), THE Compatibility_Matrix SHALL update that URL to use the `0.13.0` base path and set the evidence `version` field to `"0.13.0"` only after confirming the target URL resolves to a valid page
4. THE Compatibility_Matrix `last_updated` field SHALL be set to the ISO 8601 date (`YYYY-MM-DD`) on which the upgrade is applied
5. IF olive-ai 0.13.0 introduces new passes that are not already present under a hardware profile entry, THEN THE Compatibility_Matrix SHALL include an entry for each new pass under every hardware profile where it is applicable, containing at minimum the fields `support`, `olive_pass`, `note`, and `evidence` (with `reference`, `type`, and `version`) matching the existing entry schema
6. IF an existing pass in the Compatibility_Matrix has been removed or renamed in olive-ai 0.13.0, THEN THE Compatibility_Matrix SHALL update the affected entry's `support` field to `"unsupported"` and append a `note` indicating the pass was removed or renamed in 0.13.0
7. WHEN the Compatibility_Matrix content is modified, THE Compatibility_Matrix `version` field SHALL be incremented following semver minor-bump semantics (e.g., `"0.3.3"` becomes `"0.4.0"`)

### Requirement 5: Recipe Builder Pass Configuration Updates

**User Story:** As a developer building optimization recipes, I want the recipe builder to emit correct configuration for any passes whose parameters changed in 0.13.0, so that generated recipes are valid against the new runtime.

#### Acceptance Criteria

1. WHEN olive-ai 0.13.0 adds a new required configuration parameter to an existing pass, THE Recipe_Builder `PASS_BUILDERS` entry for that pass SHALL emit the new parameter with the value documented as the Olive runtime default, or with the value that preserves the pre-0.13.0 behavior when no runtime default is documented
2. WHEN olive-ai 0.13.0 removes a configuration parameter from an existing pass, THE Recipe_Builder SHALL omit that parameter from the generated recipe JSON, and `pnpm validate:recipe` SHALL pass without errors for any pipeline configuration that previously used that parameter
3. WHEN olive-ai 0.13.0 renames a configuration parameter, THE Recipe_Builder SHALL emit the new parameter name and map it to the same `UIState.passes` field that previously drove the old parameter name
4. IF olive-ai 0.13.0 introduces an entirely new pass that is listed in the MCP knowledge base `passes.json` catalog, THEN THE Recipe_Builder SHALL include a new `PASS_BUILDERS` entry whose key matches the pass type identifier from the catalog, inserted at the pipeline-correct position in `preferredPassOrder()`
5. WHEN olive-ai 0.13.0 changes the valid value set for an enum-typed parameter, THE Recipe_Builder SHALL emit only values present in the 0.13.0 valid set, and any `UIState` value that mapped to a now-removed enum member SHALL be coerced to the closest valid replacement before recipe emission
6. WHEN the Recipe_Builder generates a recipe for any active pass configuration, THE generated JSON SHALL pass the `pnpm validate:recipe` smoke test without errors or warnings related to unknown, missing, or invalid-valued parameters
7. IF a `PASS_BUILDERS` entry or `QUANT_METHOD_BUILDERS` entry is updated to reflect a 0.13.0 parameter change, THEN the corresponding entry in `olive-mcp-server/olive_mcp_server/knowledge_base/passes.json` SHALL be updated in the same changeset to keep the MCP tool catalog consistent with the builder output

### Requirement 6: Pipeline Validation Rule Updates

**User Story:** As a developer, I want pipeline validation to enforce any new compatibility constraints introduced in 0.13.0, so that invalid pass combinations are caught before job submission.

#### Acceptance Criteria

1. WHEN olive-ai 0.13.0 introduces a new pass incompatibility, THE Pipeline_Validator `CROSS_PASS_RULES` array SHALL include a declarative rule with all mandatory fields (`id`, `applies`, `fix`, `autoCoerce`, `severity`, `title`, `description`, `affectedTabs`, `affectedPasses`, `actionLabel`) encoding the constraint, and any rule with `autoCoerce: true` SHALL be silently applied by `coercePassFields` on every state commit
2. WHEN olive-ai 0.13.0 removes a previously incompatible combination, THE Pipeline_Validator SHALL delete the corresponding `CROSS_PASS_RULES` entry or update its `applies` predicate so that it returns `false` for the now-valid combination, and `getCrossPassIssues` SHALL no longer surface an issue for that combination
3. WHEN olive-ai 0.13.0 changes hardware or provider requirements for a pass, THE Pipeline_Validator `getProviderConflicts()` function SHALL add, remove, or update the corresponding `HardwareConflict` entry including `passKey`, `passName`, `reason`, `severity`, and `autofix` fields
4. IF no compatibility rules change between 0.12.1 and 0.13.0, THEN THE Pipeline_Validator SHALL have zero diff to `CROSS_PASS_RULES`, `getProviderConflicts()`, and all associated guard functions
5. WHEN a new `CROSS_PASS_RULES` entry is added or an existing entry is modified, THE Pipeline_Validator SHALL pass the existing `pnpm test` unit test suite and include at least one new test case per added or modified rule that asserts both the `applies` predicate trigger condition and the `fix` patch correctness

### Requirement 7: MCP Knowledge Base Refresh

**User Story:** As an AI agent querying the MCP server, I want the knowledge base to reflect 0.13.0 capabilities, so that recommendations and troubleshooting advice are accurate for the current runtime.

#### Acceptance Criteria

1. THE Knowledge_Base `passes.json` SHALL list every pass class discoverable from olive-ai 0.13.0, with each entry containing pass name, type, class path, input/output formats, required parameters, and optional parameters with type, default, and description fields matching the upstream implementation
2. WHEN olive-ai 0.13.0 changes hardware profile recommendations (e.g., new EP support, deprecated hardware paths), THE Knowledge_Base `hardware_profiles.json` SHALL be updated so that every listed execution provider, recommended pass, and known issue matches the 0.13.0 capabilities
3. WHEN a troubleshooting entry references behavior that changed in 0.13.0 (renamed passes, removed parameters, altered defaults, or changed error conditions), THE entry SHALL be updated to describe the 0.13.0 behavior and include an `olive_versions` field indicating the minimum applicable version
4. THE Knowledge_Base `passes.json` `olive_version` field SHALL read `"0.13.0"`
5. IF olive-ai 0.13.0 introduces new quantization algorithms or deprecates existing ones, THEN THE Knowledge_Base SHALL add or mark-deprecated the affected entries in both `passes.json` and `hardware_profiles.json`, with deprecated entries retaining their schema but including a `deprecated` boolean field set to `true` and a `deprecated_reason` string
6. THE Knowledge_Base `compatibility_matrix.json` SHALL reflect 0.13.0 pass-to-execution-provider compatibility, ensuring every pass in `passes.json` has a corresponding compatibility entry and no matrix entry references a pass or provider absent from the current knowledge base
7. WHEN the Knowledge_Base is updated, THE `version` and `last_updated` fields in each modified JSON file SHALL be incremented and set to the date the update was applied, and the total pass count in `passes.json` SHALL equal or exceed the count of pass classes registered in olive-ai 0.13.0

### Requirement 8: Documentation and Comment References

**User Story:** As a contributor reading the codebase, I want all version references to be consistent, so that there is no confusion about which Olive version the codebase targets.

#### Acceptance Criteria

1. WHEN a source file contains a hardcoded string `"0.12.1"` that identifies the target Olive version (e.g., in version constants, header comments, or issue-report templates), THE system SHALL replace that string with `"0.13.0"`
2. WHEN a documentation URL references the path segment `Olive/0.12.1/`, THE system SHALL update the path segment to `Olive/0.13.0/` if an HTTP GET to the new URL returns a 2xx status code
3. IF an HTTP GET to the updated `Olive/0.13.0/` URL returns a non-2xx status code, THEN THE system SHALL retain the original `Olive/0.12.1/` URL unchanged and add a code comment indicating the new-version link is not yet available
4. IF the file `scripts/sync-pass-catalog.mjs` contains a header comment referencing a target Olive version, THEN THE system SHALL update that comment to reference `0.13.0`
5. IF documentation files (files under `docs/` or README files at any level) reference `0.12.1` as the supported Olive version, THEN those references SHALL be replaced with `0.13.0`

### Requirement 9: Backward Compatibility

**User Story:** As a user with existing 0.12.x recipes, I want the upgrade to not break my saved configurations, so that I can continue working without re-creating pipelines.

#### Acceptance Criteria

1. WHEN a user loads a recipe that was generated targeting olive-ai 0.12.1, THE Recipe_Builder SHALL accept the recipe and produce a valid pipeline state if all pass names in the recipe exist in the 0.13.0 PASS_CATALOG and all parameters conform to their current schemas
2. IF olive-ai 0.13.0 removes a pass that exists in a user's saved recipe, THEN THE Pipeline_Validator SHALL emit a warning-severity issue (not a critical-severity issue) indicating the pass name that is no longer available, and SHALL exclude the removed pass from the built recipe while preserving all other passes in their declared order
3. THE Venv_Spec pip range SHALL include olive-ai 0.12.x within its permitted install range so that existing venvs remain functional until the user explicitly triggers a venv rebuild
4. IF a pass parameter was renamed in 0.13.0 and a migration mapping entry exists for the old parameter name, THEN THE Recipe_Builder SHALL replace the old parameter name with its mapped successor when loading the recipe and SHALL preserve the parameter value unchanged
5. IF a loaded recipe contains a pass parameter that was removed in 0.13.0 and no migration mapping entry exists, THEN THE Recipe_Builder SHALL discard the unrecognized parameter and THE Pipeline_Validator SHALL emit a warning-severity issue identifying the pass name and the discarded parameter name
6. WHEN the Recipe_Builder applies one or more migration mappings or discards unrecognized parameters during recipe load, THE system SHALL display a summary notification to the user listing the count of migrated parameters and the count of discarded parameters within 2 seconds of load completion
