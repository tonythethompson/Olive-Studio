import { describe, expect, it } from "vitest";
import { canonicalizeAutofixPass, isAuditAutofixApplyable, resolveAuditAutofix } from "./auditAutofix.ts";
import type { UIState } from "@/types";

const basePasses = {
  conversion: true,
  conversionSourceFormat: "pytorch",
  conversionFormat: "onnx",
  conversionOpset: 20,
  conversionInputTargetTypes: "float32",
  quantization: false,
  quantMethod: "ptq",
  quantPrecision: "int8",
  quantPreset: "",
  gptqBlockSize: 128,
  gptqDescAct: false,
  gptqGroupSize: 128,
  awqGroupSize: 128,
  awqDampPercent: 0.01,
  awqSym: false,
  qatQuantPrecision: "int8",
  qatCalibrateMethod: "minmax",
  qatCalibrateSteps: 100,
  pruning: false,
  pruningType: "unstructured",
  pruningMethod: "magnitude",
  pruningCriteria: "l1_norm",
  pruningSparsity: 0.5,
  splitting: false,
  onnxTransforms: false,
  peft: false,
  peftMethod: "lora",
  diffusionLora: false,
} as UIState["passes"];

const state = {
  passes: basePasses,
  ihvProvider: "NvTensorRTRTXExecutionProvider" as const,
  openvinoTargetDevice: "CPU" as const,
};

describe("canonicalizeAutofixPass", () => {
  it("maps Olive nested dtype path to conversionInputTargetTypes", () => {
    expect(canonicalizeAutofixPass("passes.conversion.config.input_model_dtype")).toBe(
      "conversionInputTargetTypes",
    );
  });

  it("keeps UI field names", () => {
    expect(canonicalizeAutofixPass("quantMethod")).toBe("quantMethod");
    expect(canonicalizeAutofixPass("passes.quantPrecision")).toBe("quantPrecision");
  });

  it("rejects TensorRTPass-style paths", () => {
    expect(canonicalizeAutofixPass("passes.tensor_rt")).toBe("__reject_tensor_rt_pass__");
  });
});

describe("resolveAuditAutofix", () => {
  it("applies FP16 dtype from nested Olive path", () => {
    const patch = resolveAuditAutofix(
      { pass: "passes.conversion.config.input_model_dtype", value: "float16" },
      state,
    );
    expect(patch?.passes?.conversionInputTargetTypes).toBe("float16");
    expect(patch?.passes?.conversion).toBe(true);
  });

  it("normalizes fp16 alias", () => {
    const patch = resolveAuditAutofix({ pass: "conversionInputTargetTypes", value: "fp16" }, state);
    expect(patch?.passes?.conversionInputTargetTypes).toBe("float16");
  });

  it("returns null for TensorRTPass junk", () => {
    expect(resolveAuditAutofix({ pass: "passes.tensor_rt", value: "enable" }, state)).toBeNull();
  });

  it("maps int8_quant to PTQ int8", () => {
    const patch = resolveAuditAutofix({ pass: "passes.int8_quant", value: "true" }, state);
    expect(patch?.passes?.quantization).toBe(true);
    expect(patch?.passes?.quantMethod).toBe("ptq");
    expect(patch?.passes?.quantPrecision).toBe("int8");
  });

  it("does not invent garbage dotted keys on passes", () => {
    const patch = resolveAuditAutofix(
      { pass: "passes.conversion.config.input_model_dtype", value: "float16" },
      state,
    );
    expect(patch?.passes).not.toHaveProperty("conversion.config.input_model_dtype");
  });

  it("returns null for unknown quantMethod", () => {
    expect(resolveAuditAutofix({ pass: "quantMethod", value: "not-a-method" }, state)).toBeNull();
  });

  it("rejects invented ihvProvider values", () => {
    expect(resolveAuditAutofix({ pass: "ihvProvider", value: "NotAProvider" }, state)).toBeNull();
    expect(resolveAuditAutofix({ pass: "ihvProvider", value: "CUDA-EP" }, state)).toBeNull();
  });

  it("accepts canonical and alias ihvProvider values", () => {
    expect(
      resolveAuditAutofix({ pass: "ihvProvider", value: "CUDAExecutionProvider" }, state)?.ihvProvider,
    ).toBe("CUDAExecutionProvider");
    expect(resolveAuditAutofix({ pass: "ihvProvider", value: "CUDA" }, state)?.ihvProvider).toBe(
      "CUDAExecutionProvider",
    );
    expect(
      resolveAuditAutofix({ pass: "ihvProvider", value: "QnnAbiExecutionProvider" }, state)?.ihvProvider,
    ).toBe("QnnAbiExecutionProvider");
    expect(resolveAuditAutofix({ pass: "ihvProvider", value: "qnnabi" }, state)?.ihvProvider).toBe(
      "QnnAbiExecutionProvider",
    );
  });

  it("maps JSON fp16 quantPrecision through conversion dtype", () => {
    const patch = resolveAuditAutofix({ pass: "passes", value: '{"quantPrecision":"fp16"}' }, state);
    expect(patch?.passes?.conversion).toBe(true);
    expect(patch?.passes?.conversionInputTargetTypes).toBe("float16");
    expect(patch?.passes?.quantPrecision).toBe("fp16");
  });

  it("applies JSON memoryOffload and modelSource top-level passes", () => {
    expect(
      resolveAuditAutofix({ pass: "memoryOffload", value: '{"memoryOffload":"auto"}' }, state)?.memoryOffload,
    ).toBe("auto");
    expect(
      resolveAuditAutofix({ pass: "modelSource", value: '{"modelSource":"local"}' }, state)?.modelSource,
    ).toBe("local");
  });

  it("returns null for invalid JSON memoryOffload and modelSource", () => {
    expect(
      resolveAuditAutofix({ pass: "memoryOffload", value: '{"memoryOffload":"disk"}' }, state),
    ).toBeNull();
    expect(resolveAuditAutofix({ pass: "modelSource", value: '{"modelSource":"s3"}' }, state)).toBeNull();
  });

  it("merges JSON awq+int4 and disables pruning", () => {
    const withPruning = {
      ...state,
      passes: { ...basePasses, pruning: true },
    };
    const patch = resolveAuditAutofix(
      { pass: "passes", value: '{"quantMethod":"awq","quantPrecision":"int4"}' },
      withPruning,
    );
    expect(patch?.passes?.quantization).toBe(true);
    expect(patch?.passes?.quantMethod).toBe("awq");
    expect(patch?.passes?.quantPrecision).toBe("int4");
    expect(patch?.passes?.pruning).toBe(false);
  });

  it("returns null when JSON only contains a rejected tensor_rt pass", () => {
    expect(resolveAuditAutofix({ pass: "passes", value: '{"tensor_rt":"enable"}' }, state)).toBeNull();
  });

  it("rejects out-of-range numeric pass values", () => {
    expect(resolveAuditAutofix({ pass: "conversionOpset", value: "99" }, state)).toBeNull();
  });
});

describe("isAuditAutofixApplyable", () => {
  it("is true for remappable dtype path", () => {
    expect(
      isAuditAutofixApplyable({
        pass: "passes.conversion.config.input_model_dtype",
        value: "float16",
      }),
    ).toBe(true);
  });

  it("is false for TensorRTPass", () => {
    expect(isAuditAutofixApplyable({ pass: "passes.tensor_rt", value: "x" })).toBe(false);
  });

  it("is false for truncated JSON values", () => {
    expect(isAuditAutofixApplyable({ pass: "passes", value: "{oops" })).toBe(false);
  });
});
