import { describe, it, expect, beforeAll } from "vitest";
import { kbReady } from "@/lib/schemaEngine";
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
  parseUIStatePayload,
} from "@/lib/pipelineValidation";
import { DEFAULT_PASSES } from "@/lib/defaultPasses";
import type { UIState, IHVProvider } from "@/types";

// ─── Helpers ─────────────────────────────────────────────────

function basePasses(overrides?: Partial<UIState["passes"]>): UIState["passes"] {
  return { ...DEFAULT_PASSES, ...overrides };
}

// Ensure KB is loaded before synchronous validation tests run
beforeAll(async () => {
  await kbReady();
});

function baseState(overrides?: Partial<UIState>): UIState {
  return {
    modelSource: "huggingface",
    localFiles: [],
    azureModelPath: "",
    hfModelId: "meta-llama/Meta-Llama-3-8B",
    hfDataset: "",
    ihvProvider: "CPUExecutionProvider" as IHVProvider,
    openvinoTargetDevice: "CPU",
    memoryOffload: "gpu_only",
    cudaVersion: "auto",
    cacheDir: "",
    azureStr: "",
    distributedCaching: false,
    activeJobId: null,
    ...overrides,
    passes: {
      ...DEFAULT_PASSES,
      ...overrides?.passes,
    },
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
  it("denies on QNN, QNN ABI, and OpenVINO, allows on others", () => {
    expect(isPeftAllowed("QNNExecutionProvider")).toBe(false);
    expect(isPeftAllowed("QnnAbiExecutionProvider")).toBe(false);
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
  it("returns all 9 for CUDA", () => {
    expect(getAllowedQuantMethods("CUDAExecutionProvider")).toEqual([
      "ptq",
      "awq",
      "gptq",
      "qat",
      "hqq",
      "rtn",
      "kquant",
      "spinquant",
      "quarot",
    ]);
  });
  it("excludes AWQ, GPTQ, SpinQuant, QuaRot for CPU (keeps ptq, qat, hqq, rtn, kquant)", () => {
    expect(getAllowedQuantMethods("CPUExecutionProvider")).toEqual(["ptq", "qat", "hqq", "rtn", "kquant"]);
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

  it("can skip hardware block for explicit retry / cross-compile selection", () => {
    const state = baseState({ passes: basePasses({ peft: true }) });
    const blocked = prepareProviderChange(state, "QNNExecutionProvider", {
      probedAt: new Date().toISOString(),
      platform: { os: "linux", arch: "x64", cpuModel: "x86", cpuCores: 8 },
      detectedProviders: ["CPUExecutionProvider"],
      recommendedProvider: "CPUExecutionProvider" as IHVProvider,
      notes: [],
    });
    expect(blocked).toBeNull();
    const allowed = prepareProviderChange(
      state,
      "QNNExecutionProvider",
      {
        probedAt: new Date().toISOString(),
        platform: { os: "linux", arch: "x64", cpuModel: "x86", cpuCores: 8 },
        detectedProviders: ["CPUExecutionProvider"],
        recommendedProvider: "CPUExecutionProvider" as IHVProvider,
        notes: [],
      },
      { skipHardwareBlock: true },
    );
    expect(allowed).not.toBeNull();
    expect(allowed!.ihvProvider).toBe("QNNExecutionProvider");
    expect(allowed!.passes?.peft).toBe(false);
  });

  it("picks OpenVINO GPU target from probe devices when switching to OpenVINO", () => {
    const state = baseState();
    const result = prepareProviderChange(state, "OpenVINOExecutionProvider", {
      probedAt: new Date().toISOString(),
      platform: { os: "linux", arch: "x64", cpuModel: "Intel Core Ultra", cpuCores: 16 },
      openvino: { available: true, loadable: true, version: "2025.1", devices: ["CPU", "GPU", "NPU"] },
      detectedProviders: ["CPUExecutionProvider", "OpenVINOExecutionProvider"],
      recommendedProvider: "OpenVINOExecutionProvider" as IHVProvider,
      notes: [],
    });
    expect(result).toEqual({
      ihvProvider: "OpenVINOExecutionProvider",
      openvinoTargetDevice: "GPU",
    });
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
    const r = getPipelineValidation(baseState({ ihvProvider: "CUDAExecutionProvider", passes: basePasses({ conversion: false }) }));
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
    const success = getPipelineValidation(baseState({ ihvProvider: "CUDAExecutionProvider", passes: basePasses({ conversion: false }) }));
    expect(success.statusLabel).toBe("Local checks passed");
  });

  it("wires QNN readiness errors into Execute Live blocking", () => {
    const probe = {
      probedAt: new Date().toISOString(),
      platform: { os: "linux", arch: "x64", cpuModel: "Intel", cpuCores: 8 },
      detectedProviders: ["CPUExecutionProvider", "QNNExecutionProvider"] as IHVProvider[],
      recommendedProvider: "CPUExecutionProvider" as IHVProvider,
      notes: [],
      qnn: {
        available: false,
        loadable: false,
        preparation: false,
        npuDevice: false,
        potentialInference: false,
        verifiedInference: false,
        hostMode: "out-of-scope" as const,
      },
    };
    const r = getPipelineValidation(baseState({ ihvProvider: "QNNExecutionProvider" }), {
      hardwareProbe: probe,
    });
    expect(r.isBlocked).toBe(true);
    expect(r.issues.some((i) => i.id === "qnn-readiness-qnn_out_of_scope")).toBe(true);
  });

  it("emits a single critical for undetected platform-local Execute Live", () => {
    const probe = {
      probedAt: new Date().toISOString(),
      platform: { os: "linux", arch: "x64", cpuModel: "Intel", cpuCores: 8 },
      detectedProviders: ["CPUExecutionProvider"] as IHVProvider[],
      recommendedProvider: "CPUExecutionProvider" as IHVProvider,
      notes: [],
    };
    const r = getPipelineValidation(baseState({ ihvProvider: "CoreMLExecutionProvider", passes: basePasses({ conversion: false }) }), {
      forLocalExecution: true,
      hardwareProbe: probe,
    });
    const critical = r.issues.filter((i) => i.severity === "critical");
    expect(critical.map((i) => i.id)).toEqual(["platform-local-execution-unavailable"]);
    expect(r.isBlocked).toBe(true);
  });

  it("blocks QNN when runtime is not loadable on Windows ARM64", () => {
    const probe = {
      probedAt: new Date().toISOString(),
      platform: { os: "win32", arch: "arm64", cpuModel: "Snapdragon", cpuCores: 8 },
      detectedProviders: ["CPUExecutionProvider", "QNNExecutionProvider"] as IHVProvider[],
      recommendedProvider: "QNNExecutionProvider" as IHVProvider,
      notes: [],
      qnn: {
        available: true,
        loadable: false,
        preparation: true,
        npuDevice: false,
        potentialInference: true,
        verifiedInference: false,
        hostMode: "local-inference" as const,
      },
    };
    const r = getPipelineValidation(baseState({ ihvProvider: "QNNExecutionProvider" }), {
      hardwareProbe: probe,
    });
    expect(r.isBlocked).toBe(true);
    expect(r.issues.some((i) => i.id === "qnn-readiness-qnn_runtime_missing")).toBe(true);
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
  it("coerces legacy undefined trustRemoteCode to false", () => {
    const r = sanitizePipelineState(
      baseState({
        modelSource: "huggingface",
        passes: { ...basePasses(), trustRemoteCode: undefined as unknown as boolean },
      }),
    );
    expect(r.passes.trustRemoteCode).toBe(false);
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

describe("parseUIStatePayload", () => {
  it("accepts a complete UIState payload", () => {
    const result = parseUIStatePayload(baseState());
    expect(result.ok).toBe(true);
  });

  it("rejects incomplete state objects", () => {
    const result = parseUIStatePayload({
      modelSource: "huggingface",
      ihvProvider: "CPUExecutionProvider",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("passes");
  });
});


// ─── 0.13.0 validation rules ─────────────────────────────────

describe("0.13.0 validation rules", () => {
  describe("QairtPipeline cross-pass rule", () => {
    it("rejects QairtPipeline on non-QNN providers", () => {
      const state = baseState({
        ihvProvider: "CUDAExecutionProvider",
        passes: basePasses({ qairtPipeline: true }),
      });
      const result = getPipelineValidation(state);
      expect(result.issues.some((i) => i.id === "qairt-pipeline-requires-qnn")).toBe(true);
    });

    it("allows QairtPipeline on QNNExecutionProvider", () => {
      const state = baseState({
        ihvProvider: "QNNExecutionProvider",
        passes: basePasses({ qairtPipeline: true }),
      });
      const result = getPipelineValidation(state);
      expect(result.issues.some((i) => i.id === "qairt-pipeline-requires-qnn")).toBe(false);
    });
  });

  describe("SimplifiedLayerNormToRMSNorm cross-pass rule", () => {
    it("rejects SimplifiedLayerNormToRMSNorm on non-QNN providers", () => {
      const state = baseState({
        ihvProvider: "CPUExecutionProvider",
        passes: basePasses({ simplifiedLayerNormToRMSNorm: true }),
      });
      const result = getPipelineValidation(state);
      expect(result.issues.some((i) => i.id === "simplified-layernorm-requires-qnn")).toBe(true);
    });

    it("allows SimplifiedLayerNormToRMSNorm on QnnAbiExecutionProvider", () => {
      const state = baseState({
        ihvProvider: "QnnAbiExecutionProvider" as IHVProvider,
        passes: basePasses({ simplifiedLayerNormToRMSNorm: true }),
      });
      const result = getPipelineValidation(state);
      expect(result.issues.some((i) => i.id === "simplified-layernorm-requires-qnn")).toBe(false);
    });
  });

  describe("replacement export pipelines", () => {
    it("coerces conversion off when MobiusBuilder is enabled", () => {
      const state = baseState({
        passes: basePasses({ mobiusBuilder: true, conversion: true, onnxTransforms: true }),
      });
      const coerced = sanitizePipelineState(state);
      expect(coerced.passes.mobiusBuilder).toBe(true);
      expect(coerced.passes.conversion).toBe(false);
      expect(coerced.passes.onnxTransforms).toBe(false);
    });

    it("does not block validation when MobiusBuilder replaces conversion", () => {
      const state = sanitizePipelineState(
        baseState({
          passes: basePasses({ mobiusBuilder: true, conversion: true }),
        }),
      );
      const result = getPipelineValidation(state);
      expect(result.issues.some((i) => i.id.startsWith("pass-chain-mismatch"))).toBe(false);
      expect(result.issues.some((i) => i.id === "onnx-pipeline-missing-conversion")).toBe(false);
      expect(result.isBlocked).toBe(false);
    });

    it("does not block validation when QairtPipeline replaces conversion on QNN", () => {
      const state = sanitizePipelineState(
        baseState({
          ihvProvider: "QNNExecutionProvider",
          passes: basePasses({ qairtPipeline: true, conversion: true, conversionFormat: "qnn" }),
        }),
      );
      const result = getPipelineValidation(state);
      expect(result.issues.some((i) => i.id.startsWith("pass-chain-mismatch"))).toBe(false);
      // The pipeline may still be blocked on non-Windows platforms due to
      // qnn-readiness-qnn_out_of_scope (QNN is Windows-only). Verify that
      // replacement export pipeline logic itself does not introduce a block.
      const nonPlatformCriticals = result.issues.filter(
        (i) => i.severity === "critical" && i.id !== "qnn-readiness-qnn_out_of_scope",
      );
      expect(nonPlatformCriticals).toHaveLength(0);
      // Assert QairtPipeline coercion worked: conversion and onnxTransforms should be off
      expect(state.passes.qairtPipeline).toBe(true);
      expect(state.passes.conversion).toBe(false);
      expect(state.passes.onnxTransforms).toBe(false);
      // Verify the generated recipe reflects the QairtPipeline pass
      expect(result.recipe.passes).toBeDefined();
      expect(result.recipe.passes?.qairt_pipeline).toBeDefined();
    });
  });

  describe("KQuant provider conflicts", () => {
    it("allows kquant on CPU", () => {
      expect(isQuantMethodAllowed("kquant", "CPUExecutionProvider")).toBe(true);
    });

    it("allows kquant on CUDA", () => {
      expect(isQuantMethodAllowed("kquant", "CUDAExecutionProvider")).toBe(true);
    });

    it("denies kquant on QNN", () => {
      expect(isQuantMethodAllowed("kquant", "QNNExecutionProvider")).toBe(false);
    });
  });

  describe("removed-pass warning (9.3)", () => {
    it("fires for QairtPreparation in passRecipeOverrides", () => {
      const state = baseState({
        passRecipeOverrides: { QairtPreparation: { enabled: true } } as unknown as UIState["passRecipeOverrides"],
      });
      const result = getPipelineValidation(state);
      const issue = result.issues.find((i) => i.id === "removed-pass-QairtPreparation");
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe("warning");
    });

    it("fires for QairtGenAIBuilder in passRecipeOverrides", () => {
      const state = baseState({
        passRecipeOverrides: { QairtGenAIBuilder: { enabled: true } } as unknown as UIState["passRecipeOverrides"],
      });
      const result = getPipelineValidation(state);
      expect(result.issues.some((i) => i.id === "removed-pass-QairtGenAIBuilder")).toBe(true);
    });

    it("fires for MobiusModelBuilder in passRecipeOverrides", () => {
      const state = baseState({
        passRecipeOverrides: { MobiusModelBuilder: { enabled: true } } as unknown as UIState["passRecipeOverrides"],
      });
      const result = getPipelineValidation(state);
      expect(result.issues.some((i) => i.id === "removed-pass-MobiusModelBuilder")).toBe(true);
    });

    it("does not fire for valid pass names", () => {
      const state = baseState({
        passRecipeOverrides: { OnnxConversion: { output_name: "model.onnx" } },
      });
      const result = getPipelineValidation(state);
      expect(result.issues.filter((i) => i.id.startsWith("removed-pass-")).length).toBe(0);
    });
  });

  describe("trust_remote_code advisory (9.4)", () => {
    it("fires when trustRemoteCode is false and modelSource is huggingface", () => {
      const state = baseState({
        modelSource: "huggingface",
        passes: basePasses({ trustRemoteCode: false }),
      });
      const result = getPipelineValidation(state);
      const issue = result.issues.find((i) => i.id === "trust-remote-code-advisory");
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe("info");
    });

    it("does not fire when trustRemoteCode is true", () => {
      const state = baseState({
        modelSource: "huggingface",
        passes: basePasses({ trustRemoteCode: true }),
      });
      const result = getPipelineValidation(state);
      expect(result.issues.some((i) => i.id === "trust-remote-code-advisory")).toBe(false);
    });

    it("does not fire for local model source", () => {
      const state = baseState({
        modelSource: "local",
        passes: basePasses({ trustRemoteCode: false }),
      });
      const result = getPipelineValidation(state);
      expect(result.issues.some((i) => i.id === "trust-remote-code-advisory")).toBe(false);
    });
  });
});
