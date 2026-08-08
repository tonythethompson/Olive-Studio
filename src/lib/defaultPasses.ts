import { UIState } from "@/types";

/** Default pass toggles/settings for new sessions and recipe import baselines. */
export const DEFAULT_PASSES: UIState["passes"] = {
  conversion: true,
  conversionSourceFormat: "pytorch",
  conversionFormat: "onnx",
  conversionOpset: 20,
  conversionInputTargetTypes: "float32",
  quantization: false,
  quantMethod: "ptq",
  quantPrecision: "int8",
  gptqBlockSize: 128,
  gptqDescAct: false,
  gptqGroupSize: 128,
  awqGroupSize: 128,
  awqDampPercent: 0.01,
  awqSym: true,
  pruning: false,
  pruningSparsity: 0.5,
  pruningType: "unstructured",
  pruningMethod: "magnitude",
  pruningCriteria: "l1_norm",
  splitting: false,
  onnxTransforms: false,
  peft: false,
  peftMethod: "lora",
  diffusionLora: false,
  qatQuantPrecision: "int8",
  qatCalibrateMethod: "minmax",
  qatCalibrateSteps: 10,
  quantPreset: "",
};

export function createInactivePasses(): UIState["passes"] {
  return {
    ...DEFAULT_PASSES,
    conversion: false,
    quantization: false,
    pruning: false,
    splitting: false,
    onnxTransforms: false,
    peft: false,
  };
}
