---
name: hardware-probe
description: Detect local hardware, map execution providers, select CUDA versions, and plan multi-EP strategies. Use when configuring hardware targets, debugging provider availability, or optimizing for specific GPU/NPU/CPU capabilities.
---

# Hardware & Runtime Environment

This skill covers hardware detection, execution provider (EP) mapping, and hardware-aware optimization configuration using the Olive MCP tools.

## Key Tools

| Tool | Purpose |
|------|---------|
| `get_runtime_ep_hints` | Probe local hardware for available EPs |
| `get_hardware_optimization_guide` | Get hardware-specific pass chain and EP advice |
| `get_quantization_strategy` | Hardware-aware quantization recommendations |
| `get_model_compatibility` | Check model x hardware support |

## Step 1: Probe Local Hardware

Detect what's available on the current machine:

```
Tool: get_runtime_ep_hints
Input: { "refresh": false }  // true to bypass probe cache
```

Returns:
- Available execution providers (CUDA, TensorRT, OpenVINO, QNN, DirectML, WebGPU, CPU)
- CUDA version and GPU details (if NVIDIA)
- Recommended EP for this machine
- Python/ONNX Runtime versions
- Environment context

Use `refresh: true` only when hardware has changed (e.g., after driver update).

## Step 2: Get Hardware-Specific Guidance

Once you know the hardware category, get a full optimization guide:

```
Tool: get_hardware_optimization_guide
Input: {
  "target_hardware": "NVIDIA RTX 4090",
  "model_size": "large",        // small, medium, large
  "latency_goal": "<50ms",      // human-readable target
  "throughput_goal": "100 tok/s" // optional
}
```

Returns:
- Recommended pass chain (in execution order)
- Primary execution provider
- Expected speedup range
- Calibration requirements
- Batch size recommendations

## Hardware Categories

The MCP server routes hardware targets to strategy buckets:

| Category | Examples | Primary EP |
|----------|----------|-----------|
| `nvidia` | RTX 4090, A100, H100, T4, L4 | CUDAExecutionProvider or TensorrtExecutionProvider |
| `amd` | MI300X, RX 7900 XTX, Ryzen AI | ROCmExecutionProvider or MIGraphXExecutionProvider |
| `intel` | Arc A770, Core Ultra, Xeon w/ AMX | OpenVINOExecutionProvider |
| `qualcomm` | Snapdragon X Elite, Cloud AI 100 | QNNExecutionProvider |
| `apple` | M1/M2/M3/M4 (Neural Engine) | CoreMLExecutionProvider |
| `webgpu` | Browser deployment (any GPU) | WebGpuExecutionProvider |
| `cpu` | Any CPU-only deployment | CPUExecutionProvider |

## Execution Provider Selection

### NVIDIA GPUs

| Use Case | Recommended EP | Why |
|----------|---------------|-----|
| General inference | CUDAExecutionProvider | Broad compatibility, good performance |
| Maximum throughput | TensorrtExecutionProvider | Fused kernels, INT8/FP16 native |
| Large batch LLM | CUDAExecutionProvider | Better memory management |
| Latency-critical | TensorrtExecutionProvider | Lowest per-request latency |

### Intel Hardware

| Hardware | EP | Notes |
|----------|-----|-------|
| Core Ultra NPU | OpenVINOExecutionProvider (NPU device) | INT8 only, batch 1 |
| Arc GPU | OpenVINOExecutionProvider (GPU device) | FP16/INT8 |
| Xeon CPU (AMX) | OpenVINOExecutionProvider (CPU device) | INT8 with AMX acceleration |
| Xeon CPU (no AMX) | CPUExecutionProvider | ONNX Runtime native |

### AMD GPUs

| Hardware | EP | Notes |
|----------|-----|-------|
| MI300X (data center) | ROCmExecutionProvider | Full FP16/BF16/INT8 |
| RX 7900 (consumer) | ROCmExecutionProvider | Limited library support |
| Ryzen AI NPU | DirectMLExecutionProvider | Windows only |

## CUDA Version Selection

CUDA version determines which PyTorch and ONNX Runtime wheels are installed:

| CUDA Tag | PyTorch | ORT | Supported GPUs |
|----------|---------|-----|---------------|
| `cu118` | 2.1+ | 1.16+ | Kepler+ (CC 3.5+) |
| `cu121` | 2.2+ | 1.17+ | Maxwell+ (CC 5.0+) |
| `cu124` | 2.4+ | 1.19+ | Maxwell+ (CC 5.0+) |
| `cu128` | 2.6+ | 1.21+ | Ampere+ (CC 8.0+) |

### How to choose:
1. Check driver version: `nvidia-smi` shows max supported CUDA
2. Match to the highest supported tag in `RESOLVABLE_CUDA_TAGS`
3. If unsure, `cu121` is the safest broadly-compatible choice
4. For newest GPUs (Ada Lovelace, Hopper), prefer `cu124` or `cu128`

### Gotcha: Unsupported CUDA tags
`cu130` and `cu132` don't have pinned package resolutions yet. Use `cu128` or lower.

## Multi-EP Fallback Strategy

For robust deployment, configure fallback providers:

```json
{
  "execution_providers": [
    ["TensorrtExecutionProvider", {
      "trt_max_workspace_size": 4294967296,
      "trt_fp16_enable": true
    }],
    ["CUDAExecutionProvider", {
      "device_id": 0
    }],
    ["CPUExecutionProvider", {}]
  ]
}
```

**Fallback order matters:** ONNX Runtime tries each EP in order, falling back when an op isn't supported.

### Common fallback chains:
- **NVIDIA:** TensorRT → CUDA → CPU
- **Intel:** OpenVINO (GPU) → OpenVINO (CPU) → CPU
- **AMD:** ROCm → CPU
- **Universal:** DirectML → CPU (Windows) or WebGPU → WASM (Browser)

## Docker / Remote Lab Considerations

When hardware probe runs inside a container or on a remote machine:

- Set `OLIVE_ARENA_ALLOW_REMOTE=true` to disable loopback gating on Arena routes
- GPU passthrough: ensure `--gpus all` (Docker) or device mapping
- NVIDIA Container Toolkit must be installed for CUDA in Docker
- `nvidia-smi` must be accessible inside the container for detection
- OpenVINO requires `/dev/dri` passthrough for GPU device access

## VRAM Estimation

Use `get_model_info` to get VRAM estimates:

```
Tool: get_model_info
Input: { "model_id": "meta-llama/Llama-3-8B" }
```

### Quick VRAM rules of thumb:
| Precision | VRAM per Billion Params |
|-----------|------------------------|
| FP32 | ~4 GB/B |
| FP16/BF16 | ~2 GB/B |
| INT8 | ~1 GB/B |
| INT4 | ~0.5 GB/B |

A 7B model at INT4 needs ~3.5 GB VRAM (plus overhead for KV cache, activations).

## Troubleshooting

### "No GPU detected"
- Verify drivers: `nvidia-smi` (NVIDIA), `rocm-smi` (AMD), `xpu-smi` (Intel)
- Check Python env has GPU-enabled ONNX Runtime: `pip show onnxruntime-gpu`
- Ensure the venv was created with GPU wheels (not CPU-only ORT)

### "EP not available"
- Not all EPs ship with default ORT. TensorRT EP requires separate `tensorrt` package.
- OpenVINO EP requires `openvino` package
- QNN EP requires Qualcomm SDK and is Windows/Linux ARM only

### "CUDA version mismatch"
- System CUDA (from driver) must be >= the CUDA tag used for pip wheels
- `nvidia-smi` shows max driver CUDA; `nvcc --version` shows toolkit CUDA
- The pip wheel CUDA must be <= driver CUDA

### Hardware probe returns stale data
- Call `get_runtime_ep_hints` with `refresh: true`
- Or restart the Olive Studio server to clear the probe cache
