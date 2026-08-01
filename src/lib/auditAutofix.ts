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

/**
 * Removes navigation and `passes.` prefixes from an audit pass path.
 *
 * @param pass - The pass path to normalize
 * @returns The pass path without recognized prefixes
 */
function stripPassPrefix(pass: string): string {
  return pass
    .trim()
    .replace(/^→\s*/, "")
    .replace(/^->\s*/, "")
    .replace(/^passes\./i, "");
}

/**
 * Resolves an audit autofix path to its recognized UI state key.
 *
 * @param pass - The audit autofix path or field name to resolve
 * @returns The corresponding UI state key, or `null` when the path is unrecognized
 */
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

/**
 * Converts a scalar string to a boolean or number when it matches a supported literal; otherwise preserves the string.
 *
 * @param value - The scalar text to convert
 * @returns The corresponding boolean, number, or original string value
 */
function parseScalar(value: string): string | number | boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value.trim() !== "" && !Number.isNaN(Number(value)) && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return Number(value);
  }
  return value;
}

/**
 * Normalizes common floating-point data type names to their canonical forms.
 *
 * @param value - The data type name to normalize
 * @returns The canonical data type name, or the trimmed input when it is not recognized
 */
function normalizeDtype(value: string): string {
  const v = value.trim().toLowerCase().replace(/['"]/g, "");
  if (v === "fp16" || v === "float16" || v === "half") return "float16";
  if (v === "bf16" || v === "bfloat16") return "bfloat16";
  if (v === "fp32" || v === "float32") return "float32";
  return value.trim();
}

/**
 * Normalizes a quantization precision value to a supported representation.
 *
 * @param value - The precision value to normalize
 * @returns The normalized precision, or `null` when the value is unsupported
 */
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

/**
 * Normalizes a quantization method value.
 *
 * @param value - The quantization method to normalize
 * @returns The normalized quantization method, or `null` for an unsupported value
 */
function normalizeQuantMethod(value: string): UIState["passes"]["quantMethod"] | null {
  const v = value.trim().toLowerCase().replace(/['"]/g, "") as UIState["passes"]["quantMethod"];
  return QUANT_METHODS.has(v) ? v : null;
}

const IHV_PROVIDERS = new Set<IHVProvider>([
  "CPUExecutionProvider",
  "CUDAExecutionProvider",
  "TensorrtExecutionProvider",
  "NvTensorRTRTXExecutionProvider",
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
]);
const MEMORY_OFFLOADS = new Set<UIState["memoryOffload"]>(["gpu_only", "auto"]);
const MODEL_SOURCES = new Set<UIState["modelSource"]>(["huggingface", "local", "azure"]);

/**
 * Normalizes an execution provider name to a supported IHV provider identifier.
 *
 * @param value - The provider name or recognized alias
 * @returns The canonical provider identifier, or `null` for an unrecognized value
 */
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
 * Builds a validated `UIState` patch from an audit autofix suggestion.
 *
 * @param autofix - The audit pass and proposed value to apply
 * @param state - The current pass and IHV provider state
 * @returns A partial `UIState` patch, or `null` when the suggestion is unsupported or invalid
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (nextPasses as any)[key] = parseScalar(value);
  }

  return { passes: nextPasses };
}

/**
 * Resolves a JSON autofix object into a partial UI state patch.
 *
 * @param pass - The top-level state field targeted by the autofix
 * @param obj - The JSON fields and values to apply
 * @param state - The current pass configuration used to build the updated patch
 * @returns A partial UI state patch, or `null` when the values are invalid or contain no recognized fields
 */
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
  let touched = false;
  for (const [k, v] of Object.entries(obj)) {
    const canon = canonicalizeAutofixPass(k) ?? (PASS_KEYS.has(k) ? k : null);
    if (!canon || canon.startsWith("__") || TOP_LEVEL.has(canon)) continue;
    if (!PASS_KEYS.has(canon)) continue;
    touched = true;
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (passPatch as any)[canon] = v;
    }
  }

  if (!touched) return null;
  return { passes: { ...state.passes, ...passPatch } };
}

/**
 * Determines whether an audit autofix suggestion can be applied to the UI state.
 *
 * @param autofix - The audit autofix suggestion to validate
 * @returns `true` if the suggestion has a recognized, non-rejected pass and a valid value, `false` otherwise
 */
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
