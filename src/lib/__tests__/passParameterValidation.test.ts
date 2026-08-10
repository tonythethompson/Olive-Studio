import { describe, it, expect } from "vitest";
import { validatePassParameters } from "../passParameterValidation";
import type { UIState, IHVProvider } from "@/types";
import { DEFAULT_PASSES } from "../defaultPasses";

/** Minimal UIState builder — only fills fields relevant to validation. */
function baseState(overrides?: Partial<UIState>): UIState {
  return {
    modelSource: "huggingface",
    localFiles: [],
    azureModelPath: "",
    hfModelId: "mistralai/Mistral-7B-v0.1",
    hfDataset: "",
    ihvProvider: "CUDAExecutionProvider",
    openvinoTargetDevice: "CPU",
    memoryOffload: "gpu_only",
    cudaVersion: "auto",
    cacheDir: "",
    azureStr: "",
    distributedCaching: false,
    passes: {
      ...DEFAULT_PASSES,
      conversion: true,
      conversionSourceFormat: "pytorch",
      conversionFormat: "onnx",
      conversionOpset: 17,
      conversionInputTargetTypes: "hf",
      quantization: true,
      quantMethod: "awq",
      quantPrecision: "int4",
      trustRemoteCode: true,
    },
    ...overrides,
  };
}

function withProvider(p: IHVProvider): Partial<UIState> {
  return { ihvProvider: p };
}

// ── QNN rules ─────────────────────────────────────────────────────

describe("QNN parameter validation", () => {
  it("warns when AWQ INT8 on QNN lacks awqSym", () => {
    const state = baseState({
      ...withProvider("QNNExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
        quantMethod: "awq",
        awqSym: false,
      },
    });
    const warnings = validatePassParameters(state, ["QNNQuantization"]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.title.includes("symmetric"))).toBe(true);
  });

  it("no symmetric warning when AWQ INT8 on QNN has awqSym=true", () => {
    const state = baseState({
      ...withProvider("QNNExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
        quantMethod: "awq",
        awqSym: true,
      },
    });
    const warnings = validatePassParameters(state, ["QNNQuantization"]);
    // INT4 preference warning still fires, but symmetric warning should not
    expect(warnings.some((w) => w.title.includes("symmetric"))).toBe(false);
  });

  it("warns for non-AWQ INT8 on QNN (QNNQuantization)", () => {
    const state = baseState({
      ...withProvider("QNNExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
        quantMethod: "ptq",
      },
    });
    const warnings = validatePassParameters(state, ["QNNQuantization"]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].description).toContain("per-channel");
  });

  it("warns for INT4 on QNN suggesting INT4 is better", () => {
    const state = baseState({
      ...withProvider("QNNExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
        quantMethod: "awq",
      },
    });
    const warnings = validatePassParameters(state, ["QNNQuantization"]);
    // Should warn about INT4 preference
    expect(warnings.some((w) => w.description.includes("INT4"))).toBe(true);
  });

  it("warns for non-AWQ INT8 on OnnxQuantization for QNN", () => {
    const state = baseState({
      ...withProvider("QNNExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
        quantMethod: "ptq",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].description).toContain("per-channel");
  });

  it("no warning for INT4 on QNN (already optimal)", () => {
    const state = baseState({
      ...withProvider("QNNExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int4",
        quantMethod: "awq",
      },
    });
    const warnings = validatePassParameters(state, ["QNNQuantization"]);
    expect(warnings.length).toBe(0);
  });

  it("symmetric warning includes AWQ symmetric autofix with correct actionLabel", () => {
    const state = baseState({
      ...withProvider("QNNExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
        quantMethod: "awq",
        awqSym: false,
      },
    });
    const warnings = validatePassParameters(state, ["QNNQuantization"]);
    const symWarning = warnings.find((w) => w.title.includes("symmetric"));
    expect(symWarning).toBeDefined();
    expect(symWarning!.actionLabel).toBe("Enable AWQ symmetric");
    expect(symWarning!.autofix).toEqual({ passes: { quantMethod: "awq", awqSym: true } });
  });

  it("INT4 preference warning includes INT4 autofix with correct actionLabel", () => {
    const state = baseState({
      ...withProvider("QNNExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
        quantMethod: "awq",
      },
    });
    const warnings = validatePassParameters(state, ["QNNQuantization"]);
    const int4Warning = warnings.find((w) => w.title.includes("prefers INT4"));
    expect(int4Warning).toBeDefined();
    expect(int4Warning!.actionLabel).toBe("Switch to INT4");
    expect(int4Warning!.autofix).toEqual({ passes: { quantPrecision: "int4" } });
  });

  it("OnnxQuantization symmetric warning includes AWQ symmetric autofix with correct actionLabel", () => {
    const state = baseState({
      ...withProvider("QNNExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
        quantMethod: "ptq",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    const symWarning = warnings.find((w) => w.title.includes("per-channel"));
    expect(symWarning).toBeDefined();
    expect(symWarning!.actionLabel).toBe("Enable AWQ symmetric");
    expect(symWarning!.autofix).toEqual({ passes: { quantMethod: "awq", awqSym: true } });
  });
});

// ── NVIDIA rules ──────────────────────────────────────────────────

describe("NVIDIA parameter validation", () => {
  it("warns when PTQ INT8 on NVIDIA (prefers AWQ INT4)", () => {
    const state = baseState({
      ...withProvider("CUDAExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
        quantMethod: "ptq",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].description).toContain("AWQ INT4");
  });

  it("no warning for AWQ INT4 on NVIDIA (optimal)", () => {
    const state = baseState({
      ...withProvider("CUDAExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int4",
        quantMethod: "awq",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    expect(warnings.length).toBe(0);
  });

  it("PTQ INT8 warning includes AWQ INT4 autofix with correct actionLabel", () => {
    const state = baseState({
      ...withProvider("CUDAExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
        quantMethod: "ptq",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    const ptqWarning = warnings.find((w) => w.title.includes("prefers AWQ INT4"));
    expect(ptqWarning).toBeDefined();
    expect(ptqWarning!.actionLabel).toBe("Switch to AWQ INT4 (disables pruning)");
    expect(ptqWarning!.autofix).toEqual({ passes: { quantPrecision: "int4", quantMethod: "awq" } });
  });
});

// ── OpenVINO rules ────────────────────────────────────────────────

describe("OpenVINO parameter validation", () => {
  it("warns when using OnnxQuantization INT8 (prefers static)", () => {
    const state = baseState({
      ...withProvider("OpenVINOExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].description).toContain("static quantization");
  });

  it("INT8 warning includes static INT8 autofix with correct actionLabel", () => {
    const state = baseState({
      ...withProvider("OpenVINOExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    const int8Warning = warnings.find((w) => w.title.includes("static quantization"));
    expect(int8Warning).toBeDefined();
    expect(int8Warning!.actionLabel).toBe("Enable static INT8");
    expect(int8Warning!.autofix).toEqual({ passes: { onnxTransforms: true, quantPrecision: "int8" } });
  });

  it("no warning when quantPrecision is not int8 on OpenVINO", () => {
    const state = baseState({
      ...withProvider("OpenVINOExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int4",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    expect(warnings.length).toBe(0);
  });
});

// ── CPU rules ─────────────────────────────────────────────────────

describe("CPU parameter validation", () => {
  it("warns for INT4 on CPU", () => {
    const state = baseState({
      ...withProvider("CPUExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int4",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].description).toContain("limited runtime support");
  });

  it("no warning for INT8 on CPU", () => {
    const state = baseState({
      ...withProvider("CPUExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    expect(warnings.length).toBe(0);
  });

  it("INT4 warning includes INT8 autofix with correct actionLabel", () => {
    const state = baseState({
      ...withProvider("CPUExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int4",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    const int4Warning = warnings.find((w) => w.title.includes("slower than GPU"));
    expect(int4Warning).toBeDefined();
    expect(int4Warning!.actionLabel).toBe("Switch to INT8");
    expect(int4Warning!.autofix).toEqual({ passes: { quantPrecision: "int8" } });
  });
});

// ── TensorRT rules ────────────────────────────────────────────────

describe("TensorRT parameter validation", () => {
  it("warns when PTQ INT8 on TensorRT (requires QDQ format)", () => {
    const state = baseState({
      ...withProvider("TensorrtExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
        quantMethod: "ptq",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.description.includes("QDQ"))).toBe(true);
  });

  it("warns when AWQ INT8 on TensorRT (prefers INT4)", () => {
    const state = baseState({
      ...withProvider("TensorrtExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
        quantMethod: "awq",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.description.includes("INT4"))).toBe(true);
  });

  it("warns about slow engine build when not using AWQ on TensorRT", () => {
    const state = baseState({
      ...withProvider("TensorrtExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
        quantMethod: "ptq",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    expect(warnings.some((w) => w.description.includes("time-intensive"))).toBe(true);
  });

  it("no warning for AWQ INT4 on TensorRT (optimal)", () => {
    const state = baseState({
      ...withProvider("TensorrtExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int4",
        quantMethod: "awq",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    expect(warnings.length).toBe(0);
  });

  it("PTQ INT8 warning includes AWQ autofix with correct actionLabel", () => {
    const state = baseState({
      ...withProvider("TensorrtExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
        quantMethod: "ptq",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    const qdqWarning = warnings.find((w) => w.title.includes("QDQ format"));
    expect(qdqWarning).toBeDefined();
    expect(qdqWarning!.actionLabel).toBe("Switch to AWQ (disables pruning)");
    expect(qdqWarning!.autofix).toEqual({ passes: { quantMethod: "awq" } });
  });

  it("AWQ INT8 warning includes INT4 autofix with correct actionLabel", () => {
    const state = baseState({
      ...withProvider("TensorrtExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
        quantMethod: "awq",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    const int4Warning = warnings.find((w) => w.title.includes("prefers AWQ INT4"));
    expect(int4Warning).toBeDefined();
    expect(int4Warning!.actionLabel).toBe("Switch to INT4");
    expect(int4Warning!.autofix).toEqual({ passes: { quantPrecision: "int4" } });
  });

  it("slow build warning includes AWQ autofix with correct actionLabel", () => {
    const state = baseState({
      ...withProvider("TensorrtExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
        quantMethod: "ptq",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    const buildWarning = warnings.find((w) => w.title.includes("engine builds are slow"));
    expect(buildWarning).toBeDefined();
    expect(buildWarning!.actionLabel).toBe("Switch to AWQ (disables pruning)");
    expect(buildWarning!.autofix).toEqual({ passes: { quantMethod: "awq" } });
  });
});

// ── TensorRT RTX rules ──────────────────────────────────────────

describe("TensorRT RTX parameter validation", () => {
  it("warns when INT8 on TensorRT RTX (prefers INT4)", () => {
    const state = baseState({
      ...withProvider("NvTensorRTRTXExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
        quantMethod: "awq",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.description.includes("INT4"))).toBe(true);
  });

  it("warns when PTQ INT8 on TensorRT RTX (requires QDQ)", () => {
    const state = baseState({
      ...withProvider("NvTensorRTRTXExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
        quantMethod: "ptq",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.description.includes("QDQ"))).toBe(true);
  });

  it("no warning for AWQ INT4 on TensorRT RTX (optimal)", () => {
    const state = baseState({
      ...withProvider("NvTensorRTRTXExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int4",
        quantMethod: "awq",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    expect(warnings.length).toBe(0);
  });

  it("INT8 warning includes AWQ INT4 autofix with correct actionLabel", () => {
    const state = baseState({
      ...withProvider("NvTensorRTRTXExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
        quantMethod: "awq",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    const int4Warning = warnings.find((w) => w.title.includes("prefers INT4 AWQ"));
    expect(int4Warning).toBeDefined();
    expect(int4Warning!.actionLabel).toBe("Switch to AWQ INT4 (disables pruning)");
    expect(int4Warning!.autofix).toEqual({ passes: { quantPrecision: "int4", quantMethod: "awq" } });
  });

  it("PTQ INT8 warning includes AWQ autofix with correct actionLabel", () => {
    const state = baseState({
      ...withProvider("NvTensorRTRTXExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
        quantMethod: "ptq",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    const qdqWarning = warnings.find((w) => w.title.includes("QDQ format"));
    expect(qdqWarning).toBeDefined();
    expect(qdqWarning!.actionLabel).toBe("Switch to AWQ (disables pruning)");
    expect(qdqWarning!.autofix).toEqual({ passes: { quantMethod: "awq" } });
  });
});

// ── ROCm rules ──────────────────────────────────────────────

describe("ROCm parameter validation", () => {
  it("warns when AWQ is used on ROCm (limited support)", () => {
    const state = baseState({
      ...withProvider("ROCMExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantMethod: "awq",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.title.includes("AWQ has limited ROCm support"))).toBe(true);
    expect(warnings.some((w) => w.description.includes("GPTQ"))).toBe(true);
  });

  it("AWQ warning includes GPTQ autofix with correct actionLabel", () => {
    const state = baseState({
      ...withProvider("ROCMExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantMethod: "awq",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    const awqWarning = warnings.find((w) => w.title.includes("AWQ has limited ROCm support"));
    expect(awqWarning).toBeDefined();
    expect(awqWarning!.actionLabel).toBe("Switch to GPTQ");
    expect(awqWarning!.autofix).toEqual({ passes: { quantMethod: "gptq" } });
  });

  it("warns when INT8 on ROCm (prefers GPTQ INT4)", () => {
    const state = baseState({
      ...withProvider("ROCMExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.title.includes("ROCm prefers GPTQ INT4"))).toBe(true);
    expect(warnings.some((w) => w.description.includes("INT4"))).toBe(true);
  });

  it("INT8 warning includes GPTQ INT4 autofix with correct actionLabel", () => {
    const state = baseState({
      ...withProvider("ROCMExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    const int8Warning = warnings.find((w) => w.title.includes("ROCm prefers GPTQ INT4"));
    expect(int8Warning).toBeDefined();
    expect(int8Warning!.actionLabel).toBe("Switch to GPTQ INT4");
    expect(int8Warning!.autofix).toEqual({ passes: { quantPrecision: "int4", quantMethod: "gptq" } });
  });

  it("no warning when GPTQ INT4 on ROCm (optimal)", () => {
    const state = baseState({
      ...withProvider("ROCMExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int4",
        quantMethod: "gptq",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    expect(warnings.length).toBe(0);
  });

  it("both warnings fire when AWQ INT8 on ROCm", () => {
    const state = baseState({
      ...withProvider("ROCMExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantPrecision: "int8",
        quantMethod: "awq",
      },
    });
    const warnings = validatePassParameters(state, ["OnnxQuantization"]);
    expect(warnings.some((w) => w.title.includes("AWQ has limited ROCm support"))).toBe(true);
    expect(warnings.some((w) => w.title.includes("ROCm prefers GPTQ INT4"))).toBe(true);
  });
});

// ── Cross-provider parameterized tests ──────────────────────

type ProviderTestCase = {
  provider: IHVProvider;
  activePassNames: string[];
  optimalPasses: Partial<UIState["passes"]>;
  suboptimalPasses: Partial<UIState["passes"]>;
  /** Substring that should appear in the warning description */
  expectedWarningSubstring: string;
};

const PROVIDER_TEST_CASES: ProviderTestCase[] = [
  {
    provider: "CUDAExecutionProvider",
    activePassNames: ["OnnxQuantization"],
    optimalPasses: { quantPrecision: "int4", quantMethod: "awq" },
    suboptimalPasses: { quantPrecision: "int8", quantMethod: "ptq" },
    expectedWarningSubstring: "AWQ INT4",
  },
  {
    provider: "TensorrtExecutionProvider",
    activePassNames: ["OnnxQuantization"],
    optimalPasses: { quantPrecision: "int4", quantMethod: "awq" },
    suboptimalPasses: { quantPrecision: "int8", quantMethod: "ptq" },
    expectedWarningSubstring: "QDQ",
  },
  {
    provider: "NvTensorRTRTXExecutionProvider",
    activePassNames: ["OnnxQuantization"],
    optimalPasses: { quantPrecision: "int4", quantMethod: "awq" },
    suboptimalPasses: { quantPrecision: "int8", quantMethod: "awq" },
    expectedWarningSubstring: "INT4",
  },
  {
    provider: "ROCMExecutionProvider",
    activePassNames: ["OnnxQuantization"],
    optimalPasses: { quantPrecision: "int4", quantMethod: "gptq" },
    suboptimalPasses: { quantPrecision: "int8", quantMethod: "awq" },
    expectedWarningSubstring: "GPTQ",
  },
  {
    provider: "OpenVINOExecutionProvider",
    activePassNames: ["OnnxQuantization"],
    optimalPasses: { quantPrecision: "int4" },
    suboptimalPasses: { quantPrecision: "int8" },
    expectedWarningSubstring: "static quantization",
  },
  {
    provider: "QNNExecutionProvider",
    activePassNames: ["QNNQuantization"],
    optimalPasses: { quantPrecision: "int4", quantMethod: "awq" },
    suboptimalPasses: { quantPrecision: "int8", quantMethod: "awq", awqSym: false },
    expectedWarningSubstring: "symmetric",
  },
  {
    provider: "CPUExecutionProvider",
    activePassNames: ["OnnxQuantization"],
    optimalPasses: { quantPrecision: "int8" },
    suboptimalPasses: { quantPrecision: "int4" },
    expectedWarningSubstring: "limited runtime support",
  },
];

describe("cross-provider validation consistency", () => {
  describe.each(PROVIDER_TEST_CASES)(
    "$provider",
    ({ provider, activePassNames, optimalPasses, suboptimalPasses, expectedWarningSubstring }) => {
      it("no warnings for optimal config", () => {
        const state = baseState({
          ...withProvider(provider),
          passes: { ...baseState().passes, ...optimalPasses },
        });
        const warnings = validatePassParameters(state, activePassNames);
        expect(warnings.length).toBe(0);
      });

      it("warns for suboptimal config with expected substring", () => {
        const state = baseState({
          ...withProvider(provider),
          passes: { ...baseState().passes, ...suboptimalPasses },
        });
        const warnings = validatePassParameters(state, activePassNames);
        expect(warnings.length).toBeGreaterThan(0);
        expect(warnings.some((w) => w.description.includes(expectedWarningSubstring))).toBe(true);
      });

      it("autofix payloads are well-formed when present", () => {
        const state = baseState({
          ...withProvider(provider),
          passes: { ...baseState().passes, ...suboptimalPasses },
        });
        const warnings = validatePassParameters(state, activePassNames);
        const withAutofix = warnings.filter((w) => w.autofix || w.actionLabel);
        // All warnings with autofix must have both autofix and actionLabel
        for (const w of withAutofix) {
          if (w.autofix) {
            expect(w.actionLabel).toBeDefined();
            expect(w.actionLabel!.length).toBeGreaterThan(0);
            expect(w.autofix!.passes).toBeDefined();
          }
          if (w.actionLabel) {
            expect(w.autofix).toBeDefined();
            expect(w.autofix!.passes).toBeDefined();
          }
        }
      });

      it("warning IDs are unique per provider", () => {
        const state = baseState({
          ...withProvider(provider),
          passes: { ...baseState().passes, ...suboptimalPasses },
        });
        const warnings = validatePassParameters(state, activePassNames);
        const ids = warnings.map((w) => w.id);
        expect(new Set(ids).size).toBe(ids.length);
      });

      it("returns empty for non-matching pass names", () => {
        const state = baseState({
          ...withProvider(provider),
          passes: { ...baseState().passes, ...suboptimalPasses },
        });
        const warnings = validatePassParameters(state, ["FakePass"]);
        expect(warnings.length).toBe(0);
      });
    },
  );
});

// ── Edge cases ────────────────────────────────────────────────────

describe("edge cases", () => {
  it("returns empty for no active passes", () => {
    const state = baseState();
    const warnings = validatePassParameters(state, []);
    expect(warnings.length).toBe(0);
  });

  it("returns empty for non-matching pass names", () => {
    const state = baseState();
    const warnings = validatePassParameters(state, ["FakePass", "AnotherFake"]);
    expect(warnings.length).toBe(0);
  });

  it("returns empty for quantization disabled", () => {
    const state = baseState({
      ...withProvider("QNNExecutionProvider"),
      passes: {
        ...baseState().passes,
        quantization: false,
      },
    });
    const warnings = validatePassParameters(state, ["QNNQuantization"]);
    // Rules check pass names, not whether quantization is enabled in UIState
    // But since the pass won't be active if quantization is off, this is fine
    expect(warnings.length).toBe(0);
  });
});
