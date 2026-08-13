---
inclusion: manual
---

# Olive Recipe Reference

Quick reference for recipe structure, pass ordering, quantization methods, and cross-pass compatibility when working with Olive optimization recipes.

## Recipe JSON Structure

```json
{
  "input_model": {
    "type": "HfModel",
    "config": {
      "model_path": "meta-llama/Llama-3-8B",
      "task": "text-generation",
      "trust_remote_code": false
    }
  },
  "systems": {
    "local_system": {
      "type": "LocalSystem",
      "config": { "accelerators": ["gpu"] }
    }
  },
  "passes": {
    "conversion": { "type": "OnnxConversion", "config": { ... } },
    "quantization": { "type": "OnnxQuantization", "config": { ... } }
  },
  "engine": {
    "search_strategy": false,
    "host": "local_system",
    "target": "local_system",
    "output_dir": "./models/optimized"
  }
}
```

## Model Input Types

| Source      | `type`         | Key Config                    |
| ----------- | -------------- | ----------------------------- |
| HuggingFace | `HfModel`      | `model_path` (HF ID), `task`  |
| Local file  | `PyTorchModel` | `model_path`, `local_files`   |
| Azure       | `PyTorchModel` | `model_path` (azureml:// URI) |

## Pass Ordering

Passes execute in a fixed pipeline order (no search strategy). Order depends on whether the quantization method is PyTorch-native.

**Standard ONNX path** (PTQ, HQQ, RTN, QAT, KQuant):

```
peft → pruning → conversion → transformer_opt → quantization → splitting
```

**PyTorch-native quant** (AWQ, GPTQ, SpinQuant, QuaRot):

```
peft → pruning → quantization → conversion → transformer_opt → splitting
```

Key insight: PyTorch-native quantizers operate on torch models, so they must run *before* ONNX conversion.

## Quantization Methods

| Method    | Requires    | Best For                                          |
| --------- | ----------- | ------------------------------------------------- |
| AWQ       | GPU         | LLMs, activation-aware weight quantization        |
| GPTQ      | GPU         | LLMs, post-training with calibration data         |
| QAT       | GPU         | Fine-tuning with quantization-aware training      |
| HQQ       | CPU or CUDA | Half-quadratic quantization (no calibration data) |
| RTN       | CPU or CUDA | Round-to-nearest (fastest, lower quality)         |
| KQuant    | CPU or CUDA | K-means quantization                              |
| SpinQuant | GPU         | Rotation-based quant (Meta)                       |
| QuaRot    | GPU         | Rotation-based quant                              |

### Provider-Specific Quantization

When a method isn't explicitly selected, the system dispatches based on target format:

| Target         | Pass Type                                                          |
| -------------- | ------------------------------------------------------------------ |
| ONNX (default) | `OnnxQuantization` (static PTQ)                                    |
| OpenVINO       | `OpenVINOWeightCompression` (int4) / `OpenVINOQuantization` (int8) |
| QNN            | `QNNQuantization`                                                  |
| TensorRT       | `Nvfp4Quantizer` (int4) / `OnnxQuantization` (int8)                |

## Execution Providers (Target Hardware)

| Provider                    | Hardware                |
| --------------------------- | ----------------------- |
| `CPUExecutionProvider`      | Any CPU                 |
| `CUDAExecutionProvider`     | NVIDIA GPU              |
| `TensorrtExecutionProvider` | NVIDIA GPU (TensorRT)   |
| `OpenVINOExecutionProvider` | Intel CPU/GPU/NPU       |
| `QNNExecutionProvider`      | Qualcomm Snapdragon NPU |
| `QnnAbiExecutionProvider`   | Qualcomm (ABI variant)  |
| `CoreMLExecutionProvider`   | Apple Silicon           |
| `DirectMLExecutionProvider` | Windows GPU (generic)   |
| `ROCMExecutionProvider`     | AMD GPU                 |
| `WebGpuExecutionProvider`   | Browser WebGPU          |

## Cross-Pass Compatibility Rules

These combinations are **invalid** and will produce validation errors:

| Combination                                      | Issue                                | Auto-Fixed?                 |
| ------------------------------------------------ | ------------------------------------ | --------------------------- |
| ONNX quant/transforms without conversion enabled | No ONNX graph to operate on          | No — user must enable       |
| LoRA + INT4/INT8 quantization                    | Must use QLoRA for quantized base    | Yes → QLoRA                 |
| Pruning + INT4 quantization                      | Double compression destroys accuracy | Yes → INT8                  |
| OpenVINO format + ONNX transforms                | Transforms are redundant/conflicting | Yes → disable transforms    |
| Model splitting + QAT                            | QAT needs unbroken weight dict       | Yes → disable splitting     |
| QLoRA on CPU provider                            | GPU CUDA kernels required            | No — user decides           |
| OpenVINO format + non-OpenVINO EP                | Will fail at runtime                 | No — user must fix          |
| QairtPipeline + OnnxDiscrepancyCheck             | QAIRT doesn't produce ONNX           | Yes → disable check         |
| QairtPipeline without QNN EP                     | QAIRT is QNN-only                    | Yes → disable QAIRT         |
| MobiusBuilder + QNN EP                           | MobiusBuilder targets CPU/CUDA only  | Yes → disable MobiusBuilder |

"Auto-Fixed" means the system silently corrects it. Otherwise the user is shown a warning/error with a fix button.

## Calibration Data

Static quantization methods (OnnxQuantization, OpenVINOQuantization, QNNQuantization) require calibration data:

- Set `calibration_data_dir` or use a HuggingFace dataset
- `calibration_sampling_size` controls how many samples (default varies by method)
- `calibrate_method` options: MinMax (default), Entropy, Percentile

## Common Gotchas

- Models >2GB require `use_external_data_format: true` in ONNX conversion
- Dynamic shapes must be declared via `dynamic_axes` — batch/sequence dims are fixed otherwise
- `trust_remote_code: true` is opt-in for HuggingFace models that need custom code
- `search_strategy: false` means fixed pipeline (no architecture search) — this is the Studio default
- Pass overrides in `passRecipeOverrides` are applied after building (for expert users)
