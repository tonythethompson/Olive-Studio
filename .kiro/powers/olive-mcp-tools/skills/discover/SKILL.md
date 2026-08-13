---
name: discover
description: Explore available Olive optimization passes, parameters, hardware profiles, and integration recipes. Use when learning what's available, comparing options, or looking up pass configuration details.
---

# Discover Olive Passes & Capabilities

## Browse the Pass Catalog

List all available passes:
```
get_olive_passes()
```

Filter by category:
```
get_olive_passes(filter="quantization")
```
Categories: `quantization`, `conversion`, `graph_optimization`, `pruning`, `finetuning`, `distillation`, `performance_tuning`

## Inspect Pass Details

Get full parameter schema for a pass:
```
get_pass_parameters(pass_name="OnnxQuantization")
```
Returns: every parameter with type, default, valid range, and interactions.

Get a specific parameter's docs:
```
get_pass_parameters(pass_name="OnnxQuantization", parameter_name="calibrate_method")
```

## Generate Configuration Templates

Get a starter config for a pass:
```
get_pass_config_template(
  pass_name="OnnxQuantization",
  framework="onnx",
  optimization_target="balanced"
)
```
Targets: `quality`, `latency`, `balanced`

## Pre-Built Integration Recipes

Browse all recipes:
```
get_integration_recipe()
```

Filter by model type or hardware:
```
get_integration_recipe(model_type="LLM", target_hardware="nvidia")
```

Get a specific recipe:
```
get_integration_recipe(recipe_id="resnet50_cpu_ptq")
```

## Hardware Profiles

Get optimization guidance for your hardware:
```
get_hardware_optimization_guide(
  target_hardware="NVIDIA RTX 4090",
  model_size="large"
)
```
Returns: recommended pass chain, EP, expected speedup, calibration settings.

## Model Information

Look up model metadata:
```
get_model_info(model_id="meta-llama/Llama-3-8B")
```
Returns: param count, architecture, type classification, VRAM estimate, recommended quant method.

## Documentation Search

Search Olive docs with natural language:
```
search_olive_documentation(query="how to calibrate static quantization")
```
Uses semantic embeddings for relevance ranking, with automatic keyword fallback when the embedding model is unavailable. Set `OLIVE_MCP_PRELOAD_EMBEDDINGS=1` to warm the model at server startup and avoid first-call latency.

## CLI Command Generation

Generate Olive CLI commands:
```
get_cli_command(
  optimization_goal="quantize",
  model="meta-llama/Llama-3-8B",
  target="gpu"
)
```
Goals: `quantize`, `finetune`, `optimize`, `auto-opt`, `onnx-graph-capture`, `generate-adapter`

## Knowledge Base Contents

The MCP server's KB includes:

| File | Content |
|------|---------|
| `passes.json` | 92 pass definitions with params, formats, gotchas |
| `hardware_profiles.json` | 22 hardware profiles with recommended passes |
| `compatibility_matrix.json` | Model x hardware x pass support |
| `integration_recipes.json` | Pre-built end-to-end recipes |
| `troubleshooting.json` | Error patterns with fixes |

## Tips

- Start with `get_olive_passes(filter=...)` to narrow the field
- Use `get_quantization_strategy` for recommendations rather than browsing all options
- `get_integration_recipe` is the fastest path if your model/hardware combo exists
- `get_pass_chain` validates that your chosen passes work together in order
