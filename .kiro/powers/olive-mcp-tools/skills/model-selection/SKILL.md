---
name: model-selection
description: Check model compatibility, detect frameworks, estimate VRAM, and choose the right optimization path. Use when starting from scratch with a model, checking if a model can be optimized, or deciding between optimization approaches.
---

# Model Selection & Compatibility

This skill helps determine whether a model is compatible with Olive optimization, what framework it uses, how much resources it needs, and which optimization path to take.

## Key Tools

| Tool | Purpose |
|------|---------|
| `get_model_info` | Look up model metadata from HuggingFace |
| `get_model_compatibility` | Check model x framework x hardware compatibility |
| `get_quantization_strategy` | Get recommended quantization for model + hardware |
| `get_olive_passes` | See what passes apply to a model type |
| `get_integration_recipe` | Find pre-built recipes for common models |

## Step 1: Identify the Model

```
Tool: get_model_info
Input: { "model_id": "meta-llama/Llama-3-8B" }
```

Returns:
- `params_b` — Total parameters (e.g., 8B)
- `architecture` — Model architecture (e.g., LlamaForCausalLM)
- `model_type` — Classification: LLM, CNN, Vision, Audio, Multimodal
- `estimated_vram_gb` — Approximate VRAM needed at various precisions
- `recommended_quant` — Suggested quant method based on architecture

## Step 2: Check Compatibility

```
Tool: get_model_compatibility
Input: {
  "model_name": "meta-llama/Llama-3-8B",
  "framework": "PyTorch",
  "hardware_target": "NVIDIA RTX 4090"  // optional
}
```

Returns:
- Supported passes for this model + framework combination
- Hardware-specific compatibility details (if hardware specified)
- Warnings about known limitations
- Suggested workflow (conversion path, recommended passes)

## Framework Detection

Models come in different source formats. The framework determines the conversion path:

| Source | Detection Signal | Conversion Needed |
|--------|-----------------|-------------------|
| **PyTorch** (.pt, .pth, .bin) | `torch.load()` compatible, `config.json` | Yes — OnnxConversion |
| **HuggingFace** (safetensors) | `model.safetensors`, `tokenizer.json` | Yes — OnnxConversion (via transformers) |
| **ONNX** (.onnx) | `model.onnx`, opset version in metadata | No — already ONNX |
| **TensorFlow** (.pb, SavedModel) | `saved_model.pb`, `keras_metadata.pb` | Yes — TF2OnnxConversion |
| **OpenVINO** (.xml + .bin) | IR format, opset in XML | Convert via MO or use directly |

### Framework choice in tools:
- Use `"PyTorch"` for `.pt`/`.pth`/`.bin` weights
- Use `"HuggingFace"` for safetensors + `config.json` from the Hub
- Use `"ONNX"` for pre-converted `.onnx` files
- Use `"tf"` for TensorFlow SavedModel or frozen graphs

## Model Type Classification

The MCP server classifies models into types that determine applicable passes:

| Type | Examples | Key Passes |
|------|----------|-----------|
| **LLM** | Llama, Mistral, Phi, GPT-NeoX, Falcon | AWQ, GPTQ, HQQ, RTN, SpinQuant, OrtTransformersOptimization |
| **CNN** | ResNet, EfficientNet, MobileNet, YOLO | OnnxQuantization (PTQ), OrtTransformersOptimization |
| **Vision** | ViT, CLIP, DINOv2, Segment Anything | OnnxQuantization, Mixed precision |
| **Audio** | Whisper, Wav2Vec2, HuBERT | OnnxQuantization, OrtTransformersOptimization |
| **Multimodal** | LLaVA, InternVL, Florence-2 | Hybrid — vision encoder + LLM decoder need different strategies |

### Model type affects:
- Which quantization methods are available
- Calibration data format (text vs images vs audio)
- Sequence length / input shape configuration
- Applicable graph optimizations

## VRAM Estimation

### Quick estimation formula:
```
VRAM (GB) = Parameters (B) x Bytes per Parameter + Overhead
```

| Precision | Bytes/Param | 7B Model | 13B Model | 70B Model |
|-----------|-------------|----------|-----------|-----------|
| FP32 | 4 | 28 GB | 52 GB | 280 GB |
| FP16/BF16 | 2 | 14 GB | 26 GB | 140 GB |
| INT8 | 1 | 7 GB | 13 GB | 70 GB |
| INT4 | 0.5 | 3.5 GB | 6.5 GB | 35 GB |

**Overhead factors** (add to base):
- KV cache (LLMs): +1-4 GB depending on context length and batch size
- Activation memory: +10-20% of model size during inference
- Framework overhead: +0.5-1 GB (CUDA context, ORT session)

### Will my model fit?

Limits below include runtime overhead (activations, KV cache, ORT/CUDA). They are
smaller than a weights-only estimate so an 8 GB card is not assigned a 14B INT4 model.

| GPU VRAM | Max Model (INT4) | Max Model (INT8) | Max Model (FP16) |
|----------|------------------|------------------|-------------------|
| 8 GB | ~7B | ~3B | ~1.5B |
| 12 GB | ~13B | ~7B | ~3B |
| 16 GB | ~20B | ~10B | ~5B |
| 24 GB | ~32B | ~16B | ~8B |
| 48 GB | ~70B | ~35B | ~18B |
| 80 GB | ~120B | ~60B | ~30B |

## Decision Tree: Which Optimization Path?

```
Is the model already ONNX?
  YES --> Skip conversion, go to quantization
  NO  --> What framework?
            PyTorch/HF --> OnnxConversion (+ use_external_data_format for >2GB)
            TensorFlow --> TF2OnnxConversion
            
What's the deployment target?
  NVIDIA GPU --> CUDA or TensorRT EP
    - LLM: AWQ or GPTQ (best quality) or HQQ (fastest calibration)
    - CNN/Vision: PTQ INT8 (simple, good results)
    
  Intel CPU/GPU/NPU --> OpenVINO EP
    - All: OnnxQuantization with ONNX opset 17+
    - NPU: INT8 only, batch 1
    
  CPU only --> CPUExecutionProvider
    - LLM: HQQ or RTN INT4 (data-free). GPTQ is GPU-only and will fail validation on CPU.
    - CNN/Vision: PTQ INT8 with MinMax calibration
    
  Qualcomm NPU --> QNN EP
    - Requires QNN SDK, specific quantization flow
    
  Browser (WebGPU) --> WebGpuExecutionProvider
    - INT4 via MatMulNBits, limited model size
```

## Pre-Built Recipes

Before building a custom pipeline, check if a recipe already exists:

```
Tool: get_integration_recipe
Input: {
  "model_type": "LLM",
  "target_hardware": "nvidia",
  "source_format": "HuggingFace"
}
```

Returns matching recipes with full pass configurations, expected outcomes, and prerequisites.

## Common Compatibility Issues

### "Model too large for single GPU"
- Use INT4 quantization to reduce VRAM 4x
- For calibration: reduce `num_samples` and `batch_size` to 1
- Consider `use_external_data_format: true` for >2GB ONNX models

### "Unsupported architecture"
- Not all model architectures have optimized ORT kernels
- Check `get_model_compatibility` for specific warnings
- Custom/novel architectures may only support basic OnnxConversion + PTQ

### "Conversion fails with dynamic axes"
- LLMs need explicit dynamic axis configuration for sequence length
- Vision models need dynamic batch dimension
- Set `use_dynamo_exporter: true` for PyTorch 2.x models with complex control flow

### "Quantization produces poor quality"
- Try a different method (AWQ generally beats RTN for LLMs)
- Increase calibration samples (256 → 512)
- Use mixed-precision: keep sensitive layers at higher precision
- Check if the model architecture is known to be quantization-sensitive

### "Pass not supported for this model type"
- AWQ/GPTQ/SpinQuant/QuaRot are LLM-specific (decoder-only transformers)
- OnnxQuantization (PTQ) works for all model types
- Graph optimizations (OrtTransformersOptimization) need supported attention patterns

## Workflow Summary

1. **Identify:** `get_model_info` — what is this model?
2. **Check:** `get_model_compatibility` — can it be optimized for my target?
3. **Find recipe:** `get_integration_recipe` — does a pre-built path exist?
4. **If no recipe:** `get_quantization_strategy` — what's recommended?
5. **Configure:** `get_pass_config_template` / `get_data_config_template` — build the config
6. **Validate:** `get_pass_chain` — is my pipeline valid?
7. **Execute:** `plan_optimization` → `execute_and_observe` — run it
