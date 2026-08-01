import type { PassRecipeOverride, UIState } from "@/types";

/**
 * Flat MCP config keys that map directly onto UIState.passes fields.
 * Nested `engine` / `passes` / `data_configs` shapes from the Olive MCP KB
 * are handled separately below.
 */
export type McpConfigKey =
  | "use_external_data_format"
  | "precision"
  | "quant_mode"
  | "sym"
  | "block_size"
  | "group_size"
  | "damp_percent"
  | "desc_act"
  | "alpha"
  | "cache_dir"
  | "output_dir";

/**
 * Olive pass type names (from MCP KB `updated_config.passes`) → UI pass toggles
 * and related defaults.
 */
const PASS_TYPE_TO_UI: Record<
  string,
  {
    enable?: Partial<UIState["passes"]>;
  }
> = {
  OnnxConversion: {
    enable: { conversion: true, conversionFormat: "onnx" },
  },
  OpenVINOConversion: {
    enable: { conversion: true, conversionFormat: "openvino" },
  },
  QNNConversion: {
    enable: { conversion: true, conversionFormat: "qnn" },
  },
  TensorRTConversion: {
    enable: { conversion: true, conversionFormat: "tensorrt" },
  },
  OnnxQuantization: {
    enable: { quantization: true, quantMethod: "ptq" },
  },
  OnnxStaticQuantization: {
    enable: { quantization: true, quantMethod: "ptq" },
  },
  OnnxHqqQuantization: {
    enable: { quantization: true, quantMethod: "hqq" },
  },
  OnnxBlockWiseRtnQuantization: {
    enable: { quantization: true, quantMethod: "rtn" },
  },
  AutoAWQQuantizer: {
    enable: { quantization: true, quantMethod: "awq" },
  },
  GptqQuantizer: {
    enable: { quantization: true, quantMethod: "gptq" },
  },
  QATQuantizer: {
    enable: { quantization: true, quantMethod: "qat" },
  },
  NVModelOptQuantization: {
    enable: { quantization: true, quantMethod: "awq" },
  },
  OpenVINOQuantization: {
    enable: { quantization: true },
  },
  OpenVINOWeightCompression: {
    enable: { quantization: true, quantPrecision: "int4" },
  },
  QNNQuantization: {
    enable: { quantization: true },
  },
  OrtTransformersOptimization: {
    enable: { onnxTransforms: true },
  },
  OnnxModelOptimizer: {
    enable: { onnxTransforms: true },
  },
  OpenVINOIoUpdate: {
    enable: { onnxTransforms: true },
  },
  QNNPreprocess: {
    enable: { onnxTransforms: true },
  },
  SplitModel: {
    enable: { splitting: true },
  },
  LoRA: {
    enable: { peft: true, peftMethod: "lora" },
  },
  QLoRA: {
    enable: { peft: true, peftMethod: "qlora" },
  },
  SparseGPT: {
    enable: { pruning: true, pruningMethod: "sparsegpt" },
  },
  Wanda: {
    enable: { pruning: true, pruningMethod: "wanda" },
  },
  Prune: {
    enable: { pruning: true, pruningMethod: "magnitude" },
  },
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function mergePassPatch(base: UIState["passes"], patch: Partial<UIState["passes"]>): UIState["passes"] {
  return { ...base, ...patch };
}

/**
 * Map a flat bag of known quant/conversion params onto UIState.passes.
 * Used for top-level keys and for nested `passes.*.params`.
 */
function mapFlatParams(
  params: Record<string, unknown>,
  currentPasses: UIState["passes"],
  patches: Partial<UIState>,
  logs: string[],
): void {
  if ("use_external_data_format" in params) {
    logs.push(
      `[MCP FIX] Applied: use_external_data_format = ${JSON.stringify(params.use_external_data_format)} (stored on conversion pass)`,
    );
  }

  if ("precision" in params && typeof params.precision === "string") {
    const precision = params.precision;
    if (precision === "int4" || precision === "int8" || precision === "fp16") {
      patches.passes = mergePassPatch(patches.passes ?? currentPasses, {
        quantPrecision: precision,
      });
    }
  }

  if ("quant_mode" in params && typeof params.quant_mode === "string") {
    if (params.quant_mode === "static") {
      patches.passes = mergePassPatch(patches.passes ?? currentPasses, {
        quantMethod: "ptq",
      });
    }
  }

  if ("sym" in params && typeof params.sym === "boolean") {
    patches.passes = mergePassPatch(patches.passes ?? currentPasses, {
      awqSym: params.sym,
    });
  }

  if ("block_size" in params && typeof params.block_size === "number") {
    if (params.block_size > 0 && Number.isInteger(params.block_size)) {
      patches.passes = mergePassPatch(patches.passes ?? currentPasses, {
        gptqBlockSize: params.block_size,
      });
    }
  }

  if ("group_size" in params && typeof params.group_size === "number") {
    if (params.group_size > 0 && Number.isInteger(params.group_size)) {
      const method = (patches.passes ?? currentPasses).quantMethod;
      if (method === "gptq") {
        patches.passes = mergePassPatch(patches.passes ?? currentPasses, {
          gptqGroupSize: params.group_size,
        });
      } else if (method === "awq") {
        patches.passes = mergePassPatch(patches.passes ?? currentPasses, {
          awqGroupSize: params.group_size,
        });
      } else {
        patches.passes = mergePassPatch(patches.passes ?? currentPasses, {
          gptqGroupSize: params.group_size,
          awqGroupSize: params.group_size,
        });
      }
    }
  }

  if ("damp_percent" in params && typeof params.damp_percent === "number") {
    if (params.damp_percent >= 0 && params.damp_percent <= 1) {
      patches.passes = mergePassPatch(patches.passes ?? currentPasses, {
        awqDampPercent: params.damp_percent,
      });
    }
  }

  if ("desc_act" in params && typeof params.desc_act === "boolean") {
    patches.passes = mergePassPatch(patches.passes ?? currentPasses, {
      gptqDescAct: params.desc_act,
    });
  }

  if ("alpha" in params) {
    logs.push(
      `[MCP FIX] Note: alpha = ${JSON.stringify(params.alpha)} (LoRA scaling — stored on peft pass if present)`,
    );
  }

  // QAT / static quant calibration knobs
  if ("calibrate_method" in params && typeof params.calibrate_method === "string") {
    const m = params.calibrate_method.toLowerCase();
    if (m === "minmax" || m === "percentile" || m === "entropy") {
      patches.passes = mergePassPatch(patches.passes ?? currentPasses, {
        qatCalibrateMethod: m as "minmax" | "percentile" | "entropy",
      });
    }
  }

  if ("calibrate_steps" in params && typeof params.calibrate_steps === "number") {
    if (params.calibrate_steps > 0 && Number.isInteger(params.calibrate_steps)) {
      patches.passes = mergePassPatch(patches.passes ?? currentPasses, {
        qatCalibrateSteps: params.calibrate_steps,
      });
    }
  }
}

/**
 * Map MCP diagnostic `updated_config` keys to UIState patches.
 *
 * Supports both:
 * - **Flat** keys used by older callers (`precision`, `sym`, …)
 * - **Nested** Olive MCP KB shapes:
 *   `{ engine: { cache_dir }, passes: { OnnxConversion: { output_name, params } } }`
 *
 * Nested pass `params` / `output_name` are stored in `passRecipeOverrides` so
 * `buildOliveRecipe` can emit them on the next run. Without that storage,
 * "Apply Fix" appeared to work (button flip) but changed nothing in the recipe.
 *
 * @param config  The `updated_config` object from an MCP diagnostic response.
 * @param currentPasses  The current `state.passes` to merge into.
 */
export function mapMcpConfigToUiState(
  config: Record<string, unknown>,
  currentPasses: UIState["passes"],
): { patches: Partial<UIState>; logs: string[] } {
  const patches: Partial<UIState> = {};
  const logs: string[] = [];
  const overrides: Record<string, PassRecipeOverride> = {};

  // ── Nested engine.* ───────────────────────────────────────────────────
  if (isRecord(config.engine)) {
    const engine = config.engine;
    if (typeof engine.cache_dir === "string" && engine.cache_dir.trim()) {
      patches.cacheDir = engine.cache_dir.trim();
      logs.push(`[MCP FIX] Applied: engine.cache_dir = ${engine.cache_dir}`);
    }
    if (typeof engine.output_dir === "string" && engine.output_dir.trim()) {
      logs.push(
        `[MCP FIX] Note: engine.output_dir = ${engine.output_dir} (recipe builder uses ./models/optimized; set cache/output paths in Infra if needed)`,
      );
    }
    for (const [k, v] of Object.entries(engine)) {
      if (k === "cache_dir" || k === "output_dir") continue;
      logs.push(`[MCP FIX] Note: engine.${k} = ${JSON.stringify(v)} (no direct UI mapping)`);
    }
  }

  // Top-level cache_dir shorthand
  if (typeof config.cache_dir === "string" && config.cache_dir.trim()) {
    patches.cacheDir = config.cache_dir.trim();
    logs.push(`[MCP FIX] Applied: cache_dir = ${config.cache_dir}`);
  }

  // ── Nested passes.{PassType}.{output_name|params|config} ──────────────
  if (isRecord(config.passes)) {
    for (const [passType, raw] of Object.entries(config.passes)) {
      if (!isRecord(raw)) {
        logs.push(`[MCP FIX] Note: passes.${passType} = ${JSON.stringify(raw)} (skipped)`);
        continue;
      }

      const mapping = PASS_TYPE_TO_UI[passType];
      if (mapping?.enable) {
        patches.passes = mergePassPatch(patches.passes ?? currentPasses, mapping.enable);
        logs.push(
          `[MCP FIX] Enabled/configured UI pass for ${passType}: ${Object.keys(mapping.enable).join(", ")}`,
        );
      }

      const override: PassRecipeOverride = { ...overrides[passType] };

      if (typeof raw.output_name === "string" && raw.output_name.trim()) {
        override.output_name = raw.output_name.trim();
        logs.push(`[MCP FIX] Applied: ${passType}.output_name = ${raw.output_name}`);
      }

      // MCP KB uses both `params` (older Olive style) and `config`
      const params = isRecord(raw.params) ? raw.params : isRecord(raw.config) ? raw.config : null;
      if (params) {
        mapFlatParams(params, patches.passes ?? currentPasses, patches, logs);
        override.config = { ...override.config, ...params };
        logs.push(`[MCP FIX] Stored ${passType} config overrides: ${Object.keys(params).join(", ")}`);
      }

      // Other top-level fields on the pass entry (e.g. disable_search)
      for (const [k, v] of Object.entries(raw)) {
        if (k === "output_name" || k === "params" || k === "config" || k === "type") continue;
        override.config = { ...override.config, [k]: v };
        logs.push(`[MCP FIX] Stored ${passType}.${k} = ${JSON.stringify(v)}`);
      }

      if (override.output_name || (override.config && Object.keys(override.config).length > 0)) {
        overrides[passType] = override;
      } else if (!mapping) {
        logs.push(`[MCP FIX] Note: passes.${passType} has no UI mapping — apply manually if needed`);
      }
    }
  }

  if (Object.keys(overrides).length > 0) {
    patches.passRecipeOverrides = overrides;
  }

  // ── data_configs (log only — no full UI form yet) ─────────────────────
  if (config.data_configs !== undefined) {
    logs.push(
      `[MCP FIX] Note: data_configs present — set Dataset / user script in Input panel if calibration still fails. ${JSON.stringify(config.data_configs).slice(0, 200)}…`,
    );
  }

  // ── Flat top-level keys (legacy / AI-suggested) ───────────────────────
  const flat: Record<string, unknown> = {};
  for (const key of [
    "use_external_data_format",
    "precision",
    "quant_mode",
    "sym",
    "block_size",
    "group_size",
    "damp_percent",
    "desc_act",
    "alpha",
    "calibrate_method",
    "calibrate_steps",
  ] as const) {
    if (key in config) flat[key] = config[key];
  }
  if (Object.keys(flat).length > 0) {
    mapFlatParams(flat, patches.passes ?? currentPasses, patches, logs);
    // Persist external data format on conversion if only flat key was given
    if ("use_external_data_format" in flat) {
      const existing = patches.passRecipeOverrides ?? {};
      patches.passRecipeOverrides = {
        ...existing,
        OnnxConversion: {
          ...existing.OnnxConversion,
          config: {
            ...existing.OnnxConversion?.config,
            use_external_data_format: flat.use_external_data_format,
          },
        },
      };
    }
  }

  return { patches, logs };
}

// ── Known-quirk auto-apply ───────────────────────────────────────────────────

/** Quirk id / title fragments that we can turn into UIState patches. */
export type ActionableQuirkId =
  | "order-convert-first"
  | "order-float16-last"
  | "order-optimize-first"
  | "onnx-external-data"
  | "calib-symmetric"
  | "calib-per-channel"
  | "lora-qlora"
  | "onnx-opset";

const ACTIONABLE_QUIRK_MATCHERS: Array<{
  id: ActionableQuirkId;
  /** Match against quirk title, description, or id (case-insensitive). */
  patterns: string[];
}> = [
  {
    id: "order-convert-first",
    patterns: [
      "order-convert-first",
      "convert before quantize",
      "convert -> optimize -> quantize",
      "require an onnx input",
      "running quantization before onnxconversion",
    ],
  },
  {
    id: "order-float16-last",
    patterns: [
      "order-float16-last",
      "float16 after quantization",
      "onnxfloattofloat16 before",
      "apply fp16 after quantization",
      "destroys the quantized graph",
    ],
  },
  {
    id: "order-optimize-first",
    patterns: [
      "order-optimize-first",
      "graph optimize before quantization",
      "optimize before quantization",
      "onnxmodeloptimizer or orttransformersoptimization before quantization",
    ],
  },
  {
    id: "onnx-external-data",
    patterns: ["onnx-external-data", "external data format", "use_external_data_format", "weights >2gb"],
  },
  {
    id: "calib-symmetric",
    patterns: [
      "calib-symmetric",
      "symmetric vs asymmetric",
      "symmetric quantization",
      "zero point = 0",
      "qnn/coreml prefer symmetric",
    ],
  },
  {
    id: "calib-per-channel",
    patterns: ["calib-per-channel", "per-channel vs per-tensor", "per-channel weights", "per_channel"],
  },
  {
    id: "lora-qlora",
    patterns: ["lora-qlora", "qlora + quantization", "qlora uses a 4-bit base"],
  },
  {
    id: "onnx-opset",
    patterns: ["onnx-opset", "opset version compatibility", "default to 14"],
  },
];

function normalizeQuirkText(q: string): string {
  return q.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Identify which known-quirk ids appear in MCP `relevant_quirks` strings.
 * Quirks may be titles only, "title — description", or include ids.
 */
export function matchActionableQuirks(quirks: string[] | undefined | null): ActionableQuirkId[] {
  if (!quirks?.length) return [];
  const found = new Set<ActionableQuirkId>();
  for (const raw of quirks) {
    const text = normalizeQuirkText(raw);
    for (const m of ACTIONABLE_QUIRK_MATCHERS) {
      if (m.patterns.some((p) => text.includes(p))) {
        found.add(m.id);
      }
    }
  }
  return [...found];
}

export function hasActionableQuirks(quirks: string[] | undefined | null): boolean {
  return matchActionableQuirks(quirks).length > 0;
}

/**
 * Map MCP Known Quirks into UIState patches (pass toggles, dtype, overrides).
 * Safe to call with empty quirks — returns empty patches.
 */
export function mapMcpQuirksToUiState(
  quirks: string[] | undefined | null,
  currentPasses: UIState["passes"],
): { patches: Partial<UIState>; logs: string[]; applied: ActionableQuirkId[]; noted: ActionableQuirkId[] } {
  const patches: Partial<UIState> = {};
  const logs: string[] = [];
  const applied: ActionableQuirkId[] = [];
  const noted: ActionableQuirkId[] = [];
  const matched = matchActionableQuirks(quirks);
  if (matched.length === 0) return { patches, logs, applied, noted };

  let overrides: Record<string, PassRecipeOverride> = {};

  const mergeOverrides = (type: string, ov: PassRecipeOverride) => {
    overrides = {
      ...overrides,
      [type]: {
        ...overrides[type],
        ...ov,
        config: { ...overrides[type]?.config, ...ov.config },
      },
    };
  };

  const passesNow = () => patches.passes ?? currentPasses;

  for (const id of matched) {
    switch (id) {
      case "order-convert-first": {
        // Quant / ONNX graph ops need conversion first
        patches.passes = mergePassPatch(passesNow(), {
          conversion: true,
          conversionFormat: passesNow().conversionFormat || "onnx",
        });
        logs.push(
          "[MCP QUIRK] Convert Before Quantize → enabled Graph Conversion (Convert → Optimize → Quantize order)",
        );
        applied.push(id);
        break;
      }
      case "order-optimize-first": {
        patches.passes = mergePassPatch(passesNow(), {
          onnxTransforms: true,
          // Ensure conversion exists so optimize has an ONNX graph
          conversion: true,
          conversionFormat: passesNow().conversionFormat || "onnx",
        });
        logs.push(
          "[MCP QUIRK] Graph Optimize Before Quantization → enabled ONNX transforms (recipe order: convert → optimize → quantize)",
        );
        applied.push(id);
        break;
      }
      case "order-float16-last": {
        // Don't cast to FP16 before INT quant — keep conversion dtype float32.
        // Pure FP16 models use quantPrecision=fp16 separately.
        const p = passesNow();
        const isIntQuant = p.quantization && (p.quantPrecision === "int4" || p.quantPrecision === "int8");
        const dtype = (p.conversionInputTargetTypes || "").toLowerCase();
        const isFp16DType = dtype.includes("float16") || dtype === "fp16" || dtype.includes("half");
        if (isIntQuant && isFp16DType) {
          patches.passes = mergePassPatch(p, {
            conversionInputTargetTypes: "float32",
          });
          logs.push(
            "[MCP QUIRK] Float16 After Quantization → conversion dtype set to float32 (FP16 before INT quant destroys QDQ)",
          );
          applied.push(id);
        } else if (isIntQuant) {
          logs.push(
            "[MCP QUIRK] Float16 After Quantization → already float32/compatible; recipe keeps FP16 after INT quant only if added later",
          );
          noted.push(id);
        } else {
          logs.push("[MCP QUIRK] Float16 After Quantization → noted (no INT quant active; no dtype change)");
          noted.push(id);
        }
        break;
      }
      case "onnx-external-data": {
        mergeOverrides("OnnxConversion", {
          config: { use_external_data_format: true },
        });
        patches.passes = mergePassPatch(passesNow(), {
          conversion: true,
          conversionFormat: passesNow().conversionFormat || "onnx",
        });
        logs.push("[MCP QUIRK] External Data Format → use_external_data_format=true on OnnxConversion");
        applied.push(id);
        break;
      }
      case "calib-symmetric": {
        patches.passes = mergePassPatch(passesNow(), { awqSym: true });
        mergeOverrides("OnnxQuantization", { config: { symmetric: true } });
        mergeOverrides("OnnxStaticQuantization", { config: { symmetric: true } });
        logs.push("[MCP QUIRK] Symmetric quantization → awqSym=true + symmetric on quant passes");
        applied.push(id);
        break;
      }
      case "calib-per-channel": {
        mergeOverrides("OnnxQuantization", { config: { per_channel: true } });
        mergeOverrides("OnnxStaticQuantization", { config: { per_channel: true } });
        logs.push("[MCP QUIRK] Per-channel quantization → per_channel=true on quant passes");
        applied.push(id);
        break;
      }
      case "lora-qlora": {
        const p = passesNow();
        if (p.peft && p.quantization && p.peftMethod === "lora") {
          patches.passes = mergePassPatch(p, { peftMethod: "qlora" });
          logs.push("[MCP QUIRK] QLoRA + Quantization → switched peftMethod to qlora");
          applied.push(id);
        } else {
          logs.push(
            "[MCP QUIRK] QLoRA + Quantization → noted (enable PEFT + quant with LoRA to auto-switch)",
          );
          noted.push(id);
        }
        break;
      }
      case "onnx-opset": {
        const p = passesNow();
        if (p.conversionOpset > 17 || p.conversionOpset < 13) {
          patches.passes = mergePassPatch(p, { conversionOpset: 14 });
          logs.push("[MCP QUIRK] Opset compatibility → conversionOpset set to 14");
          applied.push(id);
        } else {
          logs.push(
            `[MCP QUIRK] Opset compatibility → current opset ${p.conversionOpset} already in 13–17 range`,
          );
          noted.push(id);
        }
        break;
      }
      default:
        break;
    }
  }

  if (Object.keys(overrides).length > 0) {
    patches.passRecipeOverrides = {
      ...patches.passRecipeOverrides,
      ...overrides,
    };
  }

  return { patches, logs, applied, noted };
}

function mergePartialUiState(a: Partial<UIState>, b: Partial<UIState>): Partial<UIState> {
  const out: Partial<UIState> = { ...a, ...b };
  if (a.passes || b.passes) {
    out.passes = { ...a.passes, ...b.passes } as UIState["passes"];
  }
  if (a.passRecipeOverrides || b.passRecipeOverrides) {
    const types = new Set([
      ...Object.keys(a.passRecipeOverrides ?? {}),
      ...Object.keys(b.passRecipeOverrides ?? {}),
    ]);
    const merged: Record<string, PassRecipeOverride> = {};
    for (const t of types) {
      const left = a.passRecipeOverrides?.[t];
      const right = b.passRecipeOverrides?.[t];
      merged[t] = {
        ...left,
        ...right,
        config: { ...left?.config, ...right?.config },
      };
    }
    out.passRecipeOverrides = merged;
  }
  return out;
}

/**
 * Full Apply Fix: apply nested `updated_config` remedies only.
 *
 * `relevant_quirks` are contextual tips from broad quirk categories (including
 * full category dumps on unmatched errors). They are noted for the user, not
 * auto-applied, so Apply Fix cannot silently rewrite pass order / calibration
 * settings unrelated to the diagnosis.
 *
 * When `currentOverrides` is provided, new `passRecipeOverrides` are merged
 * onto it so sequential Apply Fix calls still accumulate under replace-on-key
 * `mergeUiState` semantics.
 */
export function applyMcpDiagnosticToUiState(
  diagnostic: {
    updated_config?: Record<string, unknown>;
    relevant_quirks?: string[];
  },
  currentPasses: UIState["passes"],
  currentOverrides?: UIState["passRecipeOverrides"],
): {
  patches: Partial<UIState>;
  logs: string[];
  appliedQuirks: ActionableQuirkId[];
  notedQuirks: ActionableQuirkId[];
} {
  const logs: string[] = [];
  let patches: Partial<UIState> = {};

  if (diagnostic.updated_config && Object.keys(diagnostic.updated_config).length > 0) {
    const mapped = mapMcpConfigToUiState(diagnostic.updated_config, currentPasses);
    patches = mergePartialUiState(patches, mapped.patches);
    logs.push(...mapped.logs);
  }

  if (patches.passRecipeOverrides) {
    patches.passRecipeOverrides = mergePartialUiState(
      { passRecipeOverrides: currentOverrides ?? {} },
      { passRecipeOverrides: patches.passRecipeOverrides },
    ).passRecipeOverrides;
  }

  const notedQuirks = matchActionableQuirks(diagnostic.relevant_quirks);
  if (notedQuirks.length > 0) {
    logs.push(
      `[MCP QUIRK] Noted related tip(s) (not auto-applied): ${notedQuirks.join(", ")}. Review Known Quirks manually.`,
    );
  }

  return { patches, logs, appliedQuirks: [], notedQuirks };
}

/**
 * Determines whether a diagnostic contains an enabled configuration remedy that can change pipeline state.
 *
 * @param diagnostic - The diagnostic to evaluate, or `null`.
 * @returns `true` if the diagnostic is applyable and contains at least one updated configuration value, `false` otherwise.
 */
export function canApplyMcpDiagnostic(
  diagnostic: {
    updated_config?: Record<string, unknown>;
    relevant_quirks?: string[];
    applyable?: boolean;
  } | null,
): boolean {
  if (!diagnostic) return false;
  if (diagnostic.applyable === false) return false;
  return !!(diagnostic.updated_config && Object.keys(diagnostic.updated_config).length > 0);
}
