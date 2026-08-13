---
inclusion: manual
---

# Olive MCP — Optimization & Troubleshooting Workflow

Guide for using Olive MCP tools to configure, validate, and run model optimization recipes in Olive Studio.

## Typical Workflow

1. **Discover** — Identify what's available for your model and hardware
2. **Plan** — Choose strategy (quantization method, pass chain, target hardware)
3. **Validate** — Check recipe for compatibility issues before running
4. **Execute** — Submit the optimization job
5. **Observe** — Review results (metrics, logs, artifacts)
6. **Iterate** — Diagnose failures, compare runs, refine

## Tool Selection by Task

### "What passes/options exist?"

- `get_olive_passes` — List passes, optionally filter by category (quantization, conversion, etc.)
- `get_pass_parameters` — Deep-dive into a specific pass's config schema
- `get_pass_config_template` — Generate a starter config for a pass
- `get_integration_recipe` — Get pre-built recipes for common model×hardware combos

### "What should I use for my model + hardware?"

- `get_quantization_strategy` — Recommends quant approach given model type + target HW
- `get_hardware_optimization_guide` — Full pass chain recommendation for a hardware target
- `get_model_compatibility` — Check if a model works with specific passes/hardware
- `get_model_info` — Lookup model metadata (param count, architecture, VRAM estimate)
- `get_runtime_ep_hints` — Probe local hardware for available execution providers

### "Is my recipe valid?"

- `validate_ui_state_recipe` — Validate current Studio UI state for issues
- `get_recipe_for_ui_state` — Build the full recipe JSON from UI state
- `get_pass_chain` — Validate pass ordering and compatibility
- `validate_optimization_job` — Preflight check before submission

### "Run it"

- `plan_optimization` — Convert natural-language intent into a recipe patch
- `submit_optimization_job` — Submit recipe to Studio for execution
- `execute_and_observe` — Submit + poll until terminal state (one-shot)

### "Something went wrong"

- `troubleshoot_olive_error` — Match error against known patterns, get fix
- `diagnose_error` — Alias for troubleshoot (same KB)
- `diagnose_and_fix` — Diagnose + auto-repair the recipe
- `get_error_frequency_summary` — See which errors hit most often

### "Compare and evaluate"

- `compare_results` — Score multiple job results by preference (latency/size/accuracy)
- `evaluate_optimization_tradeoff` — Predict quality vs performance for a pass sequence
- `get_optimization_results` — Fetch metrics/logs/artifacts for a completed job

### "Manage jobs"

- `list_optimization_jobs` — List recent jobs (newest first)
- `get_optimization_job` — Get status of a specific job
- `cancel_optimization_job` — Cancel a running job

## Quick Patterns

### Quantize an LLM for NVIDIA GPU

```
1. get_model_info("meta-llama/Llama-3-8B")
2. get_quantization_strategy(model_type="LLM", target_hardware="NVIDIA RTX 4090")
3. plan_optimization(intent="quantize Llama-3-8B to int4 for RTX 4090")
4. validate_optimization_job(recipe=...)
5. submit_optimization_job(recipe=...)
```

### Troubleshoot a failed run

```
1. get_optimization_results(job_id="...")   → read error from logs
2. troubleshoot_olive_error(error_message="<paste traceback>")
3. diagnose_and_fix(error_message="...", recipe={current recipe})
4. submit_optimization_job(recipe=fixed_recipe)
```

### Compare two quantization approaches

```
1. submit_optimization_job(recipe_a)  → job_id_a
2. submit_optimization_job(recipe_b)  → job_id_b
3. compare_results(job_ids=[job_id_a, job_id_b], preference="balanced")
```

## Important Constraints

- **No live Olive runs in tests/CI** — recipe building and validation are CPU-only; actual optimization downloads models + CUDA wheels.
- **Job submission has side effects** — `submit_optimization_job` and `execute_and_observe` start real work. Validate first.
- **Loopback only** — Studio job/recipe tools require local access (the Express server is bound to 127.0.0.1).
- **`mcp` package pin** — If running the MCP server directly, pin `mcp<2` (v2.x breaks FastMCP imports).
