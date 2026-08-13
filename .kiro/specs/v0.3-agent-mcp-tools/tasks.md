# Implementation Plan: v0.3-agent-mcp-tools

## Overview

Five new Python MCP tools forming an autonomous agent loop (plan → execute → observe → diagnose → compare) plus model metadata lookup. All tools are lazy-imported Python modules in `olive-mcp-server/olive_mcp_server/tools/`, registered in `_TOOL_IMPORTS` and the Express `allowedTools.ts` allowlist. Zero new pip dependencies; all tools reuse stdlib + existing internal modules.

## Tasks

- [x] 1. Shared utilities and registration scaffolding
  - [x] 1.1 Add Phase 3 entries to `allowedTools.ts`
    - Add `"execute_and_observe"`, `"plan_optimization"`, `"diagnose_and_fix"`, `"compare_results"`, `"get_model_info"` to `ALLOWED_MCP_TOOL_NAMES` under a `// Phase 3: Agent autonomous loop` comment group
    - _Requirements: 2.2, 4.2, 6.2, 8.2, 10.2_

  - [x] 1.2 Add `_TOOL_IMPORTS` entries in `mcp_server.py`
    - Add 5 lazy-import entries: `execute_and_observe` → `agent_execute`, `plan_optimization` → `agent_planner`, `diagnose_and_fix` → `agent_diagnosis`, `compare_results` → `agent_compare`, `get_model_info` → `agent_model_info`
    - _Requirements: 2.1, 4.1, 6.1, 8.1, 10.1, 11.1_

- [x] 2. Implement `get_model_info` tool
  - [x] 2.1 Create `olive-mcp-server/olive_mcp_server/tools/agent_model_info.py`
    - Implement `get_model_info(model_id: str)` function
    - Validate model_id (1–256 chars), return `invalid_model_id` error otherwise
    - Attempt `urllib.request.urlopen` to HF API with 3s timeout
    - Extract params from `safetensors.total` or `config.num_parameters`; extract architecture from `config.architectures[0]`
    - Compute `estimated_vram_gb = params_b * 2`
    - On HF failure: fall back to `inferParamBillions` regex heuristic (port from `src/lib/vramEstimate.ts`)
    - Classify `model_type` via `_normalize_model_type()` reuse from `strategy_advisor`
    - Set `recommended_quant`: `"int4"` if params_b ≥ 6.0, else `"int8"`
    - Set confidence: `"high"` for HF API source, `"medium"` for explicit size token heuristic, `"low"` for family default
    - Wrap in top-level try/except returning `internal_error` on unexpected exceptions
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 11.1, 11.3, 12.1, 12.5_

  - [x] 2.2 Write property tests for `get_model_info`
    - **Property 7: VRAM Estimate Arithmetic** — For any positive float params_b, estimated_vram_gb == params_b × 2.0
    - **Property 8: Recommended Quantization Threshold** — params_b ≥ 6.0 → int4, else int8
    - **Validates: Requirements 9.3, 9.5**

  - [x] 2.3 Write unit tests in `tests/test_agent_model_info.py`
    - Test HF API success path (params from safetensors)
    - Test HF timeout → heuristic fallback
    - Test HF 404 → heuristic fallback
    - Test invalid model_id error
    - Test explicit size token confidence (medium) vs family default (low)
    - Test JSON round-trip for all outputs
    - _Requirements: 13.5, 13.6, 13.7_

- [x] 3. Implement `execute_and_observe` tool
  - [x] 3.1 Create `olive-mcp-server/olive_mcp_server/tools/agent_execute.py`
    - Implement `execute_and_observe(recipe: dict, timeout: int | None = None)` function
    - Implement timeout clamping: `min(max(timeout or 600, 10), 1800)`
    - Submit recipe via `studio_request("POST", "/api/olive/jobs/submit", body={"recipe": recipe})`
    - On submission error: return structured error (no `side_effect` field) with codes `invalid_recipe`, `submission_denied`, `studio_unavailable`
    - Poll `GET /api/olive/agent/status/{job_id}` every 2 seconds
    - Stop on terminal state (`completed`, `failed`, `cancelled`) or timeout expiry
    - Terminal-state-at-timeout-boundary: terminal wins (`timed_out: false`)
    - Return structured response with `status`, `job_id`, `exit_code`, `logs` (max 200), `metrics`, `elapsed_ms`, `artifact_path_refs`, `timed_out`, `side_effect: True`
    - Wrap in top-level try/except for `internal_error`
    - _Requirements: 1.1–1.12, 2.3, 2.4, 2.5, 11.1, 11.3, 12.1–12.7_

  - [x] 3.2 Write property tests for `execute_and_observe`
    - **Property 1: Timeout Clamping Invariant** — For any integer T, clamped result is in [10, 1800]; None → 600
    - **Property 2: Side-Effect Field Correctness** — Successful submission → `side_effect: True`; pre-submission error → no `side_effect` key
    - **Validates: Requirements 1.10, 1.11, 1.12, 2.3**

  - [x] 3.3 Write unit tests in `tests/test_agent_execute.py`
    - Test successful completion (returns final metrics and logs)
    - Test failed job early abort (stops within 1 poll cycle)
    - Test timeout expiry (timed_out: true)
    - Test submission denied (policy 403)
    - Test studio unavailable
    - Test invalid recipe error
    - Test JSON round-trip for all outputs
    - _Requirements: 13.1, 13.6, 13.7_

- [x] 4. Implement `plan_optimization` tool
  - [x] 4.1 Create `olive-mcp-server/olive_mcp_server/tools/agent_planner.py`
    - Implement `plan_optimization(intent: str, hardware_probe: dict | None = None, model_id: str = "")` function
    - Validate intent (1–2000 chars)
    - Parse intent via regex/keyword dispatch for: hardware target, model reference, optimization goal
    - If none found → return `unparseable_intent` error
    - Call `get_quantization_strategy()`, `get_hardware_optimization_guide()`, `get_pass_chain()` internally
    - Compose UIState patch from results
    - If `hardware_probe` provided → override provider/CUDA selection
    - If `model_id` provided → run `_normalize_model_type()` for pass selection
    - Validate patch via `validate_ui_state_recipe()` through Studio bridge (best-effort; `validated: false` if Studio down)
    - Return `ui_state_patch`, `reasoning`, `alternatives` (0–3), `validated`, optional `validation_note`
    - Wrap in top-level try/except for `internal_error`
    - _Requirements: 3.1–3.9, 4.3, 11.1, 11.3, 12.1–12.7_

  - [x] 4.2 Write property tests for `plan_optimization`
    - **Property 3: Unparseable Intent Rejection** — Random strings with no hardware/model/goal keywords → `unparseable_intent` error
    - **Validates: Requirements 3.5**

  - [x] 4.3 Write unit tests in `tests/test_agent_planner.py`
    - Test LLM intent parsing (hardware + quantization goal recognized)
    - Test CNN intent parsing
    - Test intent with hardware_probe override
    - Test Studio-down degradation (validated: false, validation_note present)
    - Test unparseable intent error
    - Test JSON round-trip for all outputs
    - _Requirements: 13.2, 13.6, 13.7_

- [x] 5. Implement `diagnose_and_fix` tool
  - [x] 5.1 Create `olive-mcp-server/olive_mcp_server/tools/agent_diagnosis.py`
    - Implement `diagnose_and_fix(error_message: str, recipe: dict, hardware_probe: dict | None = None)` function
    - Validate error_message (1–4000 chars); return `invalid_input` if out of range
    - Call `troubleshoot_olive_error(error_message, ...)` internally
    - If diagnosis has `updated_config` with `applyable=True`: apply RFC 7386 JSON Merge Patch onto recipe → `fixed_recipe`; generate `changes_made` list
    - If no `updated_config` or no match: `fixed_recipe: null`, `fix_confidence: "none"`
    - Map confidence: KB match with `updated_config` → `"high"`, rule-based → `"medium"`, weak match → `"low"`, no fix → `"none"`
    - Validate fixed recipe via `validate_optimization_job()` if Studio reachable; set `recipe_validated` accordingly
    - Return `diagnosis`, `fixed_recipe`, `changes_made`, `recipe_validated`, `fix_confidence`, `side_effect: False`
    - Wrap in top-level try/except for `internal_error`
    - _Requirements: 5.1–5.9, 6.3, 11.1, 11.3, 12.1–12.7_

  - [x] 5.2 Write property tests for `diagnose_and_fix`
    - **Property 4: JSON Merge Patch Correctness** — For any recipe R and updated_config U, merge preserves RFC 7386 semantics (non-null overrides, null removes, absent keys unchanged)
    - **Property 5: Fix Confidence Determinism** — Confidence maps deterministically from diagnosis outcome
    - **Validates: Requirements 5.3, 5.7**

  - [x] 5.3 Write unit tests in `tests/test_agent_diagnosis.py`
    - Test KB match with updated_config (recipe patched, fix_confidence: high)
    - Test KB match without updated_config (fixed_recipe: null, fix_confidence: none)
    - Test no KB match
    - Test bridge validation unavailable (recipe_validated: false)
    - Test invalid input length error
    - Test JSON round-trip for all outputs
    - _Requirements: 13.3, 13.6, 13.7_

- [x] 6. Implement `compare_results` tool
  - [x] 6.1 Create `olive-mcp-server/olive_mcp_server/tools/agent_compare.py`
    - Implement `compare_results(job_ids: list[str], preference: str = "balanced")` function
    - Validate job_ids count (2–10); return `invalid_job_count` if out of range
    - Normalize preference (unknown → `"balanced"`)
    - Fetch each job via `studio_request("GET", f"/api/olive/agent/status/{jid}")`
    - Exclude non-terminal, failed, or unfetchable jobs → `excluded_jobs`
    - Score remaining by metrics with preference weighting (2x for chosen metric, 1x for others; balanced = all 1x)
    - Scoring: min-max normalize each metric; invert for latency/size (lower is better); apply weights; weighted average
    - Select highest score as winner (null if <2 scoreable)
    - Return `comparison`, `winner`, `reasoning`, `excluded_jobs`, `preference`, `side_effect: False`
    - Wrap in top-level try/except for `internal_error`
    - _Requirements: 7.1–7.8, 8.3, 11.1, 11.3, 12.1–12.7_

  - [x] 6.2 Write property tests for `compare_results`
    - **Property 6: Preference-Weighted Scoring** — For any 2+ jobs with metrics and any valid preference, preferred metric gets 2x weight; balanced → equal weights; winner has highest score
    - **Validates: Requirements 7.3, 7.8**

  - [x] 6.3 Write unit tests in `tests/test_agent_compare.py`
    - Test 2+ completed jobs with clear winner
    - Test excluded non-terminal jobs
    - Test fewer than 2 scoreable (winner: null)
    - Test invalid job count error
    - Test preference-based scoring differences (latency vs size vs balanced)
    - Test JSON round-trip for all outputs
    - _Requirements: 13.4, 13.6, 13.7_

- [x] 7. Checkpoint — Core implementation complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Cross-cutting error handling and integration verification
  - [x] 8.1 Add universal error structure tests
    - Add a shared test (or parametrize across all 5 test files) verifying **Property 9: Error Structure Invariant** — every error contains non-empty `"error"` (snake_case pattern) and non-empty `"message"`
    - Add **Property 10: JSON Serialization Round-Trip** assertion to every test that produces output
    - _Requirements: 12.1, 13.7_

  - [x] 8.2 Verify lazy-import isolation
    - Add a test in `tests/test_agent_execute.py` (or a shared test file) that imports `mcp_server` without calling any tool and asserts none of `agent_execute`, `agent_planner`, `agent_diagnosis`, `agent_compare`, `agent_model_info` are in `sys.modules`
    - _Requirements: 11.2, 11.4_

- [-] 9. Final checkpoint — Full validation
  - Ensure all tests pass (`cd olive-mcp-server && python -m pytest tests/test_agent_execute.py tests/test_agent_planner.py tests/test_agent_diagnosis.py tests/test_agent_compare.py tests/test_agent_model_info.py -q`), ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (10 properties mapped to tasks 2.2, 3.2, 4.2, 5.2, 6.2, 8.1)
- Unit tests validate specific examples and edge cases
- All tests mock externals (`studio_request`, `urllib.request.urlopen`) — no network needed
- The implementation language is Python (as specified in the design)
- All 5 tool modules follow the same defensive pattern: input validation → business logic → bridge calls (graceful degradation) → top-level try/except

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "3.1", "4.1", "5.1", "6.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.2", "3.3", "4.2", "4.3", "5.2", "5.3", "6.2", "6.3"] },
    { "id": 3, "tasks": ["8.1", "8.2"] }
  ]
}
```
