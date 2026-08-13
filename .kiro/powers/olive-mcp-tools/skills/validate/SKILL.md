---
name: validate
description: Validate Olive recipe configurations for correctness, compatibility, and pass ordering. Use when checking a recipe before submission, diagnosing validation errors, or verifying pass chain compatibility.
---

# Validate Olive Recipes

> **Studio prerequisite:** `validate_ui_state_recipe`, `get_recipe_for_ui_state`, `validate_optimization_job`, and `get_runtime_ep_hints` require Olive Studio running with `OLIVE_STUDIO_API_URL` set; tools return `studio_unavailable` otherwise.

## Workflow

### Quick Validation

Validate the current Studio UI state:
```
validate_ui_state_recipe(ui_state={...})
```
Returns: effective state, schema/pipeline/runtime issues, advisories, and `is_runnable`.

### Full Recipe Generation + Validation

Build and validate a recipe from UI state:
```
get_recipe_for_ui_state(ui_state={...})
```
Returns: the recipe JSON + validation results + conversion warnings.

### Pre-submission Check

Validate a complete recipe before submitting:
```
validate_optimization_job(recipe={...})
```
Returns: validation status, fingerprint, errors, warnings.

### Pass Chain Validation

Verify pass ordering and format compatibility:
```
get_pass_chain(pass_names=["OnnxConversion", "OrtTransformersOptimization", "OnnxQuantization"])
```
Returns: validation result, explanation, reordering suggestions.

## Cross-Pass Compatibility Rules

These combinations are **invalid** — the validator will flag them:

| Combination | Issue | Resolution |
|------------|-------|------------|
| ONNX quant/transforms without conversion | No ONNX graph exists | Enable conversion first |
| LoRA + INT4/INT8 quantization | LoRA needs float base params | Switch to QLoRA |
| Pruning + INT4 | Double compression destroys accuracy | Use INT8 instead |
| OpenVINO format + ONNX transforms | Redundant/conflicting | Disable transforms |
| Model splitting + QAT | QAT needs unbroken weights | Disable splitting |
| QLoRA on CPU | Needs GPU CUDA kernels | Switch to LoRA or use GPU |
| OpenVINO format + non-OpenVINO EP | Runtime will fail | Fix EP or format |
| QairtPipeline without QNN EP | QAIRT is QNN-only | Use QNN EP or disable |
| MobiusBuilder + QNN EP | MobiusBuilder targets CPU/CUDA | Disable MobiusBuilder |

## Provider-Hardware Validation

Check if execution provider is available on the machine:
```
get_runtime_ep_hints(refresh=true)
```
Returns detected accelerators, available EPs, and recommendations.

Check model compatibility with target hardware:
```
get_model_compatibility(model_name="...", framework="PyTorch", hardware_target="...")
```

## Pass Ordering

The validator enforces correct ordering:

**Standard ONNX path:**
```
peft → pruning → conversion → transformer_opt → quantization → splitting
```

**PyTorch-native quant (AWQ/GPTQ/SpinQuant/QuaRot):**
```
peft → pruning → quantization → conversion → transformer_opt → splitting
```

Use `get_pass_chain` to verify your ordering is correct.

## Validation Issue Severities

| Severity | Meaning | Action |
|----------|---------|--------|
| `critical` | Recipe will fail at runtime | Must fix before submission |
| `warning` | May produce suboptimal results | Review and decide |
| `info` | Advisory / best practice | Optional improvement |

## Tips

- Run `validate_ui_state_recipe` after any configuration change
- Critical issues block `is_runnable` — fix them before submitting
- Some rules auto-coerce silently (e.g., LoRA→QLoRA when INT quant is active)
- `get_pass_chain` also suggests reordering when your chain is out of order
- The validator checks both logical compatibility AND hardware availability
