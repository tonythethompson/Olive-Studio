/**
 * Smoke test: default UI state produces valid JSON recipe with expected pass mapping.
 * Run: npx tsx scripts/validate-recipe-builder.ts
 */

import assert from "node:assert/strict";
import { DEFAULT_PASSES } from "../src/lib/defaultPasses";
import { buildRecipeFromState } from "../src/lib/recipePipeline";
import { sanitizePipelineState } from "../src/lib/pipelineValidation";
import { validateOliveRecipeStructure } from "../src/lib/oliveRecipeSchema";
import { getPipelineValidation, prepareProviderChange } from "../src/lib/pipelineValidation";
import { getSelectableProviders } from "../src/lib/hardwareProbe";
import { UIState } from "../src/types";

const baseState: UIState = {
  modelSource: "huggingface",
  localFiles: [],
  azureModelPath: "",
  hfModelId: "meta-llama/Llama-3-8B",
  hfDataset: "",
  ihvProvider: "CUDAExecutionProvider",
  memoryOffload: "gpu_only",
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
const engine = pipeline.recipe.engine as { search_strategy?: unknown };
assert.equal(engine.search_strategy, false, "engine must disable pass search without evaluators");
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

const offloadPipeline = buildRecipeFromState({
  ...baseState,
  memoryOffload: "auto",
});
const inputModel = offloadPipeline.recipe.input_model as { type?: string; config?: { load_kwargs?: { device_map?: string } } };
assert.equal(inputModel.type, "HfModel", "offload should switch to HfModel");
assert.equal(inputModel.config?.load_kwargs?.device_map, "auto", "offload should set device_map auto");

const pruningPipeline = buildRecipeFromState({
  ...baseState,
  passes: {
    ...DEFAULT_PASSES,
    pruning: true,
    pruningMethod: "magnitude",
    pruningCriteria: "l2_norm",
    pruningSparsity: 0.4,
  },
});
const pruningPass = (pruningPipeline.recipe.passes as Record<string, { config?: { pruning_criteria?: string } }>).pruning;
assert.ok(pruningPass, "recipe must include pruning pass");
assert.equal(pruningPass.config?.pruning_criteria, "l2_norm", "magnitude pruning must map criteria");

const diffusionPeftPipeline = buildRecipeFromState({
  ...baseState,
  hfModelId: "stabilityai/stable-diffusion-xl-base-1.0",
  passes: {
    ...DEFAULT_PASSES,
    peft: true,
    diffusionLora: true,
  },
});
const peftPass = (diffusionPeftPipeline.recipe.passes as Record<string, { config?: { diffusion_lora?: boolean } }>).peft;
assert.ok(peftPass, "recipe must include peft pass");
assert.equal(peftPass.config?.diffusion_lora, true, "diffusion LoRA flag must map to config");

const conversionPipeline = buildRecipeFromState({
  ...baseState,
  passes: {
    ...DEFAULT_PASSES,
    conversion: true,
    conversionSourceFormat: "tensorflow",
  },
});
const convPass = (conversionPipeline.recipe.passes as Record<string, { config?: { source_format?: string } }>).conversion;
assert.equal(convPass.config?.source_format, "tensorflow", "conversion source format must map to config");

const onnxPipelineGap = getPipelineValidation({
  ...baseState,
  ihvProvider: "QNNExecutionProvider",
  passes: {
    ...DEFAULT_PASSES,
    conversion: false,
    onnxTransforms: true,
    quantization: true,
    quantMethod: "ptq",
    quantPrecision: "fp16",
  },
});
assert.equal(
  onnxPipelineGap.isBlocked,
  true,
  "quantization/ORT without conversion must block the pipeline"
);

const mockDesktopProbe = {
  detectedProviders: ["CPUExecutionProvider", "CUDAExecutionProvider"],
  recommendedProvider: "CUDAExecutionProvider",
} as import("@/lib/hardwareProbe").HardwareProbeResult;

const qnnOnDesktop = getPipelineValidation(
  {
    ...baseState,
    ihvProvider: "QNNExecutionProvider",
    passes: { ...DEFAULT_PASSES, conversion: true, quantization: true },
  },
  { hardwareProbe: mockDesktopProbe }
);
assert.equal(qnnOnDesktop.isBlocked, true, "QNN must block when absent from hardware probe");

assert.equal(
  prepareProviderChange(
    { ...baseState, ihvProvider: "CUDAExecutionProvider" },
    "QNNExecutionProvider",
    mockDesktopProbe
  ),
  null,
  "provider switch to absent QNN must be rejected"
);

assert.equal(
  prepareProviderChange(
    { ...baseState, ihvProvider: "CUDAExecutionProvider" },
    "OpenVINOExecutionProvider",
    mockDesktopProbe
  ),
  null,
  "provider switch to absent OpenVINO must be rejected"
);

assert.equal(
  prepareProviderChange(
    { ...baseState, ihvProvider: "CUDAExecutionProvider" },
    "ROCMExecutionProvider",
    mockDesktopProbe
  ),
  null,
  "provider switch to absent ROCm must be rejected"
);

assert.deepEqual(
  getSelectableProviders(mockDesktopProbe),
  ["CPUExecutionProvider", "CUDAExecutionProvider"],
  "selectable providers must match probe detection"
);

console.log("validate-recipe-builder: ok");
