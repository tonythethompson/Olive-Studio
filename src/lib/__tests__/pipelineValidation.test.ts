import { describe, it, expect } from "vitest";
import {
  getProviderConflicts,
  coercePassFields,
  sanitizePipelineState,
  isQuantMethodAllowed,
  isConversionFormatAllowed,
  isStructuredPruningAllowed,
  isPeftAllowed,
  isPeftMethodAllowed,
  getAllowedQuantMethods,
  getAllowedConversionFormats,
  getAllowedPeftMethods,
  getAllowedPruningTypes,
  getPipelineValidation,
  applyIssueAutofix,
  mergeUiState,
  commitUiStateUpdate,
  hasProviderCriticalConflicts,
  isProviderCompatibleWithPasses,
  getQuantMethodActivationBlock,
  prepareProviderChange,
} from "@/lib/pipelineValidation";
import { DEFAULT_PASSES } from "@/lib/defaultPasses";
import type { UIState, IHVProvider } from "@/types";

// ─── Helpers ─────────────────────────────────────────────────

function basePasses(overrides?: Partial<UIState["passes"]>): UIState["passes"] {
  return { ...DEFAULT_PASSES, ...overrides };
}

function baseState(overrides?: Partial<UIState>): UIState {
  return {
    modelSource: "huggingface",
    localFiles: [],
    azureModelPath: "",
    hfModelId: "meta-llama/Meta-Llama-3-8B",
    hfDataset: "",
    ihvProvider: "CPUExecutionProvider" as IHVProvider,
    memoryOffload: "gpu_only",
    cudaVersion: "auto",
    cacheDir: "",
    azureStr: "",
    distributedCaching: false,
    activeJobId: null,
    passes: {
      ...DEFAULT_PASSES,
      ...overrides?.passes,
    },
    ...overrides,
  };
}

// ─── isQuantMethodAllowed ─────────────────────────────────────

describe("isQuantMethodAllowed", () => {
  it("allows PTQ on any provider", () => {
    for (const p of [
      "CPUExecutionProvider",
      "CUDAExecutionProvider",
      "QNNExecutionProvider",
    ] as IHVProvider[]) {
      expect(isQuantMethodAllowed("ptq", p)).toBe(true);
    }
  });

  it("allows AWQ only on GPU providers", () => {
    expect(isQuantMethodAllowed("awq", "CUDAExecutionProvider")).toBe(true);
    expect(isQuantMethodAllowed("awq", "ROCMExecutionProvider")).toBe(true);
    expect(isQuantMethodAllowed("awq", "CPUExecutionProvider")).toBe(false);
    expect(isQuantMethodAllowed("awq", "QNNExecutionProvider")).toBe(false);
  });

  it("allows GPTQ only on GPU providers", () => {
    expect(isQuantMethodAllowed("gptq", "CUDAExecutionProvider")).toBe(true);
    expect(isQuantMethodAllowed("gptq", "CPUExecutionProvider")).toBe(false);
  });

  it("allows QAT on all except QNN", () => {
    expect(isQuantMethodAllowed("qat", "CUDAExecutionProvider")).toBe(true);
    expect(isQuantMethodAllowed("qat", "CPUExecutionProvider")).toBe(true);
    expect(isQuantMethodAllowed("qat", "QNNExecutionProvider")).toBe(false);
  });

  it("allows HQQ only on CPU/CUDA", () => {
    expect(isQuantMethodAllowed("hqq", "CUDAExecutionProvider")).toBe(true);
    expect(isQuantMethodAllowed("hqq", "ROCMExecutionProvider")).toBe(false);
    expect(isQuantMethodAllowed("hqq", "CPUExecutionProvider")).toBe(true);
    expect(isQuantMethodAllowed("hqq", "QNNExecutionProvider")).toBe(false);
  });

  it("allows RTN only on CPU/CUDA", () => {
    expect(isQuantMethodAllowed("rtn", "CPUExecutionProvider")).toBe(true);
    expect(isQuantMethodAllowed("rtn", "CUDAExecutionProvider")).toBe(true);
    expect(isQuantMethodAllowed("rtn", "QNNExecutionProvider")).toBe(false);
  });

  it("allows SpinQuant and QuaRot only on GPU providers", () => {
    expect(isQuantMethodAllowed("spinquant", "CUDAExecutionProvider")).toBe(true);
    expect(isQuantMethodAllowed("spinquant", "CPUExecutionProvider")).toBe(false);
    expect(isQuantMethodAllowed("quarot", "CUDAExecutionProvider")).toBe(true);
    expect(isQuantMethodAllowed("quarot", "CPUExecutionProvider")).toBe(false);
  });
});

// ─── isConversionFormatAllowed ────────────────────────────────

describe("isConversionFormatAllowed", () => {
  it("allows ONNX on any provider", () => {
    expect(isConversionFormatAllowed("onnx", "CUDAExecutionProvider")).toBe(true);
    expect(isConversionFormatAllowed("onnx", "CPUExecutionProvider")).toBe(true);
  });

  it("allows OpenVINO only on OpenVINOExecutionProvider", () => {
    expect(isConversionFormatAllowed("openvino", "OpenVINOExecutionProvider")).toBe(true);
    expect(isConversionFormatAllowed("openvino", "CUDAExecutionProvider")).toBe(false);
    expect(isConversionFormatAllowed("openvino", "CPUExecutionProvider")).toBe(false);
  });
});

// ─── Permission helpers ───────────────────────────────────────

describe("isStructuredPruningAllowed", () => {
  it("allows on NVIDIA tensor-core providers", () => {
    expect(isStructuredPruningAllowed("CUDAExecutionProvider")).toBe(true);
    expect(isStructuredPruningAllowed("TensorrtExecutionProvider")).toBe(true);
  });
  it("denies on CPU, QNN", () => {
    expect(isStructuredPruningAllowed("CPUExecutionProvider")).toBe(false);
    expect(isStructuredPruningAllowed("QNNExecutionProvider")).toBe(false);
  });
});

describe("isPeftAllowed", () => {
  it("denies on QNN and OpenVINO, allows on others", () => {
    expect(isPeftAllowed("QNNExecutionProvider")).toBe(false);
    expect(isPeftAllowed("OpenVINOExecutionProvider")).toBe(false);
    expect(isPeftAllowed("CUDAExecutionProvider")).toBe(true);
    expect(isPeftAllowed("CPUExecutionProvider")).toBe(true);
  });
});

describe("isPeftMethodAllowed", () => {
  it("allows QLoRA only on GPU providers", () => {
    expect(isPeftMethodAllowed("qlora", "CUDAExecutionProvider")).toBe(true);
    expect(isPeftMethodAllowed("qlora", "CPUExecutionProvider")).toBe(false);
  });
  it("allows LoRA on any PEFT-allowed provider", () => {
    expect(isPeftMethodAllowed("lora", "CPUExecutionProvider")).toBe(true);
    expect(isPeftMethodAllowed("lora", "CUDAExecutionProvider")).toBe(true);
  });
});

// ─── getAllowed* ──────────────────────────────────────────────

describe("getAllowedQuantMethods", () => {
  it("returns all 8 for CUDA", () => {
    expect(getAllowedQuantMethods("CUDAExecutionProvider")).toEqual([
      "ptq",
      "awq",
      "gptq",
      "qat",
      "hqq",
      "rtn",
      "spinquant",
      "quarot",
    ]);
  });
  it("excludes AWQ, GPTQ, SpinQuant, QuaRot for CPU (keeps ptq, qat, hqq, rtn)", () => {
    expect(getAllowedQuantMethods("CPUExecutionProvider")).toEqual(["ptq", "qat", "hqq", "rtn"]);
  });
  it("excludes AWQ, GPTQ, QAT, SpinQuant, QuaRot, HQQ, RTN for QNN (keeps ptq)", () => {
    expect(getAllowedQuantMethods("QNNExecutionProvider")).toEqual(["ptq"]);
  });
});

describe("getAllowedConversionFormats", () => {
  it("returns both for OpenVINO, only onnx otherwise", () => {
    expect(getAllowedConversionFormats("OpenVINOExecutionProvider")).toEqual(["onnx", "openvino"]);
    expect(getAllowedConversionFormats("CUDAExecutionProvider")).toEqual(["onnx"]);
  });
});

describe("getAllowedPeftMethods", () => {
  it("returns both for GPU, only lora for CPU", () => {
    expect(getAllowedPeftMethods("CUDAExecutionProvider")).toEqual(["lora", "qlora"]);
    expect(getAllowedPeftMethods("CPUExecutionProvider")).toEqual(["lora"]);
  });
});

describe("getAllowedPruningTypes", () => {
  it("returns both for CUDA, unstructured only for CPU", () => {
    expect(getAllowedPruningTypes("CUDAExecutionProvider")).toEqual(["unstructured", "structured"]);
    expect(getAllowedPruningTypes("CPUExecutionProvider")).toEqual(["unstructured"]);
  });
});

// ─── getQuantMethodActivationBlock ─────────────────────────────

describe("getQuantMethodActivationBlock", () => {
  it("returns null when method is not allowed by provider", () => {
    expect(getQuantMethodActivationBlock("awq", basePasses(), "CPUExecutionProvider")).toBeNull();
  });

  it("returns null when method is allowed and no conflicts exist", () => {
    expect(getQuantMethodActivationBlock("awq", basePasses(), "CUDAExecutionProvider")).toBeNull();
  });

  it("returns a reason when QAT + splitting", () => {
    const block = getQuantMethodActivationBlock(
      "qat",
      basePasses({ splitting: true }),
      "CUDAExecutionProvider",
    );
    expect(block).not.toBeNull();
    expect(block!.reason).toContain("QAT conflicts with model splitting");
  });
});

// ─── getProviderConflicts ─────────────────────────────────────

describe("getProviderConflicts", () => {
  it("flags OpenVINO format without OpenVINO EP as critical", () => {
    const c = getProviderConflicts(
      "CUDAExecutionProvider",
      basePasses({ conversion: true, conversionFormat: "openvino" }),
    );
    expect(c.some((x) => x.passKey === "conversionFormat" && x.severity === "critical")).toBe(true);
  });
  it("flags AWQ without GPU as critical", () => {
    const c = getProviderConflicts(
      "CPUExecutionProvider",
      basePasses({ quantization: true, quantMethod: "awq" }),
    );
    expect(c.some((x) => x.passKey === "quantMethod" && x.severity === "critical")).toBe(true);
  });
  it("flags GPTQ without GPU as critical", () => {
    const c = getProviderConflicts(
      "QNNExecutionProvider",
      basePasses({ quantization: true, quantMethod: "gptq" }),
    );
    expect(c.some((x) => x.passKey === "quantMethod")).toBe(true);
  });
  it("flags QAT on QNN as critical", () => {
    const c = getProviderConflicts(
      "QNNExecutionProvider",
      basePasses({ quantization: true, quantMethod: "qat" }),
    );
    expect(c.some((x) => x.passKey === "quantMethod" && x.severity === "critical")).toBe(true);
  });
  it("flags structured pruning on CPU as warning", () => {
    const c = getProviderConflicts(
      "CPUExecutionProvider",
      basePasses({ pruning: true, pruningType: "structured" }),
    );
    expect(c.some((x) => x.passKey === "pruningType" && x.severity === "warning")).toBe(true);
  });
  it("flags PEFT on QNN as critical, on OpenVINO as warning", () => {
    expect(
      getProviderConflicts("QNNExecutionProvider", basePasses({ peft: true })).some(
        (x) => x.passKey === "peft" && x.severity === "critical",
      ),
    ).toBe(true);
    expect(
      getProviderConflicts("OpenVINOExecutionProvider", basePasses({ peft: true })).some(
        (x) => x.passKey === "peft" && x.severity === "warning",
      ),
    ).toBe(true);
  });
  it("flags QLoRA on CPU as warning", () => {
    const c = getProviderConflicts("CPUExecutionProvider", basePasses({ peft: true, peftMethod: "qlora" }));
    expect(c.some((x) => x.passKey === "peftMethod" && x.severity === "warning")).toBe(true);
  });
  it("flags LoRA on CPU as warning", () => {
    const c = getProviderConflicts("CPUExecutionProvider", basePasses({ peft: true, peftMethod: "lora" }));
    expect(c.some((x) => x.passKey === "peft" && x.severity === "warning")).toBe(true);
  });
  it("returns empty array when all compatible on CUDA", () => {
    expect(getProviderConflicts("CUDAExecutionProvider", basePasses())).toEqual([]);
  });
  it("every conflict has a non-empty autofix", () => {
    for (const c of getProviderConflicts(
      "CPUExecutionProvider",
      basePasses({ quantization: true, quantMethod: "awq", pruning: true }),
    )) {
      expect(Object.keys(c.autofix()).length).toBeGreaterThan(0);
    }
  });
});

// ─── prepareProviderChange ──────────────────────────────────────

describe("prepareProviderChange", () => {
  it("returns null when provider is hardware-blocked", () => {
    const state = baseState();
    expect(
      prepareProviderChange(state, "QNNExecutionProvider", {
        probedAt: new Date().toISOString(),
        platform: { os: "linux", arch: "x64", cpuModel: "x86", cpuCores: 8 },
        detectedProviders: ["CPUExecutionProvider"],
        recommendedProvider: "CPUExecutionProvider" as IHVProvider,
        notes: [],
      }),
    ).toBeNull();
  });

  it("returns provider id when no block and no critical conflicts", () => {
    const state = baseState();
    const result = prepareProviderChange(state, "CUDAExecutionProvider", {
      probedAt: new Date().toISOString(),
      platform: { os: "linux", arch: "x64", cpuModel: "x86", cpuCores: 8 },
      nvidia: { gpus: [{ name: "RTX 4090" }] },
      detectedProviders: ["CPUExecutionProvider", "CUDAExecutionProvider"],
      recommendedProvider: "CUDAExecutionProvider" as IHVProvider,
      notes: [],
    });
    expect(result).not.toBeNull();
    expect(result!.ihvProvider).toBe("CUDAExecutionProvider");
  });

  it("autofixes critical conflicts on provider change", () => {
    const state = baseState({ passes: basePasses({ quantization: true, quantMethod: "awq" }) });
    const result = prepareProviderChange(state, "CPUExecutionProvider");
    expect(result).not.toBeNull();
    expect(result!.passes).toBeDefined();
  });
});

// ─── hasProviderCriticalConflicts / isProviderCompatibleWithPasses

describe("hasProviderCriticalConflicts", () => {
  it("detects critical conflicts", () => {
    expect(hasProviderCriticalConflicts("QNNExecutionProvider", basePasses({ peft: true }))).toBe(true);
  });
  it("returns false when only warnings exist", () => {
    expect(hasProviderCriticalConflicts("CPUExecutionProvider", basePasses({ peft: true }))).toBe(false);
  });
});

describe("isProviderCompatibleWithPasses", () => {
  it("false when critical conflicts exist", () => {
    expect(isProviderCompatibleWithPasses("QNNExecutionProvider", basePasses({ peft: true }))).toBe(false);
  });
  it("true when only warnings exist", () => {
    expect(isProviderCompatibleWithPasses("CPUExecutionProvider", basePasses({ peft: true }))).toBe(true);
  });
});

// ─── coercePassFields ─────────────────────────────────────────

describe("coercePassFields", () => {
  it("OpenVINO → ONNX on non-OpenVINO provider", () => {
    expect(
      coercePassFields(
        basePasses({ conversion: true, conversionFormat: "openvino" }),
        "CUDAExecutionProvider",
      ).conversionFormat,
    ).toBe("onnx");
  });
  it("preserves OpenVINO on OpenVINO provider", () => {
    expect(
      coercePassFields(
        basePasses({ conversion: true, conversionFormat: "openvino" }),
        "OpenVINOExecutionProvider",
      ).conversionFormat,
    ).toBe("openvino");
  });
  it("AWQ → PTQ on non-GPU", () => {
    expect(
      coercePassFields(basePasses({ quantization: true, quantMethod: "awq" }), "CPUExecutionProvider")
        .quantMethod,
    ).toBe("ptq");
  });
  it("GPTQ → PTQ on non-GPU", () => {
    expect(
      coercePassFields(basePasses({ quantization: true, quantMethod: "gptq" }), "QNNExecutionProvider")
        .quantMethod,
    ).toBe("ptq");
  });
  it("preserves AWQ on GPU", () => {
    expect(
      coercePassFields(basePasses({ quantization: true, quantMethod: "awq" }), "CUDAExecutionProvider")
        .quantMethod,
    ).toBe("awq");
  });
  it("structured → unstructured on CPU", () => {
    expect(
      coercePassFields(basePasses({ pruning: true, pruningType: "structured" }), "CPUExecutionProvider")
        .pruningType,
    ).toBe("unstructured");
  });
  it("disables PEFT on QNN", () => {
    expect(coercePassFields(basePasses({ peft: true }), "QNNExecutionProvider").peft).toBe(false);
  });
  it("QLoRA → LoRA on non-GPU", () => {
    expect(
      coercePassFields(basePasses({ peft: true, peftMethod: "qlora" }), "CPUExecutionProvider").peftMethod,
    ).toBe("lora");
  });
  it("preserves pruning when AWQ active", () => {
    expect(
      coercePassFields(
        basePasses({ quantization: true, quantMethod: "awq", pruning: true }),
        "CUDAExecutionProvider",
      ).pruning,
    ).toBe(true);
  });
  it("LoRA + INT4 → QLoRA on GPU", () => {
    expect(
      coercePassFields(
        basePasses({ peft: true, peftMethod: "lora", quantization: true, quantPrecision: "int4" }),
        "CUDAExecutionProvider",
      ).peftMethod,
    ).toBe("qlora");
  });
  it("disables splitting when QAT active", () => {
    expect(
      coercePassFields(
        basePasses({ splitting: true, quantization: true, quantMethod: "qat" }),
        "CUDAExecutionProvider",
      ).splitting,
    ).toBe(false);
  });
  it("disables onnxTransforms when OpenVINO active", () => {
    expect(
      coercePassFields(
        basePasses({ conversion: true, conversionFormat: "openvino", onnxTransforms: true }),
        "OpenVINOExecutionProvider",
      ).onnxTransforms,
    ).toBe(false);
  });
  it("bumps pruning + INT4 to INT8", () => {
    expect(
      coercePassFields(
        basePasses({ pruning: true, quantization: true, quantPrecision: "int4" }),
        "CUDAExecutionProvider",
      ).quantPrecision,
    ).toBe("int8");
  });
});

// ─── getPipelineValidation ─────────────────────────────────────

describe("getPipelineValidation", () => {
  it("returns success on clean GPU config", () => {
    const r = getPipelineValidation(baseState({ ihvProvider: "CUDAExecutionProvider" }));
    expect(r.isBlocked).toBe(false);
    expect(r.statusTone).toBe("success");
  });
  it("returns error on config with critical issues", () => {
    const r = getPipelineValidation(
      baseState({ passes: basePasses({ conversion: true, conversionFormat: "openvino" }) }),
    );
    expect(r.isBlocked).toBe(true);
    expect(r.statusTone).toBe("error");
  });
  it("reports correct labels", () => {
    const blocked = getPipelineValidation(
      baseState({ passes: basePasses({ conversion: true, conversionFormat: "openvino" }) }),
    );
    expect(blocked.statusLabel).toMatch(/blocking/);
    const success = getPipelineValidation(baseState({ ihvProvider: "CUDAExecutionProvider" }));
    expect(success.statusLabel).toBe("Recipe validated");
  });
});

// ─── sanitizePipelineState ────────────────────────────────────

describe("sanitizePipelineState", () => {
  it("fixes OpenVINO format on non-OpenVINO EP", () => {
    expect(
      sanitizePipelineState(
        baseState({
          ihvProvider: "CUDAExecutionProvider",
          passes: basePasses({ conversion: true, conversionFormat: "openvino" }),
        }),
      ).passes.conversionFormat,
    ).toBe("onnx");
  });
  it("disables PEFT on QNN", () => {
    expect(
      sanitizePipelineState(
        baseState({ ihvProvider: "QNNExecutionProvider", passes: basePasses({ peft: true }) }),
      ).passes.peft,
    ).toBe(false);
  });
  it("QLoRA → LoRA on CPU", () => {
    expect(
      sanitizePipelineState(
        baseState({
          ihvProvider: "CPUExecutionProvider",
          passes: basePasses({ peft: true, peftMethod: "qlora" }),
        }),
      ).passes.peftMethod,
    ).toBe("lora");
  });
  it("AWQ → PTQ on CPU", () => {
    expect(
      sanitizePipelineState(
        baseState({
          ihvProvider: "CPUExecutionProvider",
          passes: basePasses({ quantization: true, quantMethod: "awq" }),
        }),
      ).passes.quantMethod,
    ).toBe("ptq");
  });
  it("identity on clean GPU config", () => {
    const r = sanitizePipelineState(baseState({ ihvProvider: "CUDAExecutionProvider" }));
    expect(r.passes.conversion).toBe(true);
    expect(r.passes.conversionFormat).toBe("onnx");
  });
  it("resolves critical conflicts via the autofix loop", () => {
    // AWQ + pruning on CPU → both coerced to PTQ and unstructured respectively
    const r = sanitizePipelineState(
      baseState({
        ihvProvider: "CPUExecutionProvider",
        passes: basePasses({
          quantization: true,
          quantMethod: "awq",
          pruning: true,
          pruningType: "structured",
        }),
      }),
    );
    expect(r.passes.quantMethod).toBe("ptq");
    expect(r.passes.pruningType).toBe("unstructured");
  });
});

// ─── applyIssueAutofix / mergeUiState / commitUiStateUpdate ───

describe("applyIssueAutofix", () => {
  it("returns empty object when issue has no autofix", () => {
    const state = baseState();
    const result = applyIssueAutofix(state, {
      id: "test",
      severity: "warning",
      title: "Test",
      description: "Test",
    });
    expect(result).toEqual({});
  });

  it("merges autofix.passes into current passes", () => {
    const state = baseState({ passes: basePasses({ conversion: true }) });
    const result = applyIssueAutofix(state, {
      id: "test",
      severity: "critical",
      title: "Test",
      description: "Test",
      autofix: { passes: { ...state.passes, conversion: false } as UIState["passes"] },
    });
    expect(result.passes).toBeDefined();
    expect(result.passes!.conversion).toBe(false);
  });
});

describe("mergeUiState", () => {
  it("merges top-level fields", () => {
    const m = mergeUiState(baseState({ ihvProvider: "CPUExecutionProvider" }), {
      ihvProvider: "CUDAExecutionProvider",
    });
    expect(m.ihvProvider).toBe("CUDAExecutionProvider");
  });
  it("merges passes shallowly, retaining unmentioned fields", () => {
    const state = baseState({ passes: basePasses({ conversion: false }) });
    const m = mergeUiState(state, { passes: { ...state.passes, conversion: true } });
    expect(m.passes.conversion).toBe(true);
    expect(m.passes.conversionFormat).toBe("onnx");
  });
  it("retains passRecipeOverrides when patch omits the key", () => {
    const state = baseState({
      passRecipeOverrides: {
        OnnxConversion: { output_name: "onnx_model" },
      },
    });
    const m = mergeUiState(state, { hfModelId: "other/model" });
    expect(m.passRecipeOverrides?.OnnxConversion?.output_name).toBe("onnx_model");
  });
  it("clears passRecipeOverrides when patch provides an empty map", () => {
    const state = baseState({
      passRecipeOverrides: {
        OnnxConversion: { output_name: "onnx_model" },
      },
    });
    const m = mergeUiState(state, { passRecipeOverrides: {} });
    expect(m.passRecipeOverrides).toEqual({});
  });
  it("replaces passRecipeOverrides when patch provides a new map", () => {
    const state = baseState({
      passRecipeOverrides: {
        OnnxConversion: { output_name: "onnx_model" },
        OnnxQuantization: { output_name: "quant_model" },
      },
    });
    const m = mergeUiState(state, {
      passRecipeOverrides: {
        OnnxConversion: { config: { use_external_data_format: true } },
      },
    });
    expect(m.passRecipeOverrides?.OnnxConversion?.config?.use_external_data_format).toBe(true);
    expect(m.passRecipeOverrides?.OnnxConversion?.output_name).toBeUndefined();
    expect(m.passRecipeOverrides?.OnnxQuantization).toBeUndefined();
  });
});

describe("commitUiStateUpdate", () => {
  it("sanitizes after merge", () => {
    const n = commitUiStateUpdate(baseState({ ihvProvider: "CUDAExecutionProvider" }), {
      ihvProvider: "CPUExecutionProvider",
      passes: basePasses({ conversion: true, conversionFormat: "openvino" }),
    });
    expect(n.ihvProvider).toBe("CPUExecutionProvider");
    expect(n.passes.conversionFormat).toBe("onnx");
  });
});
