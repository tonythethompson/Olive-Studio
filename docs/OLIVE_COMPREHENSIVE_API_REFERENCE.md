# Microsoft Olive - Complete API & Function Reference for MCP Server

## STATUS: No Existing Olive MCP Server Found ✓

**OPPORTUNITY**: This is a greenfield project - no competing MCP exists for Olive optimization guidance.

---

## CORE CLASSES & DATA STRUCTURES

### Model Classes

- `PyTorchModel` - PyTorch model wrapper
- `ONNXModel` - ONNX model wrapper
- `CompositeOnnxModel` - Composite ONNX model handling
- `OpenVINOModel` - OpenVINO format support
- `SNPEModel` - Qualcomm SNPE format support
- `TensorFlowModel` - TensorFlow format support

### System/Infrastructure Classes

- `SystemConfig` - Base system configuration
- `AzureMLSystem` - Azure ML execution environment
- `DockerSystem` - Docker-based execution
- `PythonEnvironmentSystem` - Local Python environment
- `OliveSystem` - General system abstraction
- `OliveSystems` - System registry/management

### Workflow & Configuration Classes

- `OliveConfig` - Workflow configuration schema
- `WorkflowDefinition` - Workflow structure definition
- `Pass` - Base optimization pass class
- `PassConfig` - Pass configuration container
- `DataConfig` - Data configuration for calibration
- `EvaluatorConfig` - Evaluation metrics configuration
- `MetricResult` - Metric evaluation results
- `ModelSearchPoint` - Search space exploration point

---

## QUANTIZATION PASSES

### Intel Neural Compressor Quantization

- `IncQuantization` - Unified quantization (dynamic + static tuning)
- `IncDynamicQuantization` - Dynamic quantization specific
- `IncStaticQuantization` - Static quantization specific
- **Config Parameters**:
  - `quant_level` (int)
  - `calibration_data_dir` (str)
  - `calibration_sampling_size` (int)
  - `reduce_range` (bool)
  - `use_external_data_format` (bool)
  - `weight_type` (str): "int8", "uint8", "int4", "nf4"
  - `activation_type` (str)
  - `scheme` (str): "sym", "asym"
  - `algorithm` (str): "minmax", "kl", "entropy"
  - `per_channel` (bool)
  - `operators_to_quantize` (list)
  - `operators_to_exclude` (list)

### ONNX Quantization

- `OnnxQuantization` - Unified ONNX quantization
- `OnnxDynamicQuantization` - Dynamic precision ONNX
- `OnnxStaticQuantization` - Static calibration ONNX
- **Config Parameters**:
  - `quant_format` (str): "QOperator", "QDQ"
  - `per_channel` (bool)
  - `reduce_range` (bool)
  - `calibrate_method` (str)
  - `calibration_data_dir` (str)
  - `calibration_sampling_size` (int)
  - `weight_type` (str): "int8", "uint8"
  - `activation_type` (str)
  - `optimize_model_only` (bool)

### NVIDIA TensorRT Quantization

- `NVModelOptQuantization` - NVIDIA TensorRT Model Optimizer pass
- **Supported Algorithms**:
  - `AWQ` (Activation-aware Weight Quantization)
  - `RTN` (Round-to-Nearest)
- **Config Parameters**:
  - `algorithm` (str): "awq", "rtn"
  - `weight_bits` (int): typically 4 or 8
  - `activation_bits` (int): typically 8
  - `calibration_data_dir` (str)
  - `calibration_iters` (int)

### Xilinx Vitis AI Quantization

- `VitisAIQuantization` - Vitis AI execution provider quantization
- **Features**:
  - Power-of-2 scale quantization
  - Vitis AI Execution Provider support
- **Config Parameters**:
  - `quant_level` (int)
  - `calibration_data_dir` (str)

### Advanced Quantization Techniques (CLI)

- `gptq` - GPTQ quantization algorithm
- `awq` - Activation-aware Weight Quantization
- `quarot` - QaRot quantization algorithm
- `hqq` - Half-Quadratic Quantization (calibration-free)
- `bnb_nf4` - bitsandbytes NF4 quantization

---

## CONVERSION PASSES

### ONNX Conversion

- `OnnxConversion` - PyTorch to ONNX conversion
- **Config Parameters**:
  - `target_opset` (int): typically 14-21
  - `input_names` (list[str])
  - `output_names` (list[str])
  - `example_input` (tensor or dict)
  - `input_types` (list[str]): "int64", "float32", etc.
  - `input_shapes` (list[list[int]])
  - `dynamic_axes` (dict)
  - `use_external_data_format` (bool) - for large models
  - `opset_version` (int)
  - `export_params` (bool)
  - `verbose` (bool)
  - `do_constant_folding` (bool)

### ONNX Op Version Conversion

- `OnnxOpVersionConversion` - Update ONNX operator versions
- **Config Parameters**:
  - `target_opset` (int)

### OpenVINO Conversion

- `OpenVINOConversion` - PyTorch/ONNX to OpenVINO

### Format-Specific Conversions

- `SNPEConversion` - Qualcomm SNPE format
- `TensorFlowConversion` - TensorFlow format export

---

## GRAPH OPTIMIZATION PASSES

### ONNX Graph Optimization

- `OnnxModelOptimizer` - General ONNX graph optimization
- **Config Parameters**:
  - `optimize_model_only` (bool)
  - `graph_optimization_level` (str): "disabled", "basic", "extended", "all"
  - `execution_provider` (str): "CPUExecutionProvider", "CUDAExecutionProvider", etc.

### Transformer-Specific Optimization

- `OrtTransformersOptimization` - ONNX Runtime Transformer optimization
- **Features**:
  - Layer fusion (e.g., LayerNorm fusion)
  - Attention optimization
  - Embedding fusion
  - Skip connection optimization
  - Activation fusion
- **Config Parameters**:
  - `num_heads` (int)
  - `hidden_size` (int)
  - `opt_level` (int): 0-4
  - `execution_provider` (str)
  - `min_seq_length` (int)
  - `max_seq_length` (int)

### Float16 Conversion

- `OnnxFloatToFloat16` - Cast float32 to float16
- **Config Parameters**:
  - `use_symbolic_shape_infer` (bool)
  - `cast_int_inputs_to_int32` (bool)
  - `keep_io_types` (bool)

### Mixed Precision Optimization

- `OrtMixedPrecision` - Mixed int8/float32 precision
- **Config Parameters**:
  - `op_block_list` (list[str])

### QNN (Qualcomm Neural Network) Passes

- `QNNPreprocess` - QNN model preprocessing
- `QNNQuantization` - QNN quantization
- `QNNConversion` - QNN format conversion

---

## PRUNING & SPARSITY PASSES

### Intel Neural Compressor Pruning

- `IncPruning` - Magnitude-based and structured pruning
- **Config Parameters**:
  - `pruning_type` (str): "magnitude", "movement", "iterative"
  - `target_sparsity` (float): 0.0-1.0
  - `pruning_frequency` (int)
  - `min_sparsity_loss_increase` (float)
  - `excluded_op_names` (list[str])
  - `excluded_op_types` (list[str])

### Sparsity Fine-tuning

- `IncSparsityFineTuning` - Fine-tune after sparsity
- `SparsityFineTuning` - General sparsity fine-tuning pass

---

## DISTILLATION & FINE-TUNING PASSES

### Knowledge Distillation

- `IncDistillation` - Intel Neural Compressor distillation
- `DistillationPass` - General distillation framework
- **Config Parameters**:
  - `teacher_model` (str): path to teacher model
  - `criterion_type` (str): "KL", "L2", "MSE"
  - `temperature` (float): typically 3.0-20.0
  - `loss_types` (list[str])
  - `loss_weights` (list[float])
  - `train_epochs` (int)
  - `learning_rate` (float)
  - `batch_size` (int)

### LoRA Adaptation

- `LoRA` - Low-Rank Adaptation fine-tuning
- `QLoRA` - Quantized LoRA
- `MultiLoRA` - Multi-LoRA support for ONNX Runtime
- **Config Parameters**:
  - `lora_rank` (int): typically 8-64
  - `lora_alpha` (float)
  - `lora_dropout` (float)
  - `target_modules` (list[str]): ["q_proj", "v_proj", etc.]
  - `modules_to_save` (list[str])
  - `learning_rate` (float)
  - `num_train_epochs` (int)
  - `batch_size` (int)

### General Fine-tuning

- `FinetuningPass` - PyTorch model fine-tuning
- `HuggingFaceFineTuning` - Hugging Face trainer integration

---

## PERFORMANCE TUNING PASSES

### ONNX Runtime Tuning

- `OrtPerfTuning` - ONNX Runtime performance tuning
- **Config Parameters**:
  - `tuning_type` (str): "Quantization", "Distillation", "Mixed_Precision"
  - `samples_batch_size` (int)
  - `data_dir` (str)
  - `enable_profiling` (bool)

### Model Optimization Profiling

- `ModelOptOptimizer` - NVIDIA Model Optimizer integration

---

## CONVERSION & CAPTURE PASSES

### ONNX Graph Capture

- `OnnxGraphCapture` - Capture ONNX computation graph
- `OnnxDynamicQuantization` - Dynamic graph quantization

### LoRA Weight Extraction

- `ExtractLoRA` - Extract LoRA weights to separate file
- `GenerateAdapterWeights` - Generate adapter weight files

### Batch Size Optimization

- `BatchSizeOptimization` - Optimize for batch processing

---

## CLI COMMANDS

### Main Commands

```
olive quantize <model>           # Direct quantization
olive finetune <model>           # Direct fine-tuning
olive optimize <model>           # Full optimization pipeline
olive auto-opt <model>           # Automatic optimization
olive onnx-graph-capture         # Capture ONNX graph
olive generate-adapter           # Extract adapter weights
```

### Command Parameters

- `--config` (str): Path to workflow configuration JSON
- `--model-path` (str): Input model path
- `--output-dir` (str): Output directory for optimized model
- `--optimization-target` (str): "quality", "performance", "balanced"
- `--execution-providers` (list[str]): "CPUExecutionProvider", "CUDAExecutionProvider", "TensorrtExecutionProvider"
- `--platform` (str): "windows", "linux", "mac", "android", "ios"
- `--accelerator` (str): "cpu", "gpu", "npu", "gpu-cuda", "gpu-tensorrt"

---

## CONFIGURATION SCHEMA (config.json)

### Top-Level Keys

```json
{
  "input_model": {}, // Model specification
  "systems": {}, // Execution environments
  "data_configs": {}, // Data loading configs
  "evaluators": [], // Metric evaluators
  "passes": {}, // Optimization passes
  "engine": {}, // Optimization engine settings
  "output_dir": "", // Output directory
  "evaluator_config": {}, // Evaluation settings
  "log_severity_level": "", // Logging level
  "host": "", // Host configuration
  "port": 0, // Port configuration
  "gpu_memory_fraction": 0.0 // GPU memory allocation
}
```

### input_model Schema

```json
{
  "type": "", // "PyTorchModel", "ONNXModel", etc.
  "path": "", // Model file path
  "model_name_pattern": "", // Pattern matching
  "model_path": "", // Alternative path specification
  "framework": "", // "torch", "onnx", "tf", etc.
  "io_config": {}, // Input/output specification
  "config_path": "" // Config file path (HF models)
}
```

### Pass Configuration Template

```json
{
  "pass_name": {
    "type": "", // Pass class name
    "params": {
      "param_name": "" // Pass-specific parameters
    },
    "input": "", // Input model reference
    "output_name": "", // Output variable name
    "disable_search": false // Skip search optimization
  }
}
```

### Data Config Template

```json
{
  "data_config_name": {
    "type": "", // "DataContainer", "HuggingFaceContainer", etc.
    "data_name": "", // Dataset name
    "data_dir": "", // Data directory
    "subset": "", // Dataset subset
    "split": "", // Train/val/test split
    "data_files": [], // Explicit file list
    "batch_size": 0,
    "calibration_sampling_size": 0
  }
}
```

### Evaluator Configuration

```json
{
  "evaluator_name": {
    "type": "", // "HuggingFaceEvaluator", "AccuracyEvaluator", etc.
    "batch_size": 0,
    "dataloader_cfg": {},
    "metrics": [
      // Metric definitions
      {
        "name": "",
        "type": "", // "accuracy", "f1_score", "latency", etc.
        "backend": "",
        "sub_types": []
      }
    ]
  }
}
```

---

## EXECUTION PROVIDERS

### CPU-Based

- `CPUExecutionProvider` - Standard CPU inference
- `OpenVINOExecutionProvider` - Intel OpenVINO optimization

### GPU-Based

- `CUDAExecutionProvider` - NVIDIA CUDA
- `TensorrtExecutionProvider` - NVIDIA TensorRT
- `ROCMExecutionProvider` - AMD ROCM

### Mobile/Edge

- `CoreMLExecutionProvider` - Apple CoreML (iOS/macOS)
- `NeuralProcessingUnitExecutionProvider` - Qualcomm NPU
- `QNNExecutionProvider` - Qualcomm QNN
- `SNPEExecutionProvider` - Qualcomm SNPE
- `NNAPIExecutionProvider` - Android NNAPI
- `VitisAIExecutionProvider` - Xilinx Vitis AI

### Specialized

- `TensorflowLiteExecutionProvider` - TensorFlow Lite
- `XnnpackExecutionProvider` - XNNPACK (mobile ops)
- `CoreMLExecutionProvider` - Apple CoreML

---

## SEARCH SPACE & AUTO-OPTIMIZATION

### Search Types

- `Grid Search` - Exhaustive parameter search
- `Random Search` - Random sampling
- `Bayesian Optimization` - Bayesian hyperparameter search
- `Evolution Strategy` - Genetic algorithm-based search

### Search Configuration

- `max_iterations` (int)
- `objectives` (list[str]): e.g. ["accuracy", "latency", "memory"]
- `objective_weights` (list[float])
- `pareto_frontier_size` (int)
- `convergence_threshold` (float)
- `seed` (int)

---

## EVALUATION & METRICS

### Metric Types

- `accuracy` - Classification accuracy
- `f1_score` - F1 score for classification
- `latency` - Model inference latency (ms)
- `throughput` - Inferences per second
- `memory` - Memory footprint (MB/GB)
- `model_size` - Compressed model size
- `bleu_score` - NLP translation quality
- `perplexity` - Language model perplexity
- `custom` - User-defined metrics

### Evaluator Backends

- `ort_evaluator` - ONNX Runtime evaluation
- `pytorch_evaluator` - PyTorch evaluation
- `huggingface_evaluator` - Hugging Face Transformers
- `custom_evaluator` - User-provided evaluation function

---

## DATA HANDLING CLASSES

### Data Container Types

- `DataContainer` - Base data loader
- `HuggingFaceContainer` - Hugging Face dataset integration
- `ImageNetContainer` - ImageNet dataset
- `CifarContainer` - CIFAR dataset
- `OpenBooksContainer` - OpenBooks dataset
- `SqliteContainer` - SQLite data storage
- `VinVLContainer` - Vision-language datasets
- `TextContainer` - Text file data loading

### Data Preprocessing

- `RandomSampling` - Random sampling strategy
- `BottleneckFeatureProcessor` - Feature extraction
- `DefaultDataPreProcessor` - Default preprocessing
- `DefaultDataPostProcessor` - Default postprocessing

---

## WORKFLOW EXECUTION

### Execution Engine Options

- `search_algorithm` (str): "grid", "random", "bayesian", "evolutionary"
- `evaluator` (str): Reference to evaluator config
- `evaluate_input_model` (bool): Baseline evaluation
- `evaluate_output_model` (bool): Final model evaluation
- `candidate_objective_normalizers` (dict)
- `checkpoint_dir` (str): Checkpoint saving
- `clean_evaluation_cache` (bool)
- `clean_search_space` (bool)
- `continue_if_failed` (bool)
- `continue_if_no_improvement` (bool)
- `execution_order` (str): "joint", "pass-by-pass"

---

## IMPORTANT QUIRKS & BEHAVIORS

### Calibration & Quantization Quirks

1. **Static vs Dynamic Tradeoff**: Static quantization requires calibration dataset but offers better compression; dynamic calculates at runtime (slower inference but simpler setup)
2. **Per-Channel vs Per-Tensor**: Per-channel quantization better for Conv/Linear but slower; per-tensor faster but lower accuracy
3. **Symmetric vs Asymmetric**: Symmetric easier for accelerators; asymmetric better accuracy but requires hardware support
4. **Weight-Only vs Activation**: Weight-only simpler, activation quantization more aggressive but harder to implement
5. **Calibration Size Sensitivity**: Too small = poor statistics, too large = slow; typically 100-300 samples sufficient

### ONNX Export Quirks

1. **Dynamic Shapes**: ONNX needs dynamic_axes defined for variable batch/sequence lengths
2. **Opset Version**: Newer opsets support more ops but reduce hardware compatibility
3. **External Data Format**: Models >2GB require use_external_data_format=True (creates separate data files)
4. **Type Mismatches**: Some frameworks default to float64; ONNX prefers float32 for inference hardware

### Multi-Pass Execution Quirks

1. **Pass Ordering Matters**: Conversion→Quantization→Optimization order crucial (can't quantize before ONNX conversion)
2. **No Feedback Loops**: Passes execute linearly; can't adjust Pass B based on Pass A metrics without multiple workflows
3. **State Not Preserved**: Each pass reads fresh input; must explicitly save intermediates
4. **Parameter Sensitivity**: Same pass config on different hardware/batches may yield different results

### GPU/Hardware Quirks

1. **Execution Provider Mismatches**: Using TensorRT provider but ops not supported → silent fallback to CPU (slow!)
2. **Device Memory Limits**: Large model + large calibration batch → OOM; requires batching/streaming
3. **Hardware-Specific Ops**: AWQ/RTN quantization has vendor-specific implementations; accuracy varies by GPU
4. **NPU Quantization**: NPU ops may have stricter quantization requirements (per-channel, power-of-2 scales)

### LoRA & Adapter Quirks

1. **Base Model Sensitivity**: LoRA quality depends on base model frozen weights; retraining base invalidates LoRA
2. **Rank Selection**: Too low rank = underfitting; too high = no compression. Rule of thumb: rank = 5-10% of hidden_dim
3. **Merging Complexity**: Some inference runtimes require merging LoRA into base model; not all support dynamic loading
4. **MultiLoRA Overhead**: Multiple adapters require index management; ONNX Runtime MultiLoRA still experimental

### Search Space Quirks

1. **Objective Conflicts**: Minimizing latency & maximizing accuracy often conflict; Pareto frontier needed
2. **Evaluator Cost**: Search _slow_ if evaluator expensive; consider accuracy proxy metrics
3. **Reproducibility**: Stochastic search needs seed control; framework-specific randomness sources
4. **Search Stalling**: Local optima in quantization search; restarting with different seeds helps

### Data Pipeline Quirks

1. **Calibration Bias**: Calibration data must match inference distribution; skewed calibration = poor quantization
2. **Preprocessing Consistency**: Calibration preprocessing must match inference preprocessing exactly
3. **Batch Size Effects**: Quantization calibration batch size ≠ inference batch size; statistics may differ
4. **Data Format**: Image channels (RGB vs BGR), normalization (ImageNet stats), data types (uint8 vs float32)

---

## KNOWN LIMITATIONS & WORKAROUNDS

| Issue                                   | Workaround                                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| ONNX model >2GB                         | Use external data format + chunked quantization                                                 |
| Unsupported ONNX ops in target provider | Graph rewriting or fallback provider                                                            |
| Poor quantization accuracy              | Increase calibration size, try different algorithms (AWQ/GPTQ), or use lower bitwidth sparingly |
| Adapter merging failures                | Use base model compatibility check; some old models not compatible                              |
| GPU OOM during calibration              | Reduce batch_size, enable gradient checkpointing, or use CPU calibration                        |
| Search not converging                   | Reduce search space, add constraints, or increase max_iterations                                |
| MultiLoRA serving issues                | Check ONNX Runtime version compatibility (v1.17+)                                               |
| Model size regression                   | Quantization + distillation needed; pure quantization may bloat hidden layers                   |

---

## INTEGRATION PATTERNS

### Common Workflow Patterns

1. **Quantization-Only**: Convert→Quantize→Evaluate (fastest, moderate compression)
2. **Compression-Focused**: Convert→Quantize→Prune→Distill (aggressive, requires tuning)
3. **Speed-Focused**: Convert→Quantize→Transformer-Optimize→Tune (latency-optimized)
4. **Hardware-Aware**: Analyze target hardware→Select optimization passes→Search→Deploy
5. **LoRA Fine-tuning**: Keep base model→Train LoRA→Quantize LoRA→Package separately

### External Tool Integrations

- **Intel Neural Compressor**: Automatic tuning, pruning, distillation
- **NVIDIA Model Optimizer**: Quantization, sparsity, compilation
- **Hugging Face Transformers**: Model loading, training, evaluation
- **ONNX Runtime**: Inference, execution providers, optimizations
- **TensorRT**: GPU optimization, quantization-aware training
- **OpenVINO**: CPU optimization, inference framework
- **Qualcomm Vitis AI**: NPU/edge optimization

---

## SOURCES & DOCUMENTATION

- [Microsoft Olive GitHub Repository](https://github.com/microsoft/Olive)
- [Microsoft Olive Official Documentation](https://microsoft.github.io/Olive/)
- [ONNX Runtime Olive Integration](https://onnxruntime.ai/docs/performance/olive.html)
- [Microsoft OpenSource Blog - Olive](https://opensource.microsoft.com/blog/2023/06/26/olive-a-user-friendly-toolchain-for-hardware-aware-model-optimization/)
- [ONNX Runtime Blog - Olive CLI](https://onnxruntime.ai/blogs/olive-cli/)

---

## READY FOR MCP SERVER IMPLEMENTATION

This document provides the foundation for an Olive-specialized MCP server. Key opportunities:

✅ **Comprehensive Pass Library** - 40+ optimization passes with detailed parameters
✅ **Configuration Schema Documentation** - Complete JSON structure reference
✅ **Execution Provider Coverage** - CPU, GPU, mobile, edge hardware support
✅ **Quirks & Workarounds** - Real implementation challenges documented
✅ **No Competing MCP** - Blue ocean opportunity for Olive-specific agent assistance
✅ **Active Development** - Olive actively maintained with new features (MultiLoRA, CLI, 2024-2026 updates)
