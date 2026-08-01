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

  it("maps task / input_model + feature-extraction to hfTask", () => {
    expect(canonicalizeAutofixPass("hfTask")).toBe("hfTask");
    expect(canonicalizeAutofixPass("task", "feature-extraction")).toBe("hfTask");
    expect(canonicalizeAutofixPass("-> input_model", "feature-extraction")).toBe("hfTask");
    expect(canonicalizeAutofixPass("input_model")).toBeNull();
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

  it("applies embedding task from input_model autofix", () => {
    const patch = resolveAuditAutofix({ pass: "-> input_model", value: "feature-extraction" }, state);
    expect(patch).toEqual({ hfTask: "feature-extraction" });
  });

  it("maps FP16 quantPrecision advice to conversion dtype (does not enable quant)", () => {
    expect(canonicalizeAutofixPass("quantPrecision", "fp16")).toBe("conversionInputTargetTypes");
    const patch = resolveAuditAutofix({ pass: "quantPrecision", value: "fp16" }, state);
    expect(patch?.passes?.conversion).toBe(true);
    expect(patch?.passes?.conversionInputTargetTypes).toBe("float16");
    expect(patch?.passes?.quantization).toBe(false);
  });

  it("still enables quantization for int4/int8 precision", () => {
    const patch = resolveAuditAutofix({ pass: "quantPrecision", value: "int4" }, state);
    expect(patch?.passes?.quantization).toBe(true);
    expect(patch?.passes?.quantPrecision).toBe("int4");
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

  it("is true for input_model + known HF task", () => {
    expect(isAuditAutofixApplyable({ pass: "input_model", value: "feature-extraction" })).toBe(true);
  });

  it("is false for bare input_model without a task value", () => {
    expect(isAuditAutofixApplyable({ pass: "input_model", value: "true" })).toBe(false);
  });
});
