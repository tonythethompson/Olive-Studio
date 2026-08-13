---
name: agent-loop
description: Run an autonomous optimization loop using the Olive MCP agent tools. Use when you need to plan, execute, diagnose failures, retry, and compare optimization jobs without human intervention at each step.
---

# Agent Autonomous Loop

The Olive MCP server provides Phase 3 "agent loop" tools that enable fully autonomous optimization workflows. This skill describes the complete loop pattern and when to use each tool.

## Loop Overview

```
Intent (natural language)
    |
    v
plan_optimization  --> UIState patch + reasoning
    |
    v
get_recipe_for_ui_state --> olive_recipe (complete Olive JSON)
    |
    v
execute_and_observe --> Submit job, poll until terminal
    |
    +---> Success --------+
    |                     |
    +---> Failure         |
           |              |
           v              |
    diagnose_and_fix      |
           |              |
           v              |
    (retry execute)       |
           |              v
           +-------> compare_results --> Winner
```

## Tools Reference

| Tool | Input | Output | Side Effects |
|------|-------|--------|--------------|
| `plan_optimization` | Natural language intent, optional hardware probe, model ID | UIState patch, reasoning, alternatives | None |
| `execute_and_observe` | Complete Olive recipe JSON, timeout | Job status, metrics, logs, artifacts | Submits job |
| `diagnose_and_fix` | Error message, current recipe, optional hardware probe | Diagnosis, fixed recipe, change list, confidence | None |
| `compare_results` | 2-10 job IDs, preference (latency/size/accuracy/balanced) | Scored jobs, winner, reasoning | None |
| `get_model_info` | HuggingFace model ID | Params, architecture, VRAM estimate, recommended quant | None |

## Step-by-Step Workflow

### Step 1: Understand the Model

Before planning, gather model metadata:

```
Tool: get_model_info
Input: { "model_id": "meta-llama/Llama-3-8B" }
```

Returns parameter count, architecture type, VRAM requirements, and a recommended quantization method.

### Step 2: Plan the Optimization

Convert user intent into a concrete recipe patch:

```
Tool: plan_optimization
Input: {
  "intent": "Quantize Llama-3-8B to INT4 for NVIDIA RTX 4090 with minimal accuracy loss",
  "model_id": "meta-llama/Llama-3-8B",
  "hardware_probe": { ... }  // optional, from get_runtime_ep_hints
}
```

Returns:
- `ui_state_patch` — Partial UIState to apply
- `reasoning` — Why these choices were made
- `alternatives` — Other approaches considered
- `validated` — Whether the plan passed internal validation

If `validated` is false, check `validation_note` and adjust or re-plan with refined intent.

### Step 3: Build the Full Recipe

If you have a UIState (from the Studio UI or the plan), get the complete recipe:

```
Tool: get_recipe_for_ui_state
Input: { "ui_state": { ...full or patched UIState... } }
```

Or if you already have a recipe JSON, skip to execution.

### Step 4: Validate Before Submission

Optional but recommended — catches errors before spending GPU time:

```
Tool: validate_optimization_job
Input: { "recipe": { ...recipe JSON... } }
```

If validation fails, use `diagnose_and_fix` on the validation error before submitting.

### Step 5: Execute

Submit and wait for completion:

```
Tool: execute_and_observe
Input: {
  "recipe": { ...complete recipe JSON... },
  "timeout": 600  // seconds, max 1800
}
```

Returns on success:
- `status`: "completed"
- `metrics`: latency, size, accuracy measurements
- `logs`: Last N log lines
- `artifact_path_refs`: Output model artifact references

Returns on failure:
- `status`: last polled job status (typically `"failed"`, `"queued"`, or `"running"`)
- `timed_out`: `true` when polling reached the timeout (status is **not** rewritten to `"timeout"`)
- `logs`: Diagnostic log lines containing the failure details

Treat `timed_out: true` as a timeout even if `status` is still `"running"` or `"queued"`. That is **not** a terminal failure: the Studio job may still be running. Continue polling the same job, or cancel it, before calling `execute_and_observe` again. Do not submit a second job while the first is still queued or running.

### Step 6: Handle Failures

When execution fails, diagnose and repair:

```
Tool: diagnose_and_fix
Input: {
  "error_message": "RuntimeError: CUDA out of memory...",
  "recipe": { ...the recipe that failed... },
  "hardware_probe": { ... }  // optional
}
```

Returns:
- `diagnosis` — What went wrong and why
- `fixed_recipe` — Repaired recipe (if repairable)
- `changes_made` — List of specific changes made
- `fix_confidence` — How confident the fix is (high/medium/low)

Decision points:
- `fix_confidence: "high"` — Retry with the fixed recipe automatically
- `fix_confidence: "medium"` — Retry but be prepared for another failure
- `fix_confidence: "low"` — Present to user for guidance, or try a different approach

### Step 7: Retry (Loop)

After `diagnose_and_fix` returns a repaired recipe, re-execute:

```
Tool: execute_and_observe
Input: { "recipe": { ...fixed recipe... }, "timeout": 600 }
```

Cap at 3 retry attempts. After 3 failures, surface the issue to the user.

### Step 8: Compare Results

When you have multiple successful jobs (e.g., different quantization methods):

```
Tool: compare_results
Input: {
  "job_ids": ["job_abc123", "job_def456", "job_ghi789"],
  "preference": "balanced"  // or "latency", "size", "accuracy"
}
```

Returns:
- Scored ranking of all jobs
- Winner with reasoning
- Per-job metrics breakdown
- Excluded jobs (if any failed/incomplete)

## Common Loop Patterns

### Pattern A: Single-Shot Optimization
```
get_model_info
  -> plan_optimization
  -> get_recipe_for_ui_state(ui_state_patch)
  -> execute_and_observe(olive_recipe)
  -> done
```
`plan_optimization` returns a `ui_state_patch`, **not** an Olive recipe. Passing that patch to `execute_and_observe` fails with `invalid_recipe`. Convert with `get_recipe_for_ui_state` and submit the returned `olive_recipe` object.

Best for: Simple requests with high confidence.

### Pattern B: Iterate Until Success
```
plan -> get_recipe_for_ui_state -> execute
  -> (fail) -> diagnose_and_fix -> execute
  -> (fail) -> diagnose_and_fix -> execute -> success
```
Best for: Complex configurations where first attempts may fail (OOM, compatibility).

### Pattern C: Multi-Strategy Comparison
```
plan(strategy_1) -> get_recipe_for_ui_state -> execute -> success
plan(strategy_2) -> get_recipe_for_ui_state -> execute -> success
plan(strategy_3) -> get_recipe_for_ui_state -> execute -> success
compare_results -> winner
```
Best for: Finding the best approach — try AWQ, GPTQ, and HQQ, then pick the winner.

### Pattern D: Hardware-Aware Planning
```
get_runtime_ep_hints -> get_model_info
  -> plan_optimization(with hardware_probe)
  -> get_recipe_for_ui_state
  -> execute_and_observe(olive_recipe)
  -> done
```
Best for: Leveraging actual local hardware rather than guessing.

## Error Budget and Guardrails

- **Max retries:** 3 per optimization attempt
- **Timeout ceiling:** 1800 seconds (30 minutes) per job
- **Never auto-retry** when `diagnose_and_fix` returns `fix_confidence: "low"`
- **Always surface to user** after 3 failed attempts or if diagnosis suggests fundamental incompatibility
- **Job cleanup:** Failed jobs terminate on their own — no manual cancellation needed
- **Cost awareness:** Each `execute_and_observe` call consumes GPU time. Don't loop carelessly.

## Combining with Non-Loop Tools

The agent loop tools work alongside the catalog/strategy tools:

| Need | Tool |
|------|------|
| What passes exist for quantization? | `get_olive_passes` |
| Best method for my hardware? | `get_quantization_strategy` |
| Will this pass chain work? | `get_pass_chain` |
| Quality/perf tradeoff prediction? | `evaluate_optimization_tradeoff` |
| Generate a CLI command? | `get_cli_command` |

Use these to inform your `plan_optimization` intent — better intent produces better plans and fewer retries.
