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
    return { ihvProvider: value as IHVProvider };
  }
  if (key === "cudaVersion" || key === "memoryOffload" || key === "modelSource") {
    return { [key]: value } as Partial<UIState>;
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
    nextPasses.quantization = true;
    nextPasses.quantMethod = value as UIState["passes"]["quantMethod"];
    if (value === "awq") nextPasses.pruning = false;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (nextPasses as any)[key] = parseScalar(value);
  }

  return { passes: nextPasses };
}

function resolveJsonAutofix(
  pass: string,
  obj: Record<string, unknown>,
  state: Pick<UIState, "passes" | "ihvProvider">,
): Partial<UIState> | null {
  if (pass === "ihvProvider" || pass === "cudaVersion") {
    const v = obj[pass];
    if (typeof v !== "string") return null;
    return { [pass]: v } as Partial<UIState>;
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
        passPatch.quantization = true;
        passPatch.quantPrecision = prec;
      }
    } else if (canon === "quantMethod" && typeof v === "string") {
      passPatch.quantization = true;
      passPatch.quantMethod = v as UIState["passes"]["quantMethod"];
      if (v === "awq") passPatch.pruning = false;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (passPatch as any)[canon] = v;
    }
  }

  if (!touched) return null;
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
