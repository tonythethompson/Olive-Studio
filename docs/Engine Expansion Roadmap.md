

## Engine Abstraction Layer

### Core Interface

```typescript
// src/lib/engines/types.ts

/** Every backend implements this contract. */
export interface EngineBackend {
  /** Unique engine identifier (stable, used in persistence + routes). */
  id: EngineId;
  /** Human-readable name. */
  displayName: string;
  /** What this engine does in one line. */
  description: string;

  /** Can this engine run on the detected hardware? */
  isCompatible(probe: HardwareProbeResult): EngineCompatibility;

  /** Engine-specific operation catalog (replaces PASS_CATALOG). */
  getOperations(): EngineOperation[];

  /** Validate engine-specific config before submission. */
  validate(config: EngineConfig): ValidationResult;

  /** Transform UIState into engine-native config (replaces buildOliveRecipe). */
  buildConfig(state: UIState): EngineConfig;

  /** Resolve the runtime environment needed (replaces resolveVenvFamily). */
  resolveRuntime(config: EngineConfig, probe: HardwareProbeResult): RuntimeRequirement;
}

export type EngineId = "olive" | "llamacpp" | "tensorrt-llm";

export interface EngineConfig {
  engine: EngineId;
  /** Opaque to the framework — each engine defines its own shape. */
  payload: Record<string, unknown>;
  /** SHA-256 fingerprint for idempotency. */
  fingerprint: string;
}

export interface EngineOperation {
  name: string;
  category: string;
  description: string;
  /** What input formats this operation accepts. */
  accepts: ModelFormat[];
  /** What output format this operation produces. */
  produces: ModelFormat;
}

export type ModelFormat = "pytorch" | "onnx" | "gguf" | "safetensors" | "trt-engine" | "openvino-ir";

export interface EngineCompatibility {
  compatible: boolean;
  /** What hardware features enable this engine. */
  reasons: string[];
  /** Score 0-100 for ranking engines when multiple are compatible. */
  score: number;
}

export interface RuntimeRequirement {
  type: "python-venv" | "binary" | "docker" | "system";
  /** For python-venv: which family/packages. For binary: which executable. */
  spec: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  fingerprint: string;
  errors: string[];
  warnings: string[];
}
```

### Engine Implementations

```typescript
// src/lib/engines/olive/index.ts
// Wraps the existing oliveRecipeBuilder, passCatalog, venvFamily, jobPreflight
// Minimal refactor: re-exports existing logic behind the interface

export const oliveEngine: EngineBackend = {
  id: "olive",
  displayName: "Microsoft Olive",
  description: "ONNX Runtime optimization pipeline (quantization, graph optimization, NPU targeting)",
  
  isCompatible(probe) {
    // Always compatible — Olive supports CPU fallback
    return { compatible: true, reasons: ["ONNX Runtime supports all detected providers"], score: 70 };
  },

  getOperations() {
    // Wraps existing PASS_CATALOG
    return PASS_CATALOG.map(entry => ({
      name: entry.name,
      category: entry.category,
      description: entry.description,
      accepts: ["pytorch", "onnx"] as ModelFormat[],
      produces: "onnx" as ModelFormat,
    }));
  },

  validate(config) {
    // Wraps existing preflightOliveRecipe
    const pre = preflightOliveRecipe(config.payload as OliveRecipe, "auto");
    return { valid: pre.valid, fingerprint: pre.fingerprint, errors: pre.errors, warnings: pre.warnings };
  },

  buildConfig(state) {
    // Wraps existing buildOliveRecipe
    const recipe = buildOliveRecipe(state);
    return { engine: "olive", payload: recipe, fingerprint: computeFingerprint(recipe) };
  },

  resolveRuntime(config, probe) {
    // Wraps existing resolveVenvFamily logic
    const provider = extractProvider(config);
    const family = resolveVenvFamily(provider);
    return { type: "python-venv", spec: { family, packages: ["olive-ai"] } };
  },
};
```

```typescript
// src/lib/engines/llamacpp/index.ts

export const llamacppEngine: EngineBackend = {
  id: "llamacpp",
  displayName: "llama.cpp",
  description: "GGUF quantization and inference benchmarking",

  isCompatible(probe) {
    // Compatible everywhere; score higher for CPU-heavy workloads or when no GPU
    const hasNvidia = Boolean(probe.nvidia?.gpus.length);
    return { 
      compatible: true, 
      reasons: ["llama.cpp runs on CPU and GPU"],
      score: hasNvidia ? 60 : 85, // Preferred on CPU-only systems
    };
  },

  getOperations() {
    return [
      { name: "quantize", category: "quantization", description: "GGUF quantization", accepts: ["safetensors", "pytorch", "gguf"], produces: "gguf" },
      { name: "imatrix", category: "calibration", description: "Importance matrix generation", accepts: ["gguf"], produces: "gguf" },
      { name: "convert", category: "conversion", description: "Convert to GGUF format", accepts: ["safetensors", "pytorch"], produces: "gguf" },
      { name: "benchmark", category: "evaluation", description: "Inference speed benchmark", accepts: ["gguf"], produces: "gguf" },
      { name: "perplexity", category: "evaluation", description: "Perplexity measurement", accepts: ["gguf"], produces: "gguf" },
    ];
  },

  validate(config) { /* ... */ },

  buildConfig(state) {
    // LlamaCpp-specific: model path, quant type (Q4_K_M etc), imatrix path, context length
    return {
      engine: "llamacpp",
      payload: {
        model: state.hfModelId || state.localModelPath,
        outputFormat: state.llamacpp.quantType,     // e.g. "Q4_K_M"
        useImatrix: state.llamacpp.useImatrix,
        imatrixDataset: state.llamacpp.imatrixDataset,
        contextLength: state.llamacpp.contextLength,
        threads: state.llamacpp.threads,
      },
      fingerprint: computeFingerprint(/*...*/),
    };
  },

  resolveRuntime(_config, probe) {
    // llama.cpp is a binary, not a Python venv
    return { 
      type: "binary", 
      spec: { 
        executables: ["llama-quantize", "llama-bench", "llama-perplexity", "llama-imatrix"],
        gpuBackend: probe.nvidia ? "cuda" : probe.rocm ? "rocm" : "cpu",
      },
    };
  },
};
```

```typescript
// src/lib/engines/tensorrt-llm/index.ts

export const tensorrtLlmEngine: EngineBackend = {
  id: "tensorrt-llm",
  displayName: "TensorRT-LLM",
  description: "NVIDIA optimized LLM engine building (FP8, INT4-AWQ, tensor parallelism)",

  isCompatible(probe) {
    if (!probe.nvidia?.gpus.length) return { compatible: false, reasons: ["Requires NVIDIA GPU"], score: 0 };
    // Check compute capability >= 8.0 for good TRT-LLM support (Ampere+)
    const maxCC = Math.max(...probe.nvidia.gpus.map(g => g.computeCapability ?? 0));
    return { 
      compatible: true, 
      reasons: [`NVIDIA GPU detected (CC ${maxCC})`],
      score: maxCC >= 8.0 ? 95 : 75,
    };
  },

  getOperations() {
    return [
      { name: "build-engine", category: "compilation", description: "Build TRT-LLM engine", accepts: ["safetensors", "pytorch"], produces: "trt-engine" },
      { name: "quantize-fp8", category: "quantization", description: "FP8 quantization (Hopper+)", accepts: ["safetensors"], produces: "safetensors" },
      { name: "quantize-awq", category: "quantization", description: "INT4-AWQ quantization", accepts: ["safetensors"], produces: "safetensors" },
      { name: "benchmark", category: "evaluation", description: "Throughput/latency benchmark", accepts: ["trt-engine"], produces: "trt-engine" },
    ];
  },

  validate(config) { /* ... */ },

  buildConfig(state) {
    return {
      engine: "tensorrt-llm",
      payload: {
        model: state.hfModelId,
        quantization: state.tensorrt.quantMethod,   // "fp8" | "awq" | "gptq" | "none"
        tensorParallelism: state.tensorrt.tp,
        maxBatchSize: state.tensorrt.maxBatch,
        maxSeqLength: state.tensorrt.maxSeqLen,
        kvCacheType: state.tensorrt.kvCache,        // "fp8" | "int8" | "fp16"
      },
      fingerprint: computeFingerprint(/*...*/),
    };
  },

  resolveRuntime(_config, _probe) {
    // TensorRT-LLM uses a Python package or Docker container
    return { type: "python-venv", spec: { family: "tensorrt-llm", packages: ["tensorrt-llm"] } };
  },
};
```

### Engine Registry

```typescript
// src/lib/engines/registry.ts

import { oliveEngine } from "./olive/index.ts";
import { llamacppEngine } from "./llamacpp/index.ts";
import { tensorrtLlmEngine } from "./tensorrt-llm/index.ts";
import type { EngineBackend, EngineId } from "./types.ts";

const engines = new Map<EngineId, EngineBackend>([
  ["olive", oliveEngine],
  ["llamacpp", llamacppEngine],
  ["tensorrt-llm", tensorrtLlmEngine],
]);

export function getEngine(id: EngineId): EngineBackend {
  const engine = engines.get(id);
  if (!engine) throw new Error(`Unknown engine: ${id}`);
  return engine;
}

export function listEngines(): EngineBackend[] {
  return Array.from(engines.values());
}

/** Rank engines by hardware compatibility score. */
export function rankEngines(probe: HardwareProbeResult): Array<{ engine: EngineBackend; compat: EngineCompatibility }> {
  return listEngines()
    .map(engine => ({ engine, compat: engine.isCompatible(probe) }))
    .filter(e => e.compat.compatible)
    .sort((a, b) => b.compat.score - a.compat.score);
}
```

### Job Runner Generalization

The existing `jobRunner.ts` becomes the Olive-specific runner. A generic `EngineJobRunner` handles routing:

```typescript
// src/server/services/engine/jobDispatcher.ts

import type { EngineConfig, EngineId } from "../../../lib/engines/types.ts";
import type { OliveJob } from "../../types.ts";

/** Each engine provides a runner that knows how to spawn/cancel its process. */
export interface EngineRunner {
  engineId: EngineId;
  /** Ensure runtime deps are available. */
  ensureRuntime(config: EngineConfig, onLog: (line: string) => void): Promise<{ ok: boolean; error?: string }>;
  /** Spawn the engine process; return a handle for cancellation. */
  spawn(config: EngineConfig, env: Record<string, string>): EngineProcess;
}

export interface EngineProcess {
  onLog(cb: (line: string) => void): void;
  onMetrics(cb: (metrics: unknown) => void): void;
  onExit(cb: (code: number | null) => void): void;
  kill(signal?: string): void;
  pid?: number;
}
```

The existing `startOliveJob` → `continueOliveJobSetup` → `spawn()` flow becomes the Olive runner. llama.cpp gets its own runner that invokes `llama-quantize`, TensorRT-LLM gets one that invokes `trtllm-build`.

### What Changes in UIState

```typescript
// Addition to src/types.ts UIState

export interface UIState {
  // ... existing fields ...
  
  /** Active optimization engine. Defaults to "olive" for backward compat. */
  engine: EngineId;
  
  /** Engine-specific configuration (only the active engine's config is populated). */
  engineConfig: {
    olive: OlivePassConfig;    // existing `passes` field contents
    llamacpp?: LlamaCppConfig;
    tensorrtLlm?: TensorRtLlmConfig;
  };
}

export interface LlamaCppConfig {
  quantType: string;           // "Q4_K_M", "Q5_K_S", "IQ4_XS", etc.
  useImatrix: boolean;
  imatrixDataset?: string;
  contextLength: number;
  threads?: number;
  flashAttention: boolean;
}

export interface TensorRtLlmConfig {
  quantMethod: "none" | "fp8" | "awq" | "gptq" | "int8-sq";
  tp: number;                  // tensor parallelism
  pp: number;                  // pipeline parallelism
  maxBatch: number;
  maxSeqLen: number;
  kvCache: "fp8" | "int8" | "fp16";
  enableChunkedContext: boolean;
}
```

### What Stays the Same

| Component | Change needed |
|-----------|--------------|
| SSE streaming infra | None — already engine-agnostic in shape |
| Job state machine | Add `engine: EngineId` field to `OliveJob` (rename to `Job`) |
| Hardware probe | None — detection is already generic |
| Arena/benchmark panel | None — just consumes metrics from any engine |
| MCP tools | Per-engine tool sets behind a router (MCP server already uses lazy imports) |
| AI assistant | Needs engine-awareness in prompts; MCP knowledge base extends per-engine |
| Rate limiting, SSE heartbeats, loopback guards | Zero changes |

### Migration Path

1. **Phase 1 — Extract interface, wrap Olive.** Move existing code behind `EngineBackend` interface without changing behavior. `engine` field defaults to `"olive"`. All existing tests pass unchanged.

2. **Phase 2 — Add llama.cpp engine.** Implement `llamacppEngine` + runner. New UI panel under the existing pipeline step structure. llama.cpp binary management (download/verify/update) as the runtime resolver.

3. **Phase 3 — Add TensorRT-LLM engine.** Leverage existing TensorRT detection code. Implement `tensorrtLlmEngine` + runner. Python venv management extends naturally from the existing venv family system.

4. **Phase 4 — Cross-engine Arena.** "Compare Q4_K_M GGUF vs ONNX INT4 on your hardware" using the Arena panel, with engine-tagged benchmark results.

---

The key insight is that the existing code is already organized into the right layers (recipe building, job running, streaming, hardware detection) — it just needs interface extraction, not a rewrite. The Olive engine becomes a plugin that implements the same interface as the new ones, and the pipeline UI stays generic above the engine boundary.