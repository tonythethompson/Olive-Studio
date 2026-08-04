/**
 * Map Assistant audit autofix { pass, value } onto real UIState patches.
 * Models often emit Olive JSON paths; Apply must not write those as fake pass keys.
 */

import type { IHVProvider, UIState } from "@/types";

export type AuditAutofixInput = { pass: string; value: string };

const TOP_LEVEL = new Set([
  "ihvProvider",
  "cudaVersion",
  "memoryOffload",
  "modelSource",
  "hfModelId",
  "hfDataset",
  "hfTask",
  "cacheDir",
]);

const PASS_KEYS = new Set([
  "conversion",
  "conversionSourceFormat",
  "conversionFormat",
  "conversionOpset",
  "conversionInputTargetTypes",
  "quantization",
  "quantMethod",
  "quantPrecision",
  "quantPreset",
  "gptqBlockSize",
  "gptqDescAct",
  "gptqGroupSize",
  "awqGroupSize",
  "awqDampPercent",
  "awqSym",
  "qatQuantPrecision",
  "qatCalibrateMethod",
  "qatCalibrateSteps",
  "pruning",
  "pruningType",
  "pruningMethod",
  "pruningCriteria",
  "pruningSparsity",
  "splitting",
  "onnxTransforms",
  "peft",
  "peftMethod",
  "diffusionLora",
]);

/** Aliases / Olive recipe paths → UI pass or sentinel keys. */
const PASS_ALIASES: Array<{ pattern: RegExp; key: string }> = [
  { pattern: /input_model_dtype|conversionInputTargetTypes/i, key: "conversionInputTargetTypes" },
  { pattern: /conversion\.?opset|conversionOpset/i, key: "conversionOpset" },
  { pattern: /quant_method|quantMethod/i, key: "quantMethod" },
  { pattern: /quant_precision|quantPrecision/i, key: "quantPrecision" },
  { pattern: /\bint8_quant\b|Int8Quantization/i, key: "__enable_int8_ptq__" },
  { pattern: /\btensor_rt\b|TensorRTPass\b/i, key: "__reject_tensor_rt_pass__" },
  { pattern: /^hfTask$|^(input_model\.)?(config\.)?task$/i, key: "hfTask" },
  // Prefer exact ihvProvider; avoid matching Olive execution_providers arrays.
  { pattern: /^ihvProvider$/i, key: "ihvProvider" },
];

function stripPassPrefix(pass: string): string {
  return pass
    .trim()
    .replace(/^→\s*/, "")
    .replace(/^->\s*/, "")
    .replace(/^passes\./i, "");
}

export function canonicalizeAutofixPass(pass: string): string | null {
  const raw = pass.trim();
  if (!raw) return null;

  if (TOP_LEVEL.has(raw)) return raw;
  if (PASS_KEYS.has(raw)) return raw;

  const stripped = stripPassPrefix(raw);
  if (TOP_LEVEL.has(stripped)) return stripped;
  if (PASS_KEYS.has(stripped)) return stripped;

  for (const { pattern, key } of PASS_ALIASES) {
    if (pattern.test(raw) || pattern.test(stripped)) return key;
  }

  // Last path segment if it is a known UI key.
  const last = stripped.split(".").pop()?.trim() ?? "";
  if (TOP_LEVEL.has(last) || PASS_KEYS.has(last)) return last;

  return null;
}

function parseScalar(value: string): string | number | boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value.trim() !== "" && !Number.isNaN(Number(value)) && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return Number(value);
  }
  return value;
}

const PASS_BOOL_COERCE = new Set([
  "conversion",
  "quantization",
  "pruning",
  "splitting",
  "onnxTransforms",
  "peft",
  "diffusionLora",
  "gptqDescAct",
  "awqSym",
]);

const PASS_STRING_COERCE: Record<string, Set<string>> = {
  conversionSourceFormat: new Set(["pytorch", "tensorflow", "jax"]),
  conversionFormat: new Set(["onnx", "openvino", "qnn", "tensorrt"]),
  conversionInputTargetTypes: new Set(),
  quantMethod: new Set(["ptq", "awq", "qat", "gptq", "hqq", "rtn", "spinquant", "quarot"]),
  quantPrecision: new Set(["int4", "int8", "fp16"]),
  quantPreset: new Set(),
  pruningType: new Set(["structured", "unstructured"]),
  pruningMethod: new Set(["magnitude", "sparsegpt", "wanda"]),
  pruningCriteria: new Set(["l1_norm", "l2_norm"]),
  peftMethod: new Set(["lora", "qlora"]),
  qatQuantPrecision: new Set(["int4", "int8"]),
  qatCalibrateMethod: new Set(["minmax", "percentile", "entropy"]),
};

const PASS_NUMBER_COERCE: Record<string, { min: number; max: number }> = {
  conversionOpset: { min: 13, max: 21 },
  gptqBlockSize: { min: 32, max: 4096 },
  gptqGroupSize: { min: 32, max: 4096 },
  awqGroupSize: { min: 32, max: 4096 },
  awqDampPercent: { min: 0, max: 1 },
  qatCalibrateSteps: { min: 1, max: 10_000 },
  pruningSparsity: { min: 0.01, max: 0.99 },
};

const FREE_PASS_STRING_RE = /^[\w.\-/:+=,\s]+$/i;

/** Coerce a pass field to a safe UI value, or null when the value cannot be applied. */
export function coercePassValue(key: string, raw: unknown): string | number | boolean | null {
  if (PASS_BOOL_COERCE.has(key)) {
    if (typeof raw === "boolean") return raw;
    if (raw === "true" || raw === "false") return raw === "true";
    return null;
  }
  if (key in PASS_NUMBER_COERCE) {
    const n =
      typeof raw === "number"
        ? raw
        : typeof raw === "string" && raw.trim() !== "" && /^-?\d+(\.\d+)?$/.test(raw.trim())
          ? Number(raw.trim())
          : NaN;
    if (!Number.isFinite(n)) return null;
    const range = PASS_NUMBER_COERCE[key]!;
    if (n < range.min || n > range.max) return null;
    return n;
  }
  if (key in PASS_STRING_COERCE) {
    if (typeof raw !== "string" && typeof raw !== "number") return null;
    const trimmed = String(raw).trim();
    if (!trimmed) return null;
    const allowed = PASS_STRING_COERCE[key]!;
    if (allowed.size === 0) {
      if (trimmed.length > 128 || !FREE_PASS_STRING_RE.test(trimmed)) return null;
      return trimmed.slice(0, 128);
    }
    if (trimmed.length > 256) return null;
    return allowed.has(trimmed) ? trimmed : null;
  }
  return null;
}

function normalizeDtype(value: string): string {
  const v = value.trim().toLowerCase().replace(/['"]/g, "");
  if (v === "fp16" || v === "float16" || v === "half") return "float16";
  if (v === "bf16" || v === "bfloat16") return "bfloat16";
  if (v === "fp32" || v === "float32") return "float32";
  return value.trim();
}

function normalizeQuantPrecision(value: string): "int4" | "int8" | "fp16" | null {
  const v = value.trim().toLowerCase().replace(/['"]/g, "");
  if (v === "int4" || v === "4bit") return "int4";
  if (v === "int8" || v === "8bit") return "int8";
  if (v === "fp16" || v === "float16" || v === "half") return "fp16";
  return null;
}

const QUANT_METHODS = new Set<UIState["passes"]["quantMethod"]>([
  "ptq",
  "awq",
  "qat",
  "gptq",
  "hqq",
  "rtn",
  "spinquant",
  "quarot",
]);

function normalizeQuantMethod(value: string): UIState["passes"]["quantMethod"] | null {
  const v = value.trim().toLowerCase().replace(/['"]/g, "") as UIState["passes"]["quantMethod"];
  return QUANT_METHODS.has(v) ? v : null;
}

const IHV_PROVIDERS = new Set<IHVProvider>([
  "CPUExecutionProvider",
  "CUDAExecutionProvider",
  "TensorrtExecutionProvider",
  "NvTensorRTRTXExecutionProvider",
  "DmlExecutionProvider",
  "OpenVINOExecutionProvider",
  "QNNExecutionProvider",
  "ROCMExecutionProvider",
  "WebGpuExecutionProvider",
]);

const CUDA_VERSIONS = new Set<UIState["cudaVersion"]>([
  "auto",
  "cpu",
  "cu118",
  "cu121",
  "cu124",
  "cu126",
  "cu128",
  "cu130",
  "cu132",
]);
const MEMORY_OFFLOADS = new Set<UIState["memoryOffload"]>(["gpu_only", "auto"]);
const MODEL_SOURCES = new Set<UIState["modelSource"]>(["huggingface", "local", "azure"]);

function normalizeIhvProvider(value: string): IHVProvider | null {
  const raw = value.trim();
  if (IHV_PROVIDERS.has(raw as IHVProvider)) return raw as IHVProvider;
  const compact = raw.replace(/\s+/g, "");
  const aliases: Record<string, IHVProvider> = {
    cuda: "CUDAExecutionProvider",
    cudaprovider: "CUDAExecutionProvider",
    cudaexecutionprovider: "CUDAExecutionProvider",
    cpu: "CPUExecutionProvider",
    cpuexecutionprovider: "CPUExecutionProvider",
    tensorrt: "TensorrtExecutionProvider",
    tensorrtexecutionprovider: "TensorrtExecutionProvider",
    nvtensorrtrtx: "NvTensorRTRTXExecutionProvider",
    nvtensorrtrtxexecutionprovider: "NvTensorRTRTXExecutionProvider",
    openvino: "OpenVINOExecutionProvider",
    openvinoexecutionprovider: "OpenVINOExecutionProvider",
    dml: "DmlExecutionProvider",
    directml: "DmlExecutionProvider",
    dmlexecutionprovider: "DmlExecutionProvider",
    qnn: "QNNExecutionProvider",
    qnnexecutionprovider: "QNNExecutionProvider",
    rocm: "ROCMExecutionProvider",
    rocmexecutionprovider: "ROCMExecutionProvider",
    webgpu: "WebGpuExecutionProvider",
    webgpuexecutionprovider: "WebGpuExecutionProvider",
  };
  return aliases[compact.toLowerCase()] ?? null;
}

/**
 * Build a UIState patch for an audit autofix, or null if it cannot be applied safely.
 */
export function resolveAuditAutofix(
  autofix: AuditAutofixInput,
  state: Pick<UIState, "passes" | "ihvProvider">,
): Partial<UIState> | null {
  if (!autofix?.pass) return null;
  const value = String(autofix.value ?? "").trim();
  if (!value) return null;

  // Multi-field JSON: {"quantMethod":"awq","quantPrecision":"int4"}
  if (value.startsWith("{")) {
    try {
      const obj = JSON.parse(value) as Record<string, unknown>;
      return resolveJsonAutofix(autofix.pass, obj, state);
    } catch {
      /* fall through */
    }
  }

  const key = canonicalizeAutofixPass(autofix.pass);
  if (!key) return null;
  if (key === "__reject_tensor_rt_pass__") return null;

  if (key === "__enable_int8_ptq__") {
    return {
      passes: {
        ...state.passes,
        quantization: true,
        quantMethod: "ptq",
        quantPrecision: "int8",
      },
    };
  }

  if (key === "ihvProvider") {
    const provider = normalizeIhvProvider(value);
    return provider ? { ihvProvider: provider } : null;
  }
  if (key === "cudaVersion") {
    const v = value.trim().toLowerCase() as UIState["cudaVersion"];
    return CUDA_VERSIONS.has(v) ? { cudaVersion: v } : null;
  }
  if (key === "memoryOffload") {
    const v = value.trim().toLowerCase() as UIState["memoryOffload"];
    return MEMORY_OFFLOADS.has(v) ? { memoryOffload: v } : null;
  }
  if (key === "modelSource") {
    const v = value.trim().toLowerCase() as UIState["modelSource"];
    return MODEL_SOURCES.has(v) ? { modelSource: v } : null;
  }
  if (key === "hfModelId" || key === "hfDataset" || key === "hfTask" || key === "cacheDir") {
    return { [key]: value };
  }

  // Olive / model shorthand: task → hfTask
  if (key === "task" || /^input_model\.?(config\.)?task$/i.test(autofix.pass)) {
    return { hfTask: value };
  }

  if (!PASS_KEYS.has(key)) return null;

  const nextPasses: UIState["passes"] = { ...state.passes };
  if (key === "conversionInputTargetTypes") {
    nextPasses.conversion = true;
    nextPasses.conversionInputTargetTypes = normalizeDtype(value);
  } else if (key === "quantPrecision") {
    const prec = normalizeQuantPrecision(value);
    if (!prec) return null;
    // fp16 is a conversion dtype, not a quantizer toggle
    if (prec === "fp16") {
      nextPasses.conversion = true;
      nextPasses.conversionInputTargetTypes = "float16";
      nextPasses.quantPrecision = "fp16";
    } else {
      nextPasses.quantization = true;
      nextPasses.quantPrecision = prec;
    }
  } else if (key === "quantMethod") {
    const method = normalizeQuantMethod(value);
    if (!method) return null;
    nextPasses.quantization = true;
    nextPasses.quantMethod = method;
    if (method === "awq") nextPasses.pruning = false;
  } else {
    const coerced = coercePassValue(key, parseScalar(value));
    if (coerced === null) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (nextPasses as any)[key] = coerced;
  }

  return { passes: nextPasses };
}

function resolveJsonAutofix(
  pass: string,
  obj: Record<string, unknown>,
  state: Pick<UIState, "passes" | "ihvProvider">,
): Partial<UIState> | null {
  if (pass === "ihvProvider") {
    const v = obj.ihvProvider;
    if (typeof v !== "string") return null;
    const provider = normalizeIhvProvider(v);
    return provider ? { ihvProvider: provider } : null;
  }
  if (pass === "cudaVersion") {
    const v = obj.cudaVersion;
    if (typeof v !== "string") return null;
    const tag = v.trim().toLowerCase() as UIState["cudaVersion"];
    return CUDA_VERSIONS.has(tag) ? { cudaVersion: tag } : null;
  }
  if (pass === "memoryOffload") {
    const v = obj.memoryOffload;
    if (typeof v !== "string") return null;
    const tag = v.trim().toLowerCase() as UIState["memoryOffload"];
    return MEMORY_OFFLOADS.has(tag) ? { memoryOffload: tag } : null;
  }
  if (pass === "modelSource") {
    const v = obj.modelSource;
    if (typeof v !== "string") return null;
    const tag = v.trim().toLowerCase() as UIState["modelSource"];
    return MODEL_SOURCES.has(tag) ? { modelSource: tag } : null;
  }

  const passPatch: Partial<UIState["passes"]> = {};
  for (const [k, v] of Object.entries(obj)) {
    const canon = canonicalizeAutofixPass(k) ?? (PASS_KEYS.has(k) ? k : null);
    if (!canon || canon.startsWith("__") || TOP_LEVEL.has(canon)) continue;
    if (!PASS_KEYS.has(canon)) continue;
    if (canon === "conversionInputTargetTypes" && typeof v === "string") {
      passPatch.conversion = true;
      passPatch.conversionInputTargetTypes = normalizeDtype(v);
    } else if (canon === "quantPrecision" && typeof v === "string") {
      const prec = normalizeQuantPrecision(v);
      if (prec) {
        if (prec === "fp16") {
          passPatch.conversion = true;
          passPatch.conversionInputTargetTypes = "float16";
          passPatch.quantPrecision = "fp16";
        } else {
          passPatch.quantization = true;
          passPatch.quantPrecision = prec;
        }
      }
    } else if (canon === "quantMethod" && typeof v === "string") {
      const method = normalizeQuantMethod(v);
      if (!method) continue;
      passPatch.quantization = true;
      passPatch.quantMethod = method;
      if (method === "awq") passPatch.pruning = false;
    } else {
      const coerced = coercePassValue(canon, v);
      if (coerced === null) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (passPatch as any)[canon] = coerced;
    }
  }

  if (Object.keys(passPatch).length === 0) return null;
  return { passes: { ...state.passes, ...passPatch } };
}

/** True when Apply can write a real UI field for this suggestion. */
export function isAuditAutofixApplyable(autofix: AuditAutofixInput | undefined | null): boolean {
  if (!autofix?.pass) return false;
  const key = canonicalizeAutofixPass(autofix.pass);
  if (!key || key === "__reject_tensor_rt_pass__") return false;
  if (autofix.value.trim().startsWith("{")) {
    try {
      JSON.parse(autofix.value);
      return true;
    } catch {
      return false;
    }
  }
  return true;
}
