/**
 * Smoke test: default UI state produces valid JSON recipe with expected pass mapping.
 * Run: npx tsx scripts/validate-recipe-builder.ts
 */

import assert from "node:assert/strict";
import { DEFAULT_PASSES } from "../src/lib/defaultPasses";
import { buildRecipeFromState } from "../src/lib/recipePipeline";
import { sanitizePipelineState } from "../src/lib/pipelineValidation";
import { validateOliveRecipeStructure } from "../src/lib/oliveRecipeSchema";
import { UIState } from "../src/types";

const baseState: UIState = {
  modelSource: "huggingface",
  localFiles: [],
  azureModelPath: "",
  hfModelId: "meta-llama/Llama-3-8B",
  hfDataset: "",
  ihvProvider: "CUDAExecutionProvider",
  cudaVersion: "auto",
  cacheDir: "",
  azureStr: "",
  distributedCaching: false,
  activeJobId: null,
  passes: {
    ...DEFAULT_PASSES,
    quantization: true,
    quantMethod: "awq",
    quantPrecision: "int4",
    onnxTransforms: true,
  },
};

const pipeline = buildRecipeFromState(baseState);
assert.equal(pipeline.validation.isBlocked, false, "sanitized CUDA+AWQ state should not block");
assert.equal(pipeline.schema.valid, true, "built recipe must pass structural schema");
assert.equal(pipeline.isRunnable, true, "pipeline should be runnable");
assert.ok(pipeline.recipe.passes && typeof pipeline.recipe.passes === "object");
const quantPass = (pipeline.recipe.passes as Record<string, { config?: { algorithm?: string } }>).quantization;
assert.ok(quantPass, "recipe must include quantization pass");
assert.equal(quantPass.config?.algorithm, "awq", "AWQ quant method must map to algorithm field");

const cpuAwq = sanitizePipelineState({
  ...baseState,
  ihvProvider: "CPUExecutionProvider",
  passes: { ...baseState.passes, quantMethod: "awq" },
});
assert.equal(cpuAwq.passes.quantMethod, "ptq", "AWQ must be removed on CPU");

const cpuOpenVino = sanitizePipelineState({
  ...baseState,
  ihvProvider: "CPUExecutionProvider",
  passes: { ...baseState.passes, conversionFormat: "openvino", quantMethod: "ptq" },
});
assert.equal(cpuOpenVino.passes.conversionFormat, "onnx", "OpenVINO IR must be removed off OpenVINO EP");

const emptyRecipe = validateOliveRecipeStructure({});
assert.equal(emptyRecipe.valid, false, "empty object must fail schema");

console.log("validate-recipe-builder: ok");
