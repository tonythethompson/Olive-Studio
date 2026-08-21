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
  hasSelectedModel,
} from "@/lib/pipelineValidation";
import { DEFAULT_PASSES } from "@/lib/defaultPasses";
import { commitUiStateUpdateShallow as commitLight } from "@/lib/pipelineStateCommit";
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
    expect(isPeftMethodAllowed("qlora", "CoreMLExecutionProvider")).toBe(false);
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
  it("keeps LoRA and disables base quantization when QLoRA is unavailable", () => {
    const passes = coercePassFields(
      basePasses({ peft: true, peftMethod: "lora", quantization: true, quantPrecision: "int4" }),
      "CoreMLExecutionProvider",
    );
    expect(passes.peftMethod).toBe("lora");
    expect(passes.quantization).toBe(false);
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
    const r = getPipelineValidation(
      baseState({ ihvProvider: "CUDAExecutionProvider", passes: basePasses({ conversion: false }) }),
    );
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
    const success = getPipelineValidation(
      baseState({ ihvProvider: "CUDAExecutionProvider", passes: basePasses({ conversion: false }) }),
    );
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
    const r = getPipelineValidation(
      baseState({ ihvProvider: "CoreMLExecutionProvider", passes: basePasses({ conversion: false }) }),
      {
        forLocalExecution: true,
        hardwareProbe: probe,
      },
    );
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

    it("does not block validation when QairtPipeline replaces conversion on QNN ABI", () => {
      const state = sanitizePipelineState(
        baseState({
          ihvProvider: "QnnAbiExecutionProvider",
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
        passRecipeOverrides: {
          QairtPreparation: { enabled: true },
        } as unknown as UIState["passRecipeOverrides"],
      });
      const result = getPipelineValidation(state);
      const issue = result.issues.find((i) => i.id === "removed-pass-QairtPreparation");
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe("warning");
    });

    it("fires for QairtGenAIBuilder in passRecipeOverrides", () => {
      const state = baseState({
        passRecipeOverrides: {
          QairtGenAIBuilder: { enabled: true },
        } as unknown as UIState["passRecipeOverrides"],
      });
      const result = getPipelineValidation(state);
      expect(result.issues.some((i) => i.id === "removed-pass-QairtGenAIBuilder")).toBe(true);
    });

    it("fires for MobiusModelBuilder in passRecipeOverrides", () => {
      const state = baseState({
        passRecipeOverrides: {
          MobiusModelBuilder: { enabled: true },
        } as unknown as UIState["passRecipeOverrides"],
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

  describe("hasSelectedModel", () => {
    it("returns true for non-empty huggingface model", () => {
      const state = baseState({
        modelSource: "huggingface",
        hfModelId: "meta-llama/Meta-Llama-3-8B",
      });
      expect(hasSelectedModel(state)).toBe(true);
    });

    it("returns false for empty huggingface model", () => {
      const state = baseState({
        modelSource: "huggingface",
        hfModelId: "",
      });
      expect(hasSelectedModel(state)).toBe(false);
    });

    it("returns false for whitespace-only huggingface model", () => {
      const state = baseState({
        modelSource: "huggingface",
        hfModelId: "   ",
      });
      expect(hasSelectedModel(state)).toBe(false);
    });

    it("returns true for non-empty local files", () => {
      const state = baseState({
        modelSource: "local",
        localFiles: [{ name: "model.onnx", size: 1024 }],
      });
      expect(hasSelectedModel(state)).toBe(true);
    });

    it("returns false for empty local files when no other source has a model", () => {
      const state = baseState({
        modelSource: "local",
        localFiles: [],
        hfModelId: "",
        azureModelPath: "",
      });
      expect(hasSelectedModel(state)).toBe(false);
    });

    it("returns true for empty local files when a Hugging Face model is still loaded", () => {
      const state = baseState({
        modelSource: "local",
        localFiles: [],
        hfModelId: "microsoft/Phi-3.5-mini-instruct",
      });
      expect(hasSelectedModel(state)).toBe(true);
    });

    it("returns true for non-empty azure path", () => {
      const state = baseState({
        modelSource: "azure",
        azureModelPath: "path/to/model",
      });
      expect(hasSelectedModel(state)).toBe(true);
    });

    it("returns false for empty azure path when no other source has a model", () => {
      const state = baseState({
        modelSource: "azure",
        azureModelPath: "",
        hfModelId: "",
        localFiles: [],
      });
      expect(hasSelectedModel(state)).toBe(false);
    });

    it("returns true for empty azure path when a Hugging Face model is still loaded", () => {
      const state = baseState({
        modelSource: "azure",
        azureModelPath: "",
        hfModelId: "microsoft/Phi-3.5-mini-instruct",
      });
      expect(hasSelectedModel(state)).toBe(true);
    });

    it("returns false for whitespace-only azure path when no other source has a model", () => {
      const state = baseState({
        modelSource: "azure",
        azureModelPath: "  \t  ",
        hfModelId: "",
        localFiles: [],
      });
      expect(hasSelectedModel(state)).toBe(false);
    });
  });

  describe("model-source-not-set issue", () => {
    it("emits critical issue when no model selected", () => {
      const state = baseState({
        modelSource: "huggingface",
        hfModelId: "",
      });
      const result = getPipelineValidation(state);
      const issue = result.issues.find((i) => i.id === "model-source-not-set");
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe("critical");
    });

    it("does not emit issue when model is selected", () => {
      const state = baseState({
        modelSource: "huggingface",
        hfModelId: "meta-llama/Meta-Llama-3-8B",
      });
      const result = getPipelineValidation(state);
      expect(result.issues.some((i) => i.id === "model-source-not-set")).toBe(false);
    });
  });
});

// ─── Commit-path coercion parity ─────────────────────────────────────────────

// Guards against drift between the lightweight commit path
// (pipelineStateCommit.AUTO_COERCE_RULES) and the autoCoerce entries of
// CROSS_PASS_RULES: every silent coercion must fire on commitUiStateUpdate.
describe("commit-path auto-coercion parity", () => {
  it("coerces LoRA + base quant to QLoRA on commit", () => {
    const next = commitLight(baseState({ ihvProvider: "CUDAExecutionProvider" }), {
      passes: basePasses({ peft: true, peftMethod: "lora", quantization: true, quantPrecision: "int8" }),
    });
    expect(next.passes.peftMethod).toBe("qlora");
  });

  it("does not auto-coerce CoreML LoRA + base quant to QLoRA", () => {
    const next = commitLight(baseState({ ihvProvider: "CoreMLExecutionProvider" }), {
      passes: basePasses({ peft: true, peftMethod: "lora", quantization: true, quantPrecision: "int8" }),
    });
    expect(next.passes.peftMethod).toBe("lora");
    expect(next.passes.quantization).toBe(false);
  });

  it("coerces INT4 + pruning to INT8 on commit", () => {
    const next = commitLight(baseState(), {
      passes: basePasses({ pruning: true, quantization: true, quantPrecision: "int4" }),
    });
    expect(next.passes.quantPrecision).toBe("int8");
  });

  it("disables ONNX transforms for OpenVINO conversion on commit", () => {
    const next = commitLight(baseState({ ihvProvider: "OpenVINOExecutionProvider" }), {
      passes: basePasses({ conversion: true, conversionFormat: "openvino", onnxTransforms: true }),
    });
    expect(next.passes.onnxTransforms).toBe(false);
  });

  it("disables splitting when QAT is selected on commit", () => {
    const next = commitLight(baseState(), {
      passes: basePasses({ splitting: true, quantization: true, quantMethod: "qat" }),
    });
    expect(next.passes.splitting).toBe(false);
  });

  it("disables OnnxDiscrepancyCheck alongside QairtPipeline on commit", () => {
    const next = commitLight(baseState({ ihvProvider: "QNNExecutionProvider" }), {
      passes: basePasses({ onnxDiscrepancyCheck: true, qairtPipeline: true }),
    });
    expect(next.passes.onnxDiscrepancyCheck).toBe(false);
  });

  it("disables QairtPipeline on non-QNN providers on commit", () => {
    const next = commitLight(baseState(), { passes: basePasses({ qairtPipeline: true }) });
    expect(next.passes.qairtPipeline).toBe(false);
  });

  it("keeps OnnxDiscrepancyCheck when QairtPipeline is cleared for a non-QNN provider", () => {
    const next = commitLight(baseState(), {
      passes: basePasses({ onnxDiscrepancyCheck: true, qairtPipeline: true }),
    });
    expect(next.passes.qairtPipeline).toBe(false);
    expect(next.passes.onnxDiscrepancyCheck).toBe(true);
  });

  it("normalizes a persisted non-boolean trustRemoteCode to false", () => {
    const next = commitLight(baseState(), {
      passes: basePasses({ trustRemoteCode: "false" as unknown as boolean }),
    });
    expect(next.passes.trustRemoteCode).toBe(false);
  });

  it("keeps QairtPipeline on QNN ABI provider", () => {
    const next = commitLight(baseState({ ihvProvider: "QnnAbiExecutionProvider" }), {
      passes: basePasses({ qairtPipeline: true }),
    });
    expect(next.passes.qairtPipeline).toBe(true);
  });

  it("disables QairtPipeline on QNN plugin provider", () => {
    const next = commitLight(baseState({ ihvProvider: "QNNExecutionProvider" }), {
      passes: basePasses({ qairtPipeline: true }),
    });
    expect(next.passes.qairtPipeline).toBe(false);
  });

  it("enables QairtPipeline when selecting QNN ABI provider", () => {
    const next = commitLight(baseState({ ihvProvider: "QnnAbiExecutionProvider" }), {
      passes: basePasses({ qairtPipeline: false }),
    });
    expect(next.passes.qairtPipeline).toBe(true);
  });

  it("re-enables conversion when selecting QNN plugin provider", () => {
    const next = commitLight(baseState({ ihvProvider: "QNNExecutionProvider" }), {
      passes: basePasses({ conversion: false }),
    });
    expect(next.passes.conversion).toBe(true);
  });

  it("disables conversion and discrepancy check when selecting QNN ABI", () => {
    const next = commitLight(baseState({ ihvProvider: "QnnAbiExecutionProvider" }), {
      passes: basePasses({ conversion: true, onnxDiscrepancyCheck: true }),
    });
    expect(next.passes.conversion).toBe(false);
    expect(next.passes.onnxDiscrepancyCheck).toBe(false);
  });

  it("disables quantization when selecting QNN ABI", () => {
    const next = commitLight(baseState({ ihvProvider: "QnnAbiExecutionProvider" }), {
      passes: basePasses({ quantization: true, quantMethod: "ptq" }),
    });
    expect(next.passes.quantization).toBe(false);
  });

  it("disables SimplifiedLayerNormToRMSNorm on non-QNN providers on commit", () => {
    const next = commitLight(baseState(), { passes: basePasses({ simplifiedLayerNormToRMSNorm: true }) });
    expect(next.passes.simplifiedLayerNormToRMSNorm).toBe(false);
  });

  it("disables MobiusBuilder on QNN providers on commit", () => {
    const next = commitLight(baseState({ ihvProvider: "QNNExecutionProvider" }), {
      passes: basePasses({ mobiusBuilder: true }),
    });
    expect(next.passes.mobiusBuilder).toBe(false);
  });

  it("keeps MobiusBuilder on CPU/CUDA providers", () => {
    for (const provider of ["CPUExecutionProvider", "CUDAExecutionProvider"] as IHVProvider[]) {
      const next = commitLight(baseState({ ihvProvider: provider }), {
        passes: basePasses({ mobiusBuilder: true }),
      });
      expect(next.passes.mobiusBuilder).toBe(true);
    }
  });
});

// ─── CoreML validation rules (Property Tests) ─────────────────────────────────

describe("CoreML validation rules", () => {
  /**
   * Property 6: CoreML blocks GPU-only quantization methods
   *
   * For any quant method in {awq, gptq, spinquant, quarot},
   * isQuantMethodAllowed(method, "CoreMLExecutionProvider") SHALL return false.
   *
   * **Validates: Requirements 4.1, 4.2, 4.3, 4.4**
   */
  describe("Property 6: CoreML blocks GPU-only quantization methods", () => {
    const gpuOnlyMethods = ["awq", "gptq", "spinquant", "quarot"] as const;

    for (const method of gpuOnlyMethods) {
      it(`blocks ${method} on CoreMLExecutionProvider`, () => {
        expect(isQuantMethodAllowed(method, "CoreMLExecutionProvider")).toBe(false);
      });
    }
  });

  /**
   * Property 7: CoreML auto-coerces blocked quantization methods
   *
   * For any pipeline state where ihvProvider is CoreMLExecutionProvider,
   * quantization is true, and quantMethod is in {awq, gptq, spinquant, quarot},
   * getProviderConflicts SHALL return at least one conflict with severity === "critical"
   * and an autofix function that produces { quantMethod: "ptq" }.
   *
   * **Validates: Requirements 4.5**
   */
  describe("Property 7: CoreML auto-coerces blocked quantization methods", () => {
    const blockedMethods = ["awq", "gptq", "spinquant", "quarot"] as const;

    for (const method of blockedMethods) {
      it(`returns a critical conflict with autofix → ptq for ${method} on CoreML`, () => {
        const conflicts = getProviderConflicts(
          "CoreMLExecutionProvider",
          basePasses({ quantization: true, quantMethod: method }),
        );
        const quantConflicts = conflicts.filter(
          (c) => c.passKey === "quantMethod" && c.severity === "critical",
        );
        expect(quantConflicts.length).toBeGreaterThanOrEqual(1);

        // Verify autofix coerces to ptq
        const autofix = quantConflicts[0].autofix();
        expect(autofix.quantMethod).toBe("ptq");
      });
    }
  });

  /**
   * Property 8: CoreML allows CPU-compatible quantization and fine-tuning methods
   *
   * For any quant method in {ptq, rtn, kquant, qat, hqq},
   * isQuantMethodAllowed(method, "CoreMLExecutionProvider") SHALL return true.
   * Additionally, isPeftAllowed("CoreMLExecutionProvider") SHALL return true,
   * LoRA SHALL remain available, and QLoRA SHALL remain blocked because CoreML
   * is an inference EP rather than a supported QLoRA training backend.
   *
   * **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7**
   */
  describe("Property 8: CoreML allows CPU-compatible quantization and fine-tuning methods", () => {
    const allowedQuantMethods = ["ptq", "rtn", "kquant", "qat", "hqq"] as const;

    for (const method of allowedQuantMethods) {
      it(`allows ${method} on CoreMLExecutionProvider`, () => {
        expect(isQuantMethodAllowed(method, "CoreMLExecutionProvider")).toBe(true);
      });
    }

    it("allows PEFT on CoreMLExecutionProvider", () => {
      expect(isPeftAllowed("CoreMLExecutionProvider")).toBe(true);
    });

    it("allows LoRA but blocks QLoRA on CoreMLExecutionProvider", () => {
      expect(isPeftMethodAllowed("lora", "CoreMLExecutionProvider")).toBe(true);
      expect(isPeftMethodAllowed("qlora", "CoreMLExecutionProvider")).toBe(false);
      expect(getAllowedPeftMethods("CoreMLExecutionProvider")).toEqual(["lora"]);
    });

    it("coerces explicit CoreML QLoRA to LoRA", () => {
      const passes = coercePassFields(
        basePasses({ peft: true, peftMethod: "qlora" }),
        "CoreMLExecutionProvider",
      );
      expect(passes.peftMethod).toBe("lora");
    });

    it("reports explicit CoreML QLoRA as a critical provider conflict", () => {
      const conflicts = getProviderConflicts(
        "CoreMLExecutionProvider",
        basePasses({ peft: true, peftMethod: "qlora" }),
      );
      expect(conflicts).toEqual(
        expect.arrayContaining([expect.objectContaining({ passKey: "peftMethod", severity: "critical" })]),
      );
    });
  });
});

import * as fc from "fast-check";

/* Feature: ep-expansion-pack, Property 6: oneDNN Incompatible Pass Conflict Detection */

/**
 * Property 6: oneDNN Incompatible Pass Conflict Detection
 *
 * For any UIState where ihvProvider is "DnnlExecutionProvider" and any of
 * {conversionFormat: "openvino", qairtPipeline: true, simplifiedLayerNormToRMSNorm: true,
 * TensorRT-gated passes (conversionFormat: "tensorrt"), mobiusBuilder: true} is enabled,
 * getProviderConflicts() SHALL return at least one HardwareConflict entry with severity: "critical".
 *
 * **Validates: Requirements 8.2**
 */
describe("Property 6: oneDNN Incompatible Pass Conflict Detection", () => {
  /**
   * Arbitrary that generates a passes object with at least one incompatible flag set
   * for DnnlExecutionProvider. Each incompatible flag is independently toggled on/off,
   * but at least one must be enabled.
   */
  const arbIncompatibleDnnlPasses = fc
    .record({
      openvinoConversion: fc.boolean(),
      qairtPipeline: fc.boolean(),
      simplifiedLayerNormToRMSNorm: fc.boolean(),
      tensorrtConversion: fc.boolean(),
      mobiusBuilder: fc.boolean(),
    })
    .filter(
      (flags) =>
        flags.openvinoConversion ||
        flags.qairtPipeline ||
        flags.simplifiedLayerNormToRMSNorm ||
        flags.tensorrtConversion ||
        flags.mobiusBuilder,
    )
    .map((flags) => {
      const overrides: Partial<UIState["passes"]> = {};

      if (flags.openvinoConversion) {
        overrides.conversion = true;
        overrides.conversionFormat = "openvino";
      }
      if (flags.tensorrtConversion) {
        overrides.conversion = true;
        overrides.conversionFormat = "tensorrt";
      }
      if (flags.qairtPipeline) {
        overrides.qairtPipeline = true;
      }
      if (flags.simplifiedLayerNormToRMSNorm) {
        overrides.simplifiedLayerNormToRMSNorm = true;
      }
      if (flags.mobiusBuilder) {
        overrides.mobiusBuilder = true;
      }

      return basePasses(overrides);
    });

  it("detects at least one critical conflict for any incompatible pass combination", () => {
    fc.assert(
      fc.property(arbIncompatibleDnnlPasses, (passes) => {
        const conflicts = getProviderConflicts("DnnlExecutionProvider", passes);
        const criticalConflicts = conflicts.filter((c) => c.severity === "critical");
        expect(criticalConflicts.length).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 100 },
    );
  });

  it("each critical conflict has a non-empty reason and autofix", () => {
    fc.assert(
      fc.property(arbIncompatibleDnnlPasses, (passes) => {
        const conflicts = getProviderConflicts("DnnlExecutionProvider", passes);
        const criticalConflicts = conflicts.filter((c) => c.severity === "critical");
        for (const conflict of criticalConflicts) {
          expect(conflict.reason).toBeTruthy();
          expect(conflict.autofix).toBeInstanceOf(Function);
          const fix = conflict.autofix();
          expect(Object.keys(fix).length).toBeGreaterThanOrEqual(1);
        }
      }),
      { numRuns: 100 },
    );
  });
});


// ─────────────────────────────────────────────────────────────────────────────

/* Feature: ep-expansion-pack, Property 5: MIGraphX Compatible Pass Allowance */

/**
 * Property 5: MIGraphX Compatible Pass Allowance
 *
 * For any UIState where ihvProvider is "MIGraphXExecutionProvider" and passes
 * are limited to the compatible set {OnnxConversion with format "onnx",
 * OnnxFloatToFloat16, OnnxStaticQuantization, OnnxModelOptimizer, AWQ, GPTQ,
 * SpinQuant, QuaRot, HQQ}, getProviderConflicts() SHALL return zero
 * HardwareConflict entries for those passes.
 *
 * **Validates: Requirements 4.3**
 */
describe("Property 5: MIGraphX Compatible Pass Allowance", () => {
  // Compatible quantization methods for MIGraphX
  const MIGRAPHX_COMPATIBLE_QUANT_METHODS = [
    "ptq",
    "awq",
    "gptq",
    "spinquant",
    "quarot",
    "hqq",
  ] as const;

  // Arbitrary: generates a random subset of compatible pass configurations for MIGraphX.
  // None of these should produce conflicts.
  const arbMigraphxCompatiblePasses = fc
    .record({
      conversion: fc.boolean(),
      quantization: fc.boolean(),
      quantMethod: fc.constantFrom(...MIGRAPHX_COMPATIBLE_QUANT_METHODS),
      quantPrecision: fc.constantFrom("int4" as const, "int8" as const, "fp16" as const),
      onnxTransforms: fc.boolean(),
      pruning: fc.boolean(),
      peft: fc.boolean(),
      peftMethod: fc.constantFrom("lora" as const, "qlora" as const),
    })
    .map((cfg) => {
      return basePasses({
        // OnnxConversion with format "onnx" only (never openvino or tensorrt)
        conversion: cfg.conversion,
        conversionFormat: "onnx",
        // Quantization with only MIGraphX-compatible methods
        quantization: cfg.quantization,
        quantMethod: cfg.quantMethod,
        quantPrecision: cfg.quantPrecision,
        // OnnxModelOptimizer
        onnxTransforms: cfg.onnxTransforms,
        // Pruning: only unstructured (structured would emit a warning)
        pruning: cfg.pruning,
        pruningType: "unstructured",
        // PEFT: allowed on MIGraphX (GPU provider)
        peft: cfg.peft,
        peftMethod: cfg.peftMethod,
        // Ensure incompatible flags are OFF
        qairtPipeline: false,
        simplifiedLayerNormToRMSNorm: false,
        mobiusBuilder: false,
      });
    });

  it("returns zero HardwareConflict entries for any subset of compatible passes", () => {
    fc.assert(
      fc.property(arbMigraphxCompatiblePasses, (passes) => {
        const conflicts = getProviderConflicts("MIGraphXExecutionProvider", passes);
        expect(conflicts).toHaveLength(0);
      }),
      { numRuns: 200 },
    );
  });
});


/* Feature: ep-expansion-pack, Property 7: oneDNN GPU Quantization Method Blocking */

/**
 * Property 7: oneDNN GPU Quantization Method Blocking
 *
 * For any PyTorch-native GPU quantization method in {awq, gptq, hqq, spinquant, quarot}
 * combined with DnnlExecutionProvider, isQuantMethodAllowed(method, "DnnlExecutionProvider")
 * SHALL return false.
 *
 * oneDNN targets Intel CPUs and does not support GPU-native quantization workflows.
 * Only OnnxStaticQuantization (INT8) is valid for this provider.
 *
 * **Validates: Requirements 8.5**
 */
describe("Property 7: oneDNN GPU Quantization Method Blocking", () => {
  const PYTORCH_GPU_QUANT_METHODS = ["awq", "gptq", "hqq", "spinquant", "quarot"] as const;

  const arbBlockedQuantMethod = fc.constantFrom(...PYTORCH_GPU_QUANT_METHODS);

  it("blocks all PyTorch-native GPU quant methods on DnnlExecutionProvider", () => {
    fc.assert(
      fc.property(arbBlockedQuantMethod, (method) => {
        expect(isQuantMethodAllowed(method, "DnnlExecutionProvider")).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("each blocked method individually returns false", () => {
    for (const method of PYTORCH_GPU_QUANT_METHODS) {
      expect(isQuantMethodAllowed(method, "DnnlExecutionProvider")).toBe(false);
    }
  });
});


/* Feature: ep-expansion-pack, Property 8: QNN ABI Selection Coercion Invariant */

/**
 * Property 8: QNN ABI Selection Coercion Invariant
 *
 * For any random initial pass state, when commitUiStateUpdate() is applied with
 * ihvProvider: "QnnAbiExecutionProvider", the resulting state SHALL have:
 *   - qairtPipeline: true (auto-enabled, single-pass workflow)
 *   - conversion: false (QairtPipeline replaces OnnxConversion)
 *   - onnxDiscrepancyCheck: false (no ONNX graph to compare)
 *
 * This validates that the QNN ABI auto-coercion rules fire consistently
 * regardless of the initial pass configuration.
 *
 * **Validates: Requirements 9.5**
 */
describe("Property 8: QNN ABI Selection Coercion Invariant", () => {
  /**
   * Arbitrary that generates random pass configurations covering all pass toggles.
   * This intentionally enables conflicting pass combinations to prove that
   * the coercion always resolves to the expected QNN ABI state invariants.
   */
  const arbRandomPasses = fc
    .record({
      conversion: fc.boolean(),
      conversionFormat: fc.constantFrom("onnx" as const, "openvino" as const, "tensorrt" as const),
      quantization: fc.boolean(),
      quantMethod: fc.constantFrom(
        "ptq" as const,
        "awq" as const,
        "gptq" as const,
        "qat" as const,
        "hqq" as const,
        "rtn" as const,
        "spinquant" as const,
        "quarot" as const,
      ),
      quantPrecision: fc.constantFrom("int4" as const, "int8" as const, "fp16" as const),
      pruning: fc.boolean(),
      pruningType: fc.constantFrom("unstructured" as const, "structured" as const),
      onnxTransforms: fc.boolean(),
      peft: fc.boolean(),
      peftMethod: fc.constantFrom("lora" as const, "qlora" as const),
      mobiusBuilder: fc.boolean(),
      qairtPipeline: fc.boolean(),
      simplifiedLayerNormToRMSNorm: fc.boolean(),
      onnxDiscrepancyCheck: fc.boolean(),
      splitting: fc.boolean(),
      trustRemoteCode: fc.boolean(),
    })
    .map((cfg) =>
      basePasses({
        conversion: cfg.conversion,
        conversionFormat: cfg.conversionFormat,
        quantization: cfg.quantization,
        quantMethod: cfg.quantMethod,
        quantPrecision: cfg.quantPrecision,
        pruning: cfg.pruning,
        pruningType: cfg.pruningType,
        onnxTransforms: cfg.onnxTransforms,
        peft: cfg.peft,
        peftMethod: cfg.peftMethod,
        mobiusBuilder: cfg.mobiusBuilder,
        qairtPipeline: cfg.qairtPipeline,
        simplifiedLayerNormToRMSNorm: cfg.simplifiedLayerNormToRMSNorm,
        onnxDiscrepancyCheck: cfg.onnxDiscrepancyCheck,
        splitting: cfg.splitting,
        trustRemoteCode: cfg.trustRemoteCode,
      }),
    );

  it("coerces qairtPipeline to true, conversion to false, and onnxDiscrepancyCheck to false after QNN ABI selection", () => {
    fc.assert(
      fc.property(arbRandomPasses, (passes) => {
        const initial = baseState({ passes });
        const committed = commitUiStateUpdate(initial, {
          ihvProvider: "QnnAbiExecutionProvider",
        });

        // QNN ABI must always enable the QairtPipeline single-pass workflow
        expect(committed.passes.qairtPipeline).toBe(true);
        // QNN ABI replaces OnnxConversion — must be disabled
        expect(committed.passes.conversion).toBe(false);
        // No ONNX graph comparison available with QairtPipeline
        expect(committed.passes.onnxDiscrepancyCheck).toBe(false);
      }),
      { numRuns: 150 },
    );
  });

  it("coercion holds when starting from a state that already has QnnAbiExecutionProvider", () => {
    fc.assert(
      fc.property(arbRandomPasses, (passes) => {
        // Simulate applying random passes to an already-selected QNN ABI state
        const initial = baseState({
          ihvProvider: "QnnAbiExecutionProvider",
          passes,
        });
        const committed = commitUiStateUpdate(initial, {});

        expect(committed.passes.qairtPipeline).toBe(true);
        expect(committed.passes.conversion).toBe(false);
        expect(committed.passes.onnxDiscrepancyCheck).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});


// ─────────────────────────────────────────────────────────────────────────────

/* Feature: ep-expansion-pack, Property 9: QNN Plugin Selection Inverse Coercion */

/**
 * Property 9: QNN Plugin Selection Inverse Coercion
 *
 * For any initial pass state where qairtPipeline is true, when
 * commitUiStateUpdateShallow() is called with ihvProvider: "QNNExecutionProvider",
 * the resulting state SHALL have qairtPipeline: false.
 *
 * This guarantees that selecting the multi-pass QNN plugin workflow always
 * disables the single-pass QairtPipeline, regardless of what other passes
 * are configured.
 *
 * **Validates: Requirements 9.6**
 */
describe("Property 9: QNN Plugin Selection Inverse Coercion", () => {
  /**
   * Arbitrary that generates random UIState pass configurations with
   * qairtPipeline forced to true, simulating a state that was previously
   * using QNN ABI or had qairtPipeline manually enabled.
   */
  const arbPassesWithQairtEnabled = fc
    .record({
      conversion: fc.boolean(),
      conversionSourceFormat: fc.constantFrom("pytorch" as const, "tensorflow" as const, "jax" as const),
      conversionFormat: fc.constantFrom("onnx" as const, "openvino" as const, "qnn" as const, "tensorrt" as const),
      conversionOpset: fc.integer({ min: 11, max: 21 }),
      conversionInputTargetTypes: fc.constantFrom("float32", "float16"),
      quantization: fc.boolean(),
      quantMethod: fc.constantFrom("ptq" as const, "awq" as const, "gptq" as const, "hqq" as const, "rtn" as const, "kquant" as const, "spinquant" as const, "quarot" as const, "qat" as const),
      quantPrecision: fc.constantFrom("int4" as const, "int8" as const, "fp16" as const),
      gptqBlockSize: fc.constantFrom(32, 64, 128),
      gptqDescAct: fc.boolean(),
      gptqGroupSize: fc.constantFrom(32, 64, 128),
      awqGroupSize: fc.constantFrom(32, 64, 128),
      awqDampPercent: fc.constantFrom(0.01, 0.05),
      awqSym: fc.boolean(),
      qatQuantPrecision: fc.constantFrom("int4" as const, "int8" as const),
      qatCalibrateMethod: fc.constantFrom("minmax" as const, "percentile" as const, "entropy" as const),
      qatCalibrateSteps: fc.integer({ min: 1, max: 50 }),
      quantPreset: fc.constantFrom("", "default", "aggressive"),
      pruning: fc.boolean(),
      pruningSparsity: fc.double({ min: 0.1, max: 0.9 }),
      pruningType: fc.constantFrom("structured" as const, "unstructured" as const),
      pruningMethod: fc.constantFrom("magnitude" as const, "sparsegpt" as const, "wanda" as const),
      pruningCriteria: fc.constantFrom("l1_norm" as const, "l2_norm" as const),
      splitting: fc.boolean(),
      onnxTransforms: fc.boolean(),
      peft: fc.boolean(),
      peftMethod: fc.constantFrom("lora" as const, "qlora" as const),
      diffusionLora: fc.boolean(),
      trustRemoteCode: fc.boolean(),
      mobiusBuilder: fc.boolean(),
      quantizeEmbeddingInt8: fc.boolean(),
      shareEmbeddingLmHead: fc.boolean(),
      simplifiedLayerNormToRMSNorm: fc.boolean(),
      onnxDiscrepancyCheck: fc.boolean(),
    })
    .map((fields) => ({
      ...fields,
      // Force qairtPipeline to true — the precondition for this property
      qairtPipeline: true,
    }));

  it("disables qairtPipeline when QNNExecutionProvider is selected", () => {
    fc.assert(
      fc.property(arbPassesWithQairtEnabled, (passes) => {
        const prev: UIState = {
          modelSource: "huggingface",
          localFiles: [],
          azureModelPath: "",
          hfModelId: "",
          hfDataset: "",
          ihvProvider: "QnnAbiExecutionProvider", // starting from QNN ABI (realistic scenario)
          openvinoTargetDevice: "CPU",
          memoryOffload: "gpu_only",
          cudaVersion: "auto",
          cacheDir: "",
          azureStr: "",
          distributedCaching: false,
          activeJobId: null,
          passes,
        };

        // Simulate selecting QNNExecutionProvider (multi-pass plugin workflow)
        const result = commitLight(prev, { ihvProvider: "QNNExecutionProvider" });

        // qairtPipeline MUST be disabled for the multi-pass plugin workflow
        expect(result.passes.qairtPipeline).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("disables qairtPipeline regardless of other pass states", () => {
    // Complementary check: even with all passes enabled, qairtPipeline is coerced off
    const allPassesOn = basePasses({
      qairtPipeline: true,
      conversion: true,
      quantization: true,
      pruning: true,
      splitting: true,
      onnxTransforms: true,
      peft: true,
      mobiusBuilder: true,
      simplifiedLayerNormToRMSNorm: true,
      onnxDiscrepancyCheck: true,
    });

    const prev: UIState = {
      modelSource: "huggingface",
      localFiles: [],
      azureModelPath: "",
      hfModelId: "",
      hfDataset: "",
      ihvProvider: "QnnAbiExecutionProvider",
      openvinoTargetDevice: "CPU",
      memoryOffload: "gpu_only",
      cudaVersion: "auto",
      cacheDir: "",
      azureStr: "",
      distributedCaching: false,
      activeJobId: null,
      passes: allPassesOn,
    };

    const result = commitLight(prev, { ihvProvider: "QNNExecutionProvider" });
    expect(result.passes.qairtPipeline).toBe(false);
  });
});
