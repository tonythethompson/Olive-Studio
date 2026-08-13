---
inclusion: manual
---

# Olive Troubleshooting Guide

Patterns for diagnosing and resolving common Olive optimization failures using the MCP tools.

## Troubleshooting Flow

```
Error occurs → get_optimization_results (read logs)
            → troubleshoot_olive_error (match known pattern)
            → diagnose_and_fix (get patched recipe)
            → re-submit
```

## MCP Tools for Troubleshooting

| Tool                           | When to Use                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| `troubleshoot_olive_error`     | Paste an error message/traceback — matches against the knowledge base of known Olive issues |
| `diagnose_error`               | Same as above (alias)                                                                       |
| `diagnose_and_fix`             | Provide error + current recipe → returns diagnosis + repaired recipe                        |
| `get_error_frequency_summary`  | See which errors are most common (helps prioritize)                                         |
| `get_optimization_results`     | Fetch logs/metrics from a job to find the actual error                                      |
| `record_troubleshoot_feedback` | Report whether the suggestion helped (improves future results)                              |

## Common Failure Categories

### 1. Missing Conversion

**Symptom:** "Expected ONNX model but got PyTorch"
**Cause:** Quantization or graph transforms enabled without ONNX conversion
**Fix:** Enable conversion pass with `conversionFormat: "onnx"`
**MCP:** `diagnose_and_fix` will automatically add conversion

### 2. Out of Memory (OOM)

**Symptom:** CUDA OOM, "RuntimeError: CUDA out of memory"
**Cause:** Model too large for GPU VRAM during calibration or quantization
**Fixes:**

- Reduce `calibration_sampling_size`
- Enable memory offload (`load_kwargs: { device_map: "auto" }`)
- Use a smaller calibration batch
- Switch to a quant method without calibration (HQQ, RTN)
**MCP:** `get_quantization_strategy` with your VRAM budget

### 3. Provider Mismatch

**Symptom:** "Execution provider not available", op not supported
**Cause:** Recipe targets a provider that isn't installed or doesn't support the model's ops
**Fix:** Match provider to installed hardware or add fallback EP
**MCP:** `get_runtime_ep_hints` to probe what's actually available

### 4. External Data Format Required

**Symptom:** "Model is larger than 2GB"
**Cause:** ONNX proto has a 2GB limit per file
**Fix:** Set `use_external_data_format: true` in conversion config

### 5. Incompatible Quant Method + Provider

**Symptom:** AWQ/GPTQ fails on CPU, SpinQuant fails without CUDA
**Cause:** PyTorch-native quantizers require GPU
**Fix:** Switch to HQQ/RTN (CPU-compatible) or use CUDA provider
**MCP:** `get_quantization_strategy(target_hardware="CPU")` for CPU-friendly options

### 6. QNN/QAIRT Pipeline Failures

**Symptom:** QairtPipeline errors, "QNN context not found"
**Cause:** QNN SDK not installed or wrong EP selected
**Fix:** Ensure QNNExecutionProvider + QNN SDK, or disable QAIRT passes
**MCP:** `get_hardware_optimization_guide(target_hardware="Qualcomm Snapdragon NPU")`

### 7. Trust Remote Code

**Symptom:** "Loading ... requires trust_remote_code=True"
**Cause:** HuggingFace model needs custom code execution
**Fix:** Set `trust_remote_code: true` in input model config

### 8. Calibration Data Missing

**Symptom:** "calibration_data_dir is required for static quantization"
**Cause:** Static PTQ needs representative data samples
**Fix:** Provide calibration dataset path or switch to dynamic quant
**MCP:** `get_data_config_template(data_source="huggingface", task="calibration")`

## Diagnostic Strategy

### For unknown errors

1. `troubleshoot_olive_error(error_message="<full traceback>")` — checks KB
2. If no match: `search_olive_documentation(query="<key phrases from error>")`
3. If still stuck: `diagnose_and_fix(error_message="...", recipe={...})` — AI-assisted repair

### For slow/suboptimal results

1. `get_optimization_results(job_id="...")` — check actual metrics
2. `evaluate_optimization_tradeoff(passes=[...], model="...")` — predict alternatives
3. `compare_results(job_ids=[...], preference="latency")` — rank approaches

### For hardware-specific issues

1. `get_runtime_ep_hints(refresh=true)` — what's actually installed
2. `get_hardware_optimization_guide(target_hardware="...")` — recommended path
3. `get_model_compatibility(model_name="...", framework="...", hardware_target="...")`

## Knowledge Base Contents

The troubleshooting KB (`olive-mcp-server/olive_mcp_server/knowledge_base/`) contains:

- **troubleshooting.json** — Error patterns with regex matching, root causes, and fixes
- **studio_troubleshooting.json** — Studio-specific UI/bridge errors
- **passes.json** — 92 pass definitions with gotchas for each
- **hardware_profiles.json** — 22 hardware profiles with known issues
- **compatibility_matrix.json** — Model × hardware × pass support matrix
- **quirks.json** — Edge cases for specific configurations

The `troubleshoot_olive_error` tool searches these using keyword + semantic matching (embeddings in `knowledge_base/indexes/`).
