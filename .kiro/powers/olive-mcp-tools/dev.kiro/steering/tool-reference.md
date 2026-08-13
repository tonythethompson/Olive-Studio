# Olive MCP Tool Reference

## Overview

The Olive MCP server is a Python FastMCP server exposing 32 tools for pass catalog queries, recipe validation, strategy advice, troubleshooting, documentation search, and job lifecycle management.

## Prerequisites

```bash
cd olive-mcp-server
python -m venv .venv
# Windows:
.venv\Scripts\pip install -e ".[dev]" "mcp<2"
# Linux/macOS:
.venv/bin/pip install -e ".[dev]" "mcp<2"
```

The `mcp` package MUST be pinned `<2` — version 2.x breaks imports.

## Tool Catalog

### Pass Catalog & Configuration

| Tool | Description |
|------|-------------|
| `get_olive_passes` | List 92 optimization passes, filter by type/hardware/format |
| `get_pass_config_template` | Generate a pass configuration JSON template |
| `get_pass_parameters` | Detailed parameter documentation (types, defaults, constraints) |
| `get_pass_chain` | Validate and suggest ordered pass pipelines |
| `get_data_config_template` | Data configuration templates for calibration/evaluation |
| `get_context_for_pipeline` | Passive context retrieval for pipeline decisions |

### Strategy & Recommendations

| Tool | Description |
|------|-------------|
| `get_quantization_strategy` | Recommend quantization approach for model + hardware + accuracy |
| `get_hardware_optimization_guide` | Hardware-specific optimization pass chain and EP guidance |
| `evaluate_optimization_tradeoff` | Compare quality vs performance for a pass sequence |
| `get_runtime_ep_hints` | Probe local hardware for available execution providers |

### Troubleshooting & Diagnostics

| Tool | Description |
|------|-------------|
| `troubleshoot_olive_error` | Diagnose Olive errors against KB (regex + semantic match) |
| `diagnose_error` | Alias for troubleshoot_olive_error |
| `get_error_frequency_summary` | Error pattern frequency stats |
| `record_troubleshoot_feedback` | Thumbs-up/down on diagnosis quality |

### Compatibility & Validation

| Tool | Description |
|------|-------------|
| `get_model_compatibility` | Check model x pass x hardware compatibility |
| `get_integration_recipe` | Pre-built end-to-end integration recipes |
| `validate_ui_state_recipe` | Validate Studio UIState against recipe rules |
| `get_recipe_for_ui_state` | Generate full Olive recipe JSON from UIState |

### Documentation & Reference

| Tool | Description |
|------|-------------|
| `search_olive_documentation` | Semantic search across Olive documentation |
| `get_cli_command` | Generate Olive CLI commands |
| `get_mcp_capabilities` | Server self-description (version, features, tool list) |

### Job Lifecycle (Studio Integration)

| Tool | Description |
|------|-------------|
| `list_optimization_jobs` | List recent jobs (newest first) |
| `get_optimization_job` | Get status of a specific job |
| `get_optimization_results` | Fetch metrics/logs/artifacts from a completed job |
| `validate_optimization_job` | Pre-validate before submission |
| `submit_optimization_job` | Submit a new optimization job |
| `cancel_optimization_job` | Cancel a running job |

### Agent Autonomous Loop (Phase 3)

| Tool | Description |
|------|-------------|
| `plan_optimization` | Convert natural-language intent into a recipe patch |
| `execute_and_observe` | Submit + poll until terminal state (one-shot) |
| `diagnose_and_fix` | Diagnose error + return repaired recipe |
| `compare_results` | Score multiple job results by preference |
| `get_model_info` | Look up model metadata (params, architecture, VRAM) |

## Performance Notes

- MCP server spawns as subprocess (~500ms startup). Batch queries when possible.
- Circuit breaker: 3 consecutive infra failures → 30s cooldown → half-open probe.
- Tool-level errors (bad arguments) do NOT trip the breaker — only infra failures.
- Timeout per call: 45 seconds. Max output buffer: 8MB.
- `search_olive_documentation` uses sentence-transformer embeddings. First call may be slow (model load). Set `OLIVE_MCP_PRELOAD_EMBEDDINGS=1` to warm at start.
