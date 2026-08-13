---
name: optimize
description: Plan and execute model optimization workflows. Use when configuring a new optimization pipeline, choosing quantization strategy, selecting passes for a target hardware, or submitting an optimization job.
---

# Plan & Execute Model Optimization

> **Studio prerequisite:** Steps 5-6 (validate, execute) require Olive Studio running with `OLIVE_STUDIO_API_URL` set; tools return `studio_unavailable` otherwise.

## Workflow

### 1. Understand the Model

Get model metadata to inform strategy:
```
get_model_info(model_id="meta-llama/Llama-3-8B")
```
Returns: param count, architecture, model type, VRAM estimate, recommended quant method.

### 2. Choose Strategy

Get hardware-aware recommendations:
```
get_quantization_strategy(
  model_type="LLM",
  target_hardware="NVIDIA RTX 4090",
  latency_budget="<100ms",
  accuracy_threshold="<2% drop"
)
```

Or get the full optimization pass chain for your hardware:
```
get_hardware_optimization_guide(
  target_hardware="NVIDIA RTX 4090",
  model_size="large",
  latency_goal="<100ms"
)
```

### 3. Check Compatibility

Verify model works with chosen passes/hardware:
```
get_model_compatibility(
  model_name="meta-llama/Llama-3-8B",
  framework="PyTorch",
  hardware_target="NVIDIA RTX 4090"
)
```

### 4. Plan the Recipe

Convert intent to a recipe configuration:
```
plan_optimization(intent="quantize Llama-3-8B to int4 AWQ for RTX 4090 with minimal accuracy loss")
```
Returns a UI state patch with reasoning and alternatives.

Or use pre-built recipes:
```
get_integration_recipe(model_type="LLM", target_hardware="nvidia")
```

### 5. Validate Before Submission

Check for issues:
```
validate_optimization_job(recipe={...})
```

Or validate from Studio UI state:
```
validate_ui_state_recipe(ui_state={...})
```

### 6. Execute

One-shot (submit + poll until done):
```
execute_and_observe(recipe={...}, timeout=600)
```

Or manual control:
```
submit_optimization_job(recipe={...})
get_optimization_job(job_id="...")
get_optimization_results(job_id="...")
```

### 7. Evaluate & Compare

Compare multiple approaches:
```
compare_results(job_ids=["job_a", "job_b"], preference="balanced")
```

Predict tradeoffs before running:
```
evaluate_optimization_tradeoff(passes=["OnnxConversion", "OnnxQuantization"], model="llama-7b")
```

## Quick Patterns

### LLM → INT4 for NVIDIA GPU
```
get_model_info → get_quantization_strategy → plan_optimization → validate → execute_and_observe
```

### Vision model → INT8 for CPU deployment
```
get_hardware_optimization_guide(target_hardware="Intel Core i9 CPU") → get_integration_recipe → validate → submit
```

### Compare AWQ vs GPTQ
```
plan recipe_a (AWQ) → submit → plan recipe_b (GPTQ) → submit → compare_results
```

## Pass Ordering Rules

- **Standard path** (PTQ/HQQ/RTN): conversion → transforms → quantization
- **PyTorch-native** (AWQ/GPTQ/SpinQuant): quantization → conversion → transforms
- PEFT (LoRA/QLoRA) always runs first
- Splitting always runs last (before validation)

## Important Constraints

- `submit_optimization_job` and `execute_and_observe` have **side effects** — they start real work
- Always `validate_optimization_job` first
- Jobs require a local Python venv with Olive + ONNX Runtime installed
- Large models need `use_external_data_format: true` for ONNX conversion
- Static quantization requires calibration data — use `get_data_config_template` to set it up
