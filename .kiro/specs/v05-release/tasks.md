# Implementation Plan: Olive Studio v0.5.0 Release

## Overview

This plan implements the four v0.5.0 workstreams in dependency order: shared types and utilities first, then hooks, then components, then distribution artifacts. Each workstream is self-contained but types from Workstream 1 are foundational. Property-based tests validate universal invariants; component and integration tests cover UI and routing behavior.

## Tasks

- [x] 1. Workstream 1 — Unified Assistant: Types and Utilities
  - [x] 1.1 Define Finding, Action, ReviewResult, and WorkspaceFingerprintState types
    - Create `src/lib/types/findingTypes.ts` with the `Finding`, `Action` (discriminated union on `kind`), `FindingSeverity`, `ActionKind`, `ReviewResult`, and `WorkspaceFingerprintState` interfaces
    - Export all types from the module
    - Ensure `Action` payload types are narrowed by `kind` using discriminated union pattern
    - Add `FINGERPRINT_EXCLUDED_KEYS` constant array
    - _Requirements: 2.1, 2.2, 3.1_

  - [x] 1.2 Implement workspace fingerprint computation utility
    - Create `src/lib/workspaceFingerprint.ts` with `computeFingerprint(state: UIState): string` using SHA-256 via SubtleCrypto
    - Exclude transient fields (`activeJobId`, `localFiles`) from hash input
    - Serialize remaining state deterministically (sorted keys) before hashing
    - Return lowercase hex string (64 chars)
    - _Requirements: 3.1, 3.5_

  - [x] 1.3 Write property tests for fingerprint determinism (Properties 5–6)
    - Create `src/lib/__tests__/workspaceFingerprint.test.ts`
    - **Property 5: Fingerprint Determinism and Transient Exclusion** — deeply-equal states after transient exclusion produce identical fingerprints; states differing only in transient fields produce identical fingerprints
    - **Property 6: Fingerprint Staleness Consistency** — mismatched fingerprint marks findings stale; same fingerprint retains findings; changed fingerprint invalidates all findings
    - **Validates: Requirements 3.1, 3.3, 3.4, 3.5, 3.7**
    - Use `fast-check` with 100 iterations minimum per property

  - [x] 1.4 Implement review reconciler logic
    - Create `src/lib/reviewReconciler.ts` with `reconcileFindings(aiFindings: Finding[], deterministicIssues: PipelineIssue[], providerConflicts: ProviderConflict[]): Finding[]`
    - Discard AI findings that contradict deterministic issues on same pass field
    - Preserve deterministic severity (critical always wins)
    - Suppress AI suggestions whose autofix wouldn't resolve provider conflicts
    - Ensure reconciler never mutates chatHistory or chatMessages
    - _Requirements: 5.1, 5.2, 5.3, 5.5_

  - [x] 1.5 Write property tests for review reconciler (Properties 7–8)
    - Create `src/lib/__tests__/reviewReconciler.test.ts`
    - **Property 7: Deterministic Validation Authority** — AI suggestions contradicting deterministic critical issues are suppressed; displayed severity matches deterministic source
    - **Property 8: Review Isolation from Chat History** — reconciliation cycle never modifies chatHistory or chatMessages arrays
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.5**

  - [x] 1.6 Write property tests for Finding/Action contract (Properties 1–2)
    - Create `src/lib/__tests__/findingContract.test.ts`
    - **Property 1: Finding Structural Invariant** — id non-empty and unique within run, title <= 120 chars, description <= 2000 chars, severity valid enum, actions array 1–10 elements with labels <= 80 chars
    - **Property 2: Action Payload Validity** — applyPatch payloads pass `sanitizeChatActionPatch`; when all patches are null, fallback explain/documentation action exists
    - **Validates: Requirements 2.1, 2.3, 2.4, 2.5**

- [x] 2. Workstream 1 — Unified Assistant: Hooks
  - [x] 2.1 Implement `useWorkspaceFingerprint` hook
    - Create `src/lib/hooks/useWorkspaceFingerprint.ts`
    - Subscribe to pipelineStore state changes
    - Recompute fingerprint on relevant state mutations (debounced)
    - Expose `fingerprint`, `computedAt`, and `isStale(resultFingerprint)` method
    - _Requirements: 3.1, 3.2, 3.5_

  - [x] 2.2 Implement `usePipelineReview` hook
    - Create `src/components/features/assistant/usePipelineReview.ts`
    - Orchestrate review lifecycle: trigger → compute fingerprint → call `/api/ai/analyze-state` → reconcile → attach fingerprint to results
    - Handle staleness: compare result fingerprint with current fingerprint on arrival
    - Discard stale results; abandon older in-flight reviews when newer starts
    - Expose `findings`, `score`, `level`, `summary`, `isStale`, `isLoading`, `refresh()`
    - _Requirements: 1.3, 1.7, 2.6, 3.2, 3.3, 3.6_

  - [x] 2.3 Implement `useReviewReconciler` hook
    - Create `src/components/features/assistant/useReviewReconciler.ts`
    - Wrap the `reconcileFindings` utility with reactive access to current deterministic validation state
    - Merge AI findings with `CROSS_PASS_RULES` issues and `getProviderConflicts()` output
    - Return reconciled findings array
    - _Requirements: 5.1, 5.2, 5.5_

- [x] 3. Workstream 1 — Unified Assistant: Components
  - [x] 3.1 Implement `StalenessIndicator` component
    - Create `src/components/features/assistant/StalenessIndicator.tsx`
    - Accept `isStale` prop, render visual badge (warning icon + "Results outdated" text)
    - Include "Re-run review" button that calls `refresh()` from `usePipelineReview`
    - _Requirements: 3.3, 3.4_

  - [x] 3.2 Implement `ActionButton` component
    - Create `src/components/features/assistant/ActionButton.tsx`
    - Polymorphic button rendering based on `Action.kind`
    - `applyPatch`: applies patch through `commitUiStateUpdate`, schedules re-run (300–1000ms debounce)
    - `navigate`: scrolls/focuses target panel
    - `explain`: injects explanation into chat
    - `documentation`: opens KB article or external URL
    - Display coercion notice when committed state differs from patch
    - _Requirements: 2.6, 2.7, 2.8_

  - [x] 3.3 Implement `FindingCard` component
    - Create `src/components/features/assistant/FindingCard.tsx`
    - Render severity badge, title, description (truncated with expand), evidence text
    - Render action buttons using `ActionButton` for each action in the finding
    - Support staleness overlay when `isStale` is true
    - _Requirements: 2.1, 2.4_

  - [x] 3.4 Implement `PipelineReview` component
    - Create `src/components/features/assistant/PipelineReview.tsx`
    - Collapsible section with header showing score badge and finding count
    - Expanded state: score (0–100), level label, last-checked timestamp, findings list via `FindingCard`
    - Collapsed state: compact score badge + unresolved finding count
    - Zero-state: "No review yet" message with Refresh button
    - Expand/collapse via click or Enter/Space on focused header
    - Expanded by default on first session open
    - Use `usePipelineReview` hook for data
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

  - [x] 3.5 Modify `AssistantSidebar` to use unified Assistant tab
    - Update `src/components/features/assistant/AssistantSidebar.tsx`
    - Change tab type from `"audit" | "chat" | "settings"` to `"assistant" | "settings"`
    - Render `PipelineReview` above `ChatPanel` in a single scrollable container within the "assistant" tab
    - Remove references to deprecated `AuditPanel`
    - _Requirements: 1.1, 1.2, 1.5_

  - [x] 3.6 Write property tests for non-patch action store preservation (Property 3)
    - Add to `src/lib/__tests__/findingContract.test.ts` or create separate file
    - **Property 3: Non-Patch Actions Preserve Store** — executing navigate/explain/documentation actions does not modify PipelineStore state
    - **Validates: Requirements 2.8**

  - [x] 3.7 Write property test for coercion difference detection (Property 4)
    - Add to `src/lib/__tests__/findingContract.test.ts`
    - **Property 4: Coercion Difference Detection** — when commitUiStateUpdate produces different values than the patch, a coercion notice is generated
    - **Validates: Requirements 2.7**

- [x] 4. Checkpoint — Workstream 1 Complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Workstream 2 — Agent UI: Types and Utilities
  - [x] 5.1 Define Agent UI types
    - Create or extend `src/lib/types/agentTypes.ts` with `ActivityEntryKind`, `ActivityLogEntry`, `AgentSessionState`, `CompareResultsOutput`, `ScoringPreference`
    - Export all types
    - _Requirements: 7.2, 7.4, 8.3, 8.6, 8.7_

  - [x] 5.2 Implement activity log utility functions
    - Create `src/lib/activityLog.ts`
    - `truncateEntry(entry: ActivityLogEntry): ActivityLogEntry` — applies kind-specific truncation limits (reasoning: 512, tool_call: 256, tool_result: 512, decision: 256, error: 512)
    - `appendEntry(entries: ActivityLogEntry[], entry: ActivityLogEntry): ActivityLogEntry[]` — FIFO eviction at 2000 max
    - `createTerminalEntry(outcome: AgentSessionState['outcome']): ActivityLogEntry` — formats terminal entry per outcome type
    - _Requirements: 7.2, 7.4, 7.5, 7.6_

  - [x] 5.3 Write property tests for activity log (Properties 9–11)
    - Create `src/lib/__tests__/activityLog.test.ts`
    - **Property 9: Activity Log Entry Truncation** — each kind's text is truncated to its limit; expandedText holds full value when truncated
    - **Property 10: Activity Log Terminal Entry Correctness** — terminal entry contains correct fields per outcome type (success/failure/cancellation)
    - **Property 11: Activity Log Bounded FIFO** — entry count never exceeds 2000; oldest evicted first; new session clears previous entries
    - **Validates: Requirements 7.2, 7.4, 7.5, 7.6**

  - [x] 5.4 Implement batch comparison validation
    - Create `src/lib/batchComparison.ts`
    - `validateJobCount(count: number): boolean` — returns true for 2–10 inclusive
    - `parseMcpCompareOutput(raw: Record<string, unknown>): CompareResultsOutput | null` — validates and parses MCP tool response
    - _Requirements: 8.6_

  - [x] 5.5 Write property test for batch comparison job count constraint (Property 12)
    - Create `src/lib/__tests__/batchComparison.test.ts`
    - **Property 12: Batch Comparison Job Count Constraint** — inputs outside [2, 10] are rejected; inputs within range are accepted
    - **Validates: Requirements 8.6**

- [x] 6. Workstream 2 — Agent UI: Hooks
  - [x] 6.1 Implement `useAgentMode` hook
    - Create `src/components/features/execute/useAgentMode.ts`
    - Local state: `mode` (manual/agent), `agentRunning`, `entries` (ActivityLogEntry[]), `outcome`
    - Methods: `startAgent()`, `stopAgent()`, `appendEntry()`, `clearLog()`
    - 10-second timeout for start failure
    - Session clear on new start
    - _Requirements: 6.1, 6.3, 6.4, 6.6, 7.5_

  - [x] 6.2 Implement `useAgentStream` hook
    - Create `src/components/features/execute/useAgentStream.ts`
    - SSE connection to agent events endpoint
    - Parse incoming events into `ActivityLogEntry` format
    - Auto-reconnect with exponential backoff (max 3 retries)
    - Append error entry on connection failure
    - _Requirements: 7.1_

- [x] 7. Workstream 2 — Agent UI: Components
  - [x] 7.1 Implement `ModeToggle` component
    - Create `src/components/features/execute/ModeToggle.tsx`
    - Two mutually exclusive states: Manual (default) and Agent
    - Visual toggle control (segmented button or switch)
    - _Requirements: 6.1, 6.2_

  - [x] 7.2 Implement `AgentConfirmDialog` component
    - Create `src/components/features/execute/AgentConfirmDialog.tsx`
    - Confirmation dialog when switching away from active agent
    - "Confirm" cancels agent + switches mode; "Cancel" dismisses and stays
    - _Requirements: 6.5_

  - [x] 7.3 Implement `ActivityLogEntry` component
    - Create `src/components/features/execute/ActivityLogEntry.tsx`
    - Render single entry with kind-specific styling (icon + color)
    - Timestamp display at HH:MM:SS resolution
    - Expand affordance for truncated entries (show `expandedText`)
    - _Requirements: 7.2_

  - [x] 7.4 Implement `ActivityLog` component
    - Create `src/components/features/execute/ActivityLog.tsx`
    - Scrollable container rendering entries chronologically
    - Auto-scroll to latest unless user has scrolled away from bottom
    - Virtualized list for performance with up to 2000 entries
    - _Requirements: 7.1, 7.3, 7.5, 7.6_

  - [x] 7.5 Implement `AgentControls` component
    - Create `src/components/features/execute/AgentControls.tsx`
    - "Start Agent" button (enabled when not running), "Stop Agent" button (enabled when running)
    - Agent status indicator
    - Integrates with `useAgentMode` hook
    - _Requirements: 6.3, 6.4, 6.6_

  - [x] 7.6 Modify `ExecutionWorkspace` to integrate Agent UI
    - Update `src/components/features/execute/ExecutionWorkspace.tsx`
    - Add `ModeToggle` at top of panel
    - Conditionally render Manual controls or Agent controls based on mode
    - Hide manual submission controls when in Agent mode and vice versa
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 7.7 Enhance `BatchComparisonView` with scoring preference and winner highlight
    - Update `src/components/features/execute/BatchComparisonView.tsx`
    - Add scoring preference selector (latency/size/accuracy/balanced, default "balanced")
    - Accept `CompareResultsOutput` from MCP tool
    - Highlight winner row when `winner` is non-null; show `reasoning`
    - Show excluded jobs with reasons when `winner` is null
    - Disable "Compare Results" button when < 2 completed jobs; tooltip explaining requirement
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

- [x] 8. Checkpoint — Workstream 2 Complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Workstream 3 — Product: Report Export
  - [x] 9.1 Implement `reportGenerator.ts`
    - Create `src/lib/reportGenerator.ts`
    - `generateMarkdownReport(options: ReportOptions): string` — produces Markdown with: title, UTC timestamp, per-job blocks (model ID, provider, pass names, duration, status, VRAM)
    - Optional sections: recipe JSON block (when `includeRecipeJson`), log summary (when `includeLogSummary`: total count, error count, last line truncated to 200 chars)
    - Comparison section when 2+ completed jobs: fastest, lowest VRAM (if present), average duration
    - Support 1–100 job records
    - `getReportFilename(): string` — returns `olive-report-YYYY-MM-DD.md` using current UTC date
    - _Requirements: 9.2, 9.3, 9.6, 9.7, 9.9_

  - [x] 9.2 Write property tests for report generator (Properties 13–14)
    - Create `src/lib/__tests__/reportGenerator.test.ts`
    - **Property 13: Report Content Completeness** — output contains model ID, provider, pass names, duration, status for each job; optional sections present when configured; comparison section when 2+ completed
    - **Property 14: Report Filename Pattern** — filename matches `^olive-report-\d{4}-\d{2}-\d{2}\.md$` with current UTC date
    - **Validates: Requirements 9.2, 9.3, 9.7, 9.9**

  - [x] 9.3 Implement PDF export via print dialog
    - Add `triggerPdfExport(markdownContent: string): void` to `src/lib/reportGenerator.ts`
    - Open print-friendly browser window, render markdown content, trigger `window.print()` within 500ms
    - Catch popup-blocked scenario without throwing
    - _Requirements: 9.4, 9.5_

  - [x] 9.4 Implement `ExportReportMenu` component
    - Create `src/components/features/execute/ExportReportMenu.tsx`
    - Dropdown with "Export as Markdown" and "Export as PDF" options
    - Checkboxes for optional sections (include recipe JSON, include log summary)
    - Visible only when qualifying jobs (completed/failed/cancelled) exist
    - Hidden when `reportExport` feature flag is disabled
    - Triggers download (Markdown) or print dialog (PDF)
    - _Requirements: 9.1, 9.8_

- [x] 10. Workstream 3 — Product: Recipe Catalog Version Pinning
  - [x] 10.1 Implement `recipeCatalogPin.ts`
    - Create `src/lib/recipeCatalogPin.ts`
    - `resolveHeadSha(branch: string): Promise<string>` — fetch HEAD commit SHA via GitHub API
    - `fetchCatalogAtSha(sha: string, branch: string): Promise<CatalogEntry[]>` — fetch catalog content at specific commit
    - `isCatalogStale(stored: CatalogMetadata, upstreamSha: string): boolean` — compare stored SHA with upstream
    - `formatCatalogMetadata(sha: string, branch: string): CatalogMetadata` — construct metadata with ISO timestamp
    - Validate SHA is 40-char hex; retain previous catalog on fetch failure
    - Use branch from `getRecipesBranch()` (default `OLIVE_RECIPES_BRANCH_DEFAULT`)
    - _Requirements: 10.1, 10.2, 10.4, 10.5, 10.6_

  - [x] 10.2 Write property test for catalog commit SHA format (Property 15)
    - Create `src/lib/__tests__/recipeCatalogPin.test.ts`
    - **Property 15: Catalog Commit SHA Format** — stored commitSha is exactly 40 chars of `[0-9a-f]`
    - **Validates: Requirements 10.1, 10.2**

  - [x] 10.3 Implement `CatalogUpdateNotice` component
    - Create `src/components/features/recipes/CatalogUpdateNotice.tsx`
    - Inline notification when newer recipes available (upstream SHA differs from stored)
    - "Update Catalog" button to trigger refresh
    - Error display for fetch failures (network/auth/branch-not-found)
    - Does not auto-replace pinned recipes
    - _Requirements: 10.3, 10.5, 10.7_

  - [x] 10.4 Integrate catalog pinning into recipe loading flow
    - Update recipe loading in pipelineStore to persist `CatalogMetadata` (SHA + branch) alongside recipe data
    - Check upstream HEAD after 60s since last fetch when catalog panel opens
    - Show `CatalogUpdateNotice` when upstream differs
    - Serve from local cache when pinned SHA is unreachable upstream
    - _Requirements: 10.2, 10.3, 10.7_

- [x] 11. Workstream 3 — Product: MultiLoRA Adapter Support (Feature-Flagged)
  - [x] 11.1 Implement MultiLoRA adapter validation
    - Create `src/lib/multiLoraValidation.ts`
    - `validateAdapters(adapters: unknown[], vramGb: number): ValidationResult` — validates each entry (name non-empty + unique, path non-empty, rank positive int, alpha positive finite, targetModules array of non-empty strings)
    - Enforce max count: 2 for <= 12GB VRAM, 8 for > 12GB VRAM
    - Return per-entry error messages identifying adapter index and invalid field
    - Detect and report duplicate names with conflicting indices
    - _Requirements: 11.2, 11.4, 11.5_

  - [x] 11.2 Write property tests for MultiLoRA validation (Property 16)
    - Create `src/lib/__tests__/multiLoraValidation.test.ts`
    - **Property 16: MultiLoRA Adapter Validation** — name non-empty + unique, path non-empty, rank positive int, alpha positive finite; max count respects VRAM threshold (2 for <=12GB, 8 for >12GB); duplicate names detected
    - **Validates: Requirements 11.2, 11.4, 11.5**

  - [x] 11.3 Gate MultiLoRA UI behind feature flag
    - Ensure recipe builder hides Multi-LoRA panels when `multiLora` flag is disabled
    - Reject multi-adapter recipes in single-adapter mode (use only `adapter_path`)
    - When enabled, emit validated adapters in Olive 0.13.0 `ExtractAdapters` pass format
    - _Requirements: 11.1, 11.6_

- [x] 12. Checkpoint — Workstream 3 Complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Workstream 4 — Distribution: Docker Documentation
  - [x] 13.1 Create Docker deployment guide
    - Create `docs/deployment/docker.md`
    - Include `docker run` example with `MCP_TRANSPORT`, `MCP_HOST`, `MCP_PORT`, `OLIVE_MCP_RETRIEVAL_MODE` env vars, read-only volume mount for KB, port 8000 mapping
    - Document all configurable env vars with accepted values, defaults, descriptions
    - Include `docker-compose.yml` example with MCP server + Express app on shared network
    - State minimum Docker Engine 20.10, port 8000, `GET /sse` health-check
    - Reference `olive-mcp-server/Dockerfile`, note multi-stage build size (1.5–3GB)
    - Include verification step (curl command with expected output)
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

- [x] 14. Workstream 4 — Distribution: PyPI Publish
  - [x] 14.1 Configure `olive-mcp-server/pyproject.toml` for PyPI publishing
    - Add/update package metadata (name: `olive-mcp-server`, description, license, classifiers)
    - Include `knowledge_base/` JSON files and `knowledge_base/indexes/` as package data
    - Declare `mcp<2` dependency constraint
    - Add `olive-mcp-server` console entry point launching FastMCP stdio server
    - Ensure Python >= 3.10 requirement
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [x] 14.2 Create PyPI publish CI workflow
    - Create `.github/workflows/publish-mcp-pypi.yml`
    - Trigger on `mcp-server/v*` tag push
    - Build sdist + wheel
    - Verify pyproject.toml version matches tag version; fail on mismatch
    - Upload to PyPI
    - _Requirements: 13.5, 13.6, 13.7_

- [x] 15. Workstream 4 — Distribution: Tauri Signed Installer
  - [x] 15.1 Configure Tauri signing in `src-tauri/tauri.conf.json`
    - Add signing identity references via environment variable placeholders
    - No hardcoded private keys, passwords, or passphrases
    - Configure Windows (.msi/.exe) and macOS (.dmg) targets
    - _Requirements: 14.4, 14.5_

  - [x] 15.2 Create desktop release CI workflow
    - Create `.github/workflows/release-desktop.yml`
    - Build signed Windows installer (OV/EV certificate from CI secrets)
    - Build signed + notarized macOS installer (Developer ID + stapled notarization)
    - Produce unsigned installer with warning when certificate unavailable
    - Upload artifacts with platform + version in filename
    - _Requirements: 14.1, 14.2, 14.3, 14.6, 14.7_

- [x] 16. Final Checkpoint — All Workstreams Complete
  - Ensure all tests pass, ask the user if questions arise.
  - Verify `pnpm lint:quick` passes without errors
  - Confirm all property test files exist and reference their design properties

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation per workstream
- Property tests validate universal correctness properties (fast-check, 100 iterations minimum)
- Unit tests validate specific examples and edge cases
- All new types use `Record<string, unknown>` instead of `any`
- Heavy panels (PipelineReview, ActivityLog) should use `React.lazy()` + `<Suspense>`
- All POST routes in new server endpoints must use `parseBody()` middleware
- MCP server dependency must remain pinned at `mcp<2`
- Distribution tasks (13–15) are CI/config only — no runtime code changes

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "5.1"] },
    { "id": 1, "tasks": ["1.2", "1.4", "1.6", "5.2", "5.4"] },
    { "id": 2, "tasks": ["1.3", "1.5", "5.3", "5.5", "2.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "6.1", "6.2"] },
    { "id": 4, "tasks": ["3.1", "3.2", "3.6", "3.7", "7.1", "7.2", "7.3"] },
    { "id": 5, "tasks": ["3.3", "7.4", "7.5"] },
    { "id": 6, "tasks": ["3.4", "7.6", "7.7"] },
    { "id": 7, "tasks": ["3.5"] },
    { "id": 8, "tasks": ["9.1", "10.1", "11.1"] },
    { "id": 9, "tasks": ["9.2", "9.3", "10.2", "11.2"] },
    { "id": 10, "tasks": ["9.4", "10.3", "11.3"] },
    { "id": 11, "tasks": ["10.4"] },
    { "id": 12, "tasks": ["13.1", "14.1", "15.1"] },
    { "id": 13, "tasks": ["14.2", "15.2"] }
  ]
}
```
