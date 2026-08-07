import type { UIState } from "@/types";

export type OwrPlatform = "web" | "mobile";
export type OwrVramMode = "performance" | "memory";

/**
 * Intentional dual spellings between Studio catalog and ORT Web / OWR:
 * - Studio / Olive recipe: `WebGpuExecutionProvider`
 * - ORT Web session config: `WebGPUExecutionProvider`
 * - Studio / Olive recipe: `NNAPIExecutionProvider`
 * - OWR mobile ORT config: `NnapiExecutionProvider`
 */
export const STUDIO_WEB_GPU_EP = "WebGpuExecutionProvider" as const;
export const OWR_WEB_GPU_EP = "WebGPUExecutionProvider" as const;
export const STUDIO_NNAPI_EP = "NNAPIExecutionProvider" as const;
export const OWR_NNAPI_EP = "NnapiExecutionProvider" as const;
export const OWR_WASM_EP = "WasmExecutionProvider" as const;
export const OWR_XNNPACK_EP = "XnnpackExecutionProvider" as const;

/** Map Studio WebGPU id → ORT Web / OWR web session EP string. */
export function studioWebGpuToOwrEp(
  provider: typeof STUDIO_WEB_GPU_EP | string = STUDIO_WEB_GPU_EP,
): typeof OWR_WEB_GPU_EP {
  if (provider === STUDIO_WEB_GPU_EP || provider === OWR_WEB_GPU_EP) {
    return OWR_WEB_GPU_EP;
  }
  return OWR_WEB_GPU_EP;
}

/** Map Studio NNAPI id → OWR mobile session EP string. */
export function studioNnapiToOwrEp(
  provider: typeof STUDIO_NNAPI_EP | string = STUDIO_NNAPI_EP,
): typeof OWR_NNAPI_EP {
  if (provider === STUDIO_NNAPI_EP || provider === OWR_NNAPI_EP) {
    return OWR_NNAPI_EP;
  }
  return OWR_NNAPI_EP;
}

const ARCHITECTURE_MATCHERS: Array<{ needle: string; architecture: string }> = [
  { needle: "llama", architecture: "Llama" },
  { needle: "phi", architecture: "Phi" },
  { needle: "whisper", architecture: "Whisper" },
  { needle: "resnet", architecture: "ResNet" },
  { needle: "mobilenet", architecture: "MobileNet" },
  { needle: "bert", architecture: "BERT" },
];

/** Deduce a display architecture label from a model file or HF id basename. */
export function deduceOwrArchitecture(modelName: string): string {
  const nameLower = modelName.toLowerCase();
  for (const { needle, architecture } of ARCHITECTURE_MATCHERS) {
    if (nameLower.includes(needle)) return architecture;
  }
  if (nameLower.includes("stable") || nameLower.includes("diffusion")) {
    return "Stable Diffusion";
  }
  return "DecoderLLM";
}

export function resolveOwrModelName(state: Pick<UIState, "hfModelId" | "localFiles">): string {
  const rawModelId = state.hfModelId || state.localFiles?.[0]?.name || "model";
  return rawModelId.split("/").pop() || "model";
}

export function buildOrtConfig(opts: { platform: OwrPlatform; vramMode: OwrVramMode; threads: string }) {
  const { platform, vramMode, threads } = opts;
  // OWR web uses ORT-Web spelling (WebGPUExecutionProvider), not Studio WebGpuExecutionProvider.
  const webProviders =
    vramMode === "performance"
      ? [studioWebGpuToOwrEp(), OWR_WASM_EP]
      : [OWR_WASM_EP];

  return {
    model_path: platform === "web" ? "models/optimized/model.onnx" : "models/optimized/model.ort",
    session_options: {
      execution_mode: "ORT_SEQUENTIAL",
      execution_providers:
        platform === "web"
          ? webProviders
          : [OWR_XNNPACK_EP, studioNnapiToOwrEp()],
      graph_optimization_level: "ORT_ENABLE_ALL",
      intra_op_num_threads: parseInt(threads) || 4,
      inter_op_num_threads: 1,
      log_id: platform === "web" ? "onnxruntime_web" : "onnxruntime_mobile",
      enable_profiling: false,
      enable_mem_pattern: true,
      enable_cpu_mem_arena: true,
    },
    run_options: {
      log_severity_level: 2,
    },
  };
}

export function buildOwrManifestConfig(opts: {
  modelName: string;
  architecture: string;
  platform: OwrPlatform;
  vramMode: OwrVramMode;
  state: UIState;
}) {
  const { modelName, architecture, platform, vramMode, state } = opts;
  return {
    manifest_version: "1.0.0",
    generator: "Olive OWR Cross-Compiling Exporter",
    export_date: new Date().toISOString(),
    model_metadata: {
      name: modelName,
      architecture,
      quantization: state.passes.quantization ? state.passes.quantPrecision : "none",
      precision: state.passes.conversionInputTargetTypes || "float32",
      passes_applied: Object.keys(state.passes).filter((k) => (state.passes as Record<string, unknown>)[k]),
    },
    deployment_requirements: {
      runtime: `onnxruntime-${platform}`,
      vram_constraint: vramMode,
      optimal_execution_providers:
        platform === "web" ? ["WebGPU", "WASM"] : ["NNAPI (Android)", "CoreML (iOS)", "XNNPACK"],
    },
  };
}

export function buildWebInitCode(opts: {
  modelName: string;
  architecture: string;
  threads: string;
  vramMode: OwrVramMode;
}): string {
  const { modelName, architecture, threads, vramMode } = opts;
  const executionProviders = vramMode === "performance" ? '["webgpu", "wasm"]' : '["wasm"]';
  return `// ONNX Runtime Web (OWR) Service-Worker / App Loader
// Configured dynamically for: ${modelName} (${architecture})
// Execute: pnpm add onnxruntime-web

import * as ort from "onnxruntime-web";

// Configure WASM and WebGPU threads
ort.env.wasm.numThreads = ${threads};
ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/";

export async function initializeOrtSession() {
  console.log("Loading OWR model pipeline from memory...");
  
  const sessionOptions = {
    executionProviders: ${executionProviders},
    graphOptimizationLevel: "all",
    enableCpuMemArena: true,
    enableMemPattern: true
  };

  try {
    const session = await ort.InferenceSession.create("./models/optimized/model.onnx", sessionOptions);
    console.log("Session init success! Available Inputs:", session.inputNames);
    return session;
  } catch (err) {
    console.error("Failed to boot ONNX Runtime session:", err);
    throw err;
  }
}

export async function runInference(session, rawFloatBuffer) {
  // Map dynamic inputs to graph feeds
  const feeds = {};
  for (const name of session.inputNames) {
    // Creating default tensors matched to compiling specifications
    feeds[name] = new ort.Tensor("float32", new Float32Array(rawFloatBuffer || 1024), [1, 1024]);
  }
  
  const results = await session.run(feeds);
  return results;
}
`;
}

export function buildMobileInitCode(opts: {
  modelName: string;
  architecture: string;
  threads: string;
}): string {
  const { modelName, architecture, threads } = opts;
  return `package com.onnxruntime.mobile

import android.content.Context
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.nio.FloatBuffer

/**
 * High-performance ONNX Runtime Mobile Wrapper Session
 * Generated dynamically for model: ${modelName} (${architecture})
 */
class OnnxModelExecutor(private val context: Context) : AutoCloseable {
    private val ortEnv: OrtEnvironment = OrtEnvironment.getEnvironment()
    private var ortSession: OrtSession? = null

    fun loadModelFromAssets(assetName: String = "model.ort") {
        val modelBytes = readAsset(assetName)
        val opts = OrtSession.SessionOptions().apply {
            setIntraOpNumThreads(${threads})
            // Establish target execution capabilities
            addXnnpack()
            addNnapi()
        }
        ortSession = ortEnv.createSession(modelBytes, opts)
    }

    fun runInference(inputData: FloatArray, shape: LongArray): Map<String, Any> {
        val session = ortSession ?: throw IllegalStateException("Session not initialized.")
        val buffer = FloatBuffer.wrap(inputData)
        val inputName = session.inputNames.first()
        val tensor = OnnxTensor.createTensor(ortEnv, buffer, shape)
        
        tensor.use {
            val outputs = session.run(mapOf(inputName to tensor))
            return outputs.associate { it.key to it.value.value }
        }
    }

    private fun readAsset(fileName: String): ByteArray {
        context.assets.open(fileName).use { stream ->
            val byteBuffer = ByteArrayOutputStream()
            val buffer = ByteArray(4096)
            var len: Int
            while (stream.read(buffer).also { len = it } != -1) {
                byteBuffer.write(buffer, 0, len)
            }
            return byteBuffer.toByteArray()
        }
    }

    override fun close() {
        ortSession?.close()
    }
}
`;
}

export function buildOwrConfigs(opts: {
  state: UIState;
  platform: OwrPlatform;
  threads: string;
  vramMode: OwrVramMode;
}) {
  const { state, platform, threads, vramMode } = opts;
  const modelName = resolveOwrModelName(state);
  const architecture = deduceOwrArchitecture(modelName);
  return {
    ortConfig: buildOrtConfig({ platform, vramMode, threads }),
    manifestConfig: buildOwrManifestConfig({ modelName, architecture, platform, vramMode, state }),
    webInitCode: buildWebInitCode({ modelName, architecture, threads, vramMode }),
    mobileInitCode: buildMobileInitCode({ modelName, architecture, threads }),
  };
}
