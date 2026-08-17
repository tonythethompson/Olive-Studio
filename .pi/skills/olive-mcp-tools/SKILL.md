---
name: olive-mcp-tools
description: Use the Olive Studio MCP server tools to query the pass catalog, recommend quantization strategies, validate recipes, troubleshoot optimization errors, and manage optimization jobs. Call via the project's MCP stdio server (.mcp.json "olive") or the web proxy POST /api/mcp/tool.
---

# Olive MCP Tools

The Olive MCP server (`olive-mcp-server/`) is a Python FastMCP stdio server exposing ~32 tools: pass catalog queries, recipe validation, strategy advice, troubleshooting, semantic documentation search, and job lifecycle management. This skill is the pi mirror of `.kiro/powers/olive-mcp-tools/`.

## Connection

Two ways to reach the tools:

1. **MCP stdio server** (registered in `.mcp.json`):
   - `command: python`, `args: ["olive-mcp-server/run.py"]`
   - When the pi MCP client is active, tools are callable directly by name.
2. **Web proxy** (when the Studio Express server is running on loopback):
   - `POST /api/mcp/tool` with `{ "tool": "<name>", "arguments": { ... } }`
   - Loopback only — the server is bound to `127.0.0.1` by default.

## Prerequisites (one-time)

The Python venv must exist before the stdio server starts:

```bash
./scripts/setup-mcp.sh                 # Linux/macOS — creates venv, installs deps, rebuilds indexes
# or manual:
cd olive-mcp-server
python -m venv .venv
.venv/bin/pip install -e ".[dev]" "mcp<2"   # mcp MUST be pinned <2
```

Requires Python 3.10–3.13 (3.12/3.13 preferred; some deps don't support 3.14 yet).

## Tool Selection by Task

### "What passes/options exist?"
- `get_olive_passes` — list passes, optional filter by category (quantization, conversion, etc.)
- `get_pass_parameters` — deep-dive into a pass's config schema (types, defaults, constraints)
- `get_pass_config_template` — generate a starter config for a pass type
- `get_integration_recipe` — pre-built recipes for common model×hardware combos

### "What should I use for my model + hardware?"
- `get_model_info` — lookup model metadata (param count, architecture, VRAM estimate)
- `get_quantization_strategy` — recommend quant approach given model type + target HW
- `get_hardware_optimization_guide` — full pass-chain recommendation for an EP
- `get_model_compatibility` — check model × pass × hardware compatibility
- `get_runtime_ep_hints` — probe local hardware for available execution providers

### "Is my recipe valid?"
- `validate_ui_state_recipe` — validate a Studio UIState JSON against recipe rules
- `get_recipe_for_ui_state` — build the full Olive recipe JSON from a UIState
- `get_pass_chain` — validate pass ordering and compatibility
- `validate_optimization_job` — preflight check before submission

### "Run it" ⚠️ has side effects
- `plan_optimization` — convert natural-language intent into a recipe patch
- `submit_optimization_job` — submit a recipe for execution (starts real work)
- `execute_and_observe` — submit + poll until terminal state (one-shot)

### "Something went wrong"
- `troubleshoot_olive_error` / `diagnose_error` — match error against known patterns, return fix
- `diagnose_and_fix` — diagnose + auto-repair the recipe
- `get_error_frequency_summary` — which errors hit most often
- `record_troubleshoot_feedback` — thumbs-up/down to improve the KB

### "Compare and evaluate"
- `compare_results` — score multiple job results by preference (latency/size/accuracy)
- `evaluate_optimization_tradeoff` — predict quality vs performance for a pass sequence
- `get_optimization_results` — fetch metrics/logs/artifacts for a completed job

### "Manage jobs"
- `list_optimization_jobs` — recent jobs (newest first)
- `get_optimization_job` — status of a specific job
- `cancel_optimization_job` — cancel a running job

### "Documentation & reference"
- `search_olive_documentation` — semantic search across Olive docs (sentence-transformers embeddings; first call loads the model)
- `get_cli_command` — generate an Olive CLI command for a workflow
- `get_data_config_template` — data config templates for calibration/evaluation
- `get_mcp_capabilities` — server self-description (tool list, version, features)

## Quick Patterns

### Quantize an LLM for NVIDIA GPU
```
1. get_model_info("meta-llama/Llama-3-8B")
2. get_quantization_strategy(model_type="LLM", target_hardware="NVIDIA RTX 4090")
3. plan_optimization(intent="quantize Llama-3-8B to int4 for RTX 4090")
4. validate_optimization_job(recipe=...)
5. submit_optimization_job(recipe=...)      # side effects start here
```

### Troubleshoot a failed run
```
1. get_optimization_results(job_id="...")   → read error from logs
2. troubleshoot_olive_error(error_message="<paste full traceback>")
3. diagnose_and_fix(error_message="...", recipe={current recipe})
4. submit_optimization_job(recipe=fixed_recipe)
```

### Compare two quantization approaches
```
1. submit_optimization_job(recipe_a)  → job_id_a
2. submit_optimization_job(recipe_b)  → job_id_b
3. compare_results(job_ids=[job_id_a, job_id_b], preference="balanced")
```

## Constraints

- **No live Olive runs in tests/CI/agent sandbox** — recipe building, JSON export, and validation are CPU-only. Only call `submit_optimization_job` / `execute_and_observe` when the user explicitly asks to run an optimization (it downloads models + CUDA wheels).
- **Validate first** — always call `validate_optimization_job` before `submit_optimization_job`.
- **Loopback only** — Studio job/recipe tools require local access (Express bound to `127.0.0.1`).
- **`mcp` pin** — the server requires `mcp<2`; v2.x breaks FastMCP imports.

## Performance Notes

- The stdio server spawns per batch (~500ms startup) — batch multiple queries in one call rather than many round-trips.
- A circuit breaker protects against infra failures: 3 consecutive infra failures → 30s cooldown → half-open probe. Tool-level errors (bad args, no match) do NOT trip the breaker.
- Per-call timeout: 45s. Max output buffer: 8MB.
- `search_olive_documentation` first call loads embeddings; set `OLIVE_MCP_PRELOAD_EMBEDDINGS=1` to warm at start. Set `OLIVE_MCP_REBUILD_INDEX=1` (or `--rebuild-index`) to rebuild stale semantic indexes.

## Full Reference

For the complete tool reference, see `.kiro/powers/olive-mcp-tools/dev.kiro/steering/tool-reference.md` and the workflow guide `.kiro/steering/olive-mcp-workflow.md`.
