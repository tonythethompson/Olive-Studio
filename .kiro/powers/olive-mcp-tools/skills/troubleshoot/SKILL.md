---
name: troubleshoot
description: Diagnose and resolve Olive optimization failures. Use when a job fails, an error traceback appears, or the user wants to understand why an optimization did not succeed.
---

# Troubleshoot Olive Optimization Errors

> **Studio prerequisite:** Steps 1 and 5 require Olive Studio running with `OLIVE_STUDIO_API_URL` set; tools return `studio_unavailable` otherwise.

## Workflow

1. **Get the error** — If a job failed, fetch the logs:
   ```
   get_optimization_results(job_id="<job_id>")
   ```
   Extract the error message or traceback from the log output.

2. **Match against knowledge base** — Search for known patterns:
   ```
   troubleshoot_olive_error(error_message="<full traceback>")
   ```
   This matches against regex patterns and semantic embeddings in the KB.

3. **If no KB match** — Search documentation:
   ```
   search_olive_documentation(query="<key phrases from error>")
   ```

4. **Auto-repair the recipe** — Provide both error and current recipe:
   ```
   diagnose_and_fix(error_message="<error>", recipe={...current recipe...})
   ```
   Returns a diagnosis + patched recipe ready to re-submit.

5. **Re-submit** — If the fix looks correct:
   ```
   submit_optimization_job(recipe=<fixed_recipe>)
   ```

6. **Give feedback** — Help improve future diagnoses:
   ```
   record_troubleshoot_feedback(matched_entry="<entry_id>", rating="thumbs-up")
   ```

## Common Error Categories

### Missing ONNX Conversion
- **Pattern:** "Expected ONNX model but got PyTorch"
- **Fix:** Enable conversion pass (`conversion: true, conversionFormat: "onnx"`)

### Out of Memory (OOM)
- **Pattern:** "CUDA out of memory", "RuntimeError: CUDA out of memory"
- **Fixes:** Reduce `calibration_sampling_size`, enable memory offload, switch to HQQ/RTN (no calibration)

### Provider Mismatch
- **Pattern:** "Execution provider not available"
- **Diagnose:** `get_runtime_ep_hints(refresh=true)` to see what's installed
- **Fix:** Match provider to hardware or add fallback EP

### External Data Format
- **Pattern:** "Model is larger than 2GB"
- **Fix:** Set `use_external_data_format: true` in conversion config

### GPU-Only Quantizer on CPU
- **Pattern:** AWQ/GPTQ/SpinQuant fails on CPUExecutionProvider
- **Fix:** Switch to HQQ or RTN (CPU-compatible) or change to CUDA EP

### Trust Remote Code
- **Pattern:** "requires trust_remote_code=True"
- **Fix:** Set `trust_remote_code: true` in input model config

### Missing Calibration Data
- **Pattern:** "calibration_data_dir is required"
- **Fix:** Provide dataset path or switch to dynamic quantization
- **Template:** `get_data_config_template(data_source="huggingface", task="calibration")`

## Tips

- Always include the **full traceback** — the KB matches on stack frame patterns
- For hardware-specific issues, start with `get_runtime_ep_hints` to verify the environment
- `get_error_frequency_summary` shows which errors are most common across the KB
- The `diagnose_and_fix` tool is the most powerful single-call option — it combines diagnosis with recipe repair
