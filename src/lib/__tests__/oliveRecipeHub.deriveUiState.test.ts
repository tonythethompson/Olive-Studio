import { describe, expect, it } from "vitest";
import {
  deriveUiStateFromOliveRecipe,
  getCatalogDeviceFromRecipe,
  mapExecutionProviderFromRecipe,
} from "../oliveRecipeHub";

function recipeWithExecutionProviders(providers: unknown) {
  return {
    systems: {
      local_system: {
        config: {
          accelerators: [{ execution_providers: providers }],
        },
      },
    },
  };
}

describe("deriveUiStateFromOliveRecipe validation", () => {
  // ── hf_config.model_name ────────────────────────────────────────────

  it("rejects non-string hf_config.model_name instead of coercing into hfModelId", () => {
    const state = deriveUiStateFromOliveRecipe({
      input_model: {
        config: {
          hf_config: {
            model_name: { nested: true },
          },
        },
      },
    });
    expect(state.hfModelId).toBeUndefined();
    expect(state.modelSource).toBeUndefined();
  });

  it("accepts valid string hf_config.model_name", () => {
    const state = deriveUiStateFromOliveRecipe({
      input_model: {
        config: {
          hf_config: {
            model_name: "microsoft/phi-2",
            task: "text-generation",
          },
        },
      },
    });
    expect(state.modelSource).toBe("huggingface");
    expect(state.hfModelId).toBe("microsoft/phi-2");
    expect(state.hfTask).toBe("text-generation");
  });

  // ── local_files ─────────────────────────────────────────────────────

  it("rejects local_files entries that are not all strings", () => {
    const state = deriveUiStateFromOliveRecipe({
      input_model: {
        config: {
          local_files: ["model.onnx", { name: "bad" }],
        },
      },
    });
    expect(state.localFiles).toBeUndefined();
    expect(state.modelSource).not.toBe("local");
  });

  it("accepts valid string local_files", () => {
    const state = deriveUiStateFromOliveRecipe({
      input_model: {
        config: {
          local_files: ["model.onnx"],
        },
      },
    });
    expect(state.modelSource).toBe("local");
    expect(state.localFiles).toEqual([{ name: "model.onnx", size: 2_000_000_000 }]);
  });

  // ── model_path (local fallback, azure) ──────────────────────────────

  it("falls back to local modelSource from model_path when hf_config is absent and path has no slash", () => {
    const state = deriveUiStateFromOliveRecipe({
      input_model: {
        config: {
          model_path: "model.onnx",
        },
      },
    });
    expect(state.modelSource).toBe("local");
  });

  it("rejects azure model_path when it is just a bare filename", () => {
    const state = deriveUiStateFromOliveRecipe({
      input_model: {
        config: {
          model_path: "azure://stuff/model.onnx",
        },
      },
    });
    // No hf_config, so model_path with "azure" substring maps to azure source
    expect(state.modelSource).toBe("azure");
    expect(state.azureModelPath).toBe("azure://stuff/model.onnx");
  });

  // ── execution-provider ──────────────────────────────────────────────

  it("maps valid CUDA execution_provider to ihvProvider", () => {
    const state = deriveUiStateFromOliveRecipe({
      systems: {
        gpu: {
          config: {
            accelerators: [{ execution_providers: ["CUDAExecutionProvider"] }],
          },
        },
      },
    });
    expect(state.ihvProvider).toBe("CUDAExecutionProvider");
  });

  it("maps TensorRT execution_provider token variants to ihvProvider", () => {
    const trt = deriveUiStateFromOliveRecipe({
      systems: { gpu: { config: { accelerators: [{ execution_providers: ["TensorrtExecutionProvider"] }] } } },
    });
    expect(trt.ihvProvider).toBe("TensorrtExecutionProvider");

    const trtRtx = deriveUiStateFromOliveRecipe({
      systems: { gpu: { config: { accelerators: [{ execution_providers: ["NvTensorRTRTXExecutionProvider"] }] } } },
    });
    expect(trtRtx.ihvProvider).toBe("NvTensorRTRTXExecutionProvider");

    const trt2 = deriveUiStateFromOliveRecipe({
      systems: { gpu: { config: { accelerators: [{ execution_providers: ["tensorrt"] }] } } },
    });
    expect(trt2.ihvProvider).toBe("TensorrtExecutionProvider");
  });

  it("maps OpenVINO + QNN + DML execution_provider tokens", () => {
    const ov = deriveUiStateFromOliveRecipe({
      systems: { cpu: { config: { accelerators: [{ execution_providers: ["OpenVINOExecutionProvider"] }] } } },
    });
    expect(ov.ihvProvider).toBe("OpenVINOExecutionProvider");
    expect(ov.openvinoTargetDevice).toBe("CPU");

    const qnn = deriveUiStateFromOliveRecipe({
      systems: { dsp: { config: { accelerators: [{ execution_providers: ["QNNExecutionProvider"] }] } } },
    });
    expect(qnn.ihvProvider).toBe("QNNExecutionProvider");

    const dml = deriveUiStateFromOliveRecipe({
      systems: { gpu: { config: { accelerators: [{ execution_providers: ["DmlExecutionProvider"] }] } } },
    });
    expect(dml.ihvProvider).toBe("DmlExecutionProvider");
  });

  it("ignores missing or empty execution_providers", () => {
    const noAccel = deriveUiStateFromOliveRecipe({
      systems: { gpu: { config: { accelerators: [] } } },
    });
    expect(noAccel.ihvProvider).toBeUndefined();

    const emptyProviders = deriveUiStateFromOliveRecipe({
      systems: { gpu: { config: { accelerators: [{ execution_providers: [] }] } } },
    });
    expect(emptyProviders.ihvProvider).toBeUndefined();
  });

  it("ignores non-array execution_providers", () => {
    const state = deriveUiStateFromOliveRecipe({
      systems: { gpu: { config: { accelerators: [{ execution_providers: "CUDAExecutionProvider" }] } } },
    });
    expect(state.ihvProvider).toBeUndefined();
  });

  // ── catalog-device ──────────────────────────────────────────────────

  it("getCatalogDeviceFromRecipe maps provider tokens to device labels", () => {
    expect(getCatalogDeviceFromRecipe(recipeWithExecutionProviders(["CUDAExecutionProvider"]))).toBe(
      "CUDA",
    );
    expect(getCatalogDeviceFromRecipe(recipeWithExecutionProviders(["DmlExecutionProvider"]))).toBe(
      "DirectML",
    );
  });

  // ── quantization ────────────────────────────────────────────────────

  it("maps quant pass with explicit bits to quantMethod + quantPrecision", () => {
    const state = deriveUiStateFromOliveRecipe({
      passes: {
        quant: { type: "BlockwiseRtnQuantizer", config: { bits: 4 } },
      },
    });
    expect(state.passes?.quantization).toBe(true);
    expect(state.passes?.quantMethod).toBe("rtn");
    expect(state.passes?.quantPrecision).toBe("int4");
  });

  it("maps AWQ pass type to awq method with group_size + damp_percent + sym", () => {
    const state = deriveUiStateFromOliveRecipe({
      passes: {
        awq: { type: "AutoAWQQuantizer", config: { bits: 4, group_size: 128, damp_percent: 0.01, sym: true } },
      },
    });
    expect(state.passes?.quantization).toBe(true);
    expect(state.passes?.quantMethod).toBe("awq");
    expect(state.passes?.quantPrecision).toBe("int4");
    expect(state.passes?.awqGroupSize).toBe(128);
    expect(state.passes?.awqDampPercent).toBe(0.01);
    expect(state.passes?.awqSym).toBe(true);
  });

  it("maps GPTQ pass type to gptq method with block_size + desc_act", () => {
    const state = deriveUiStateFromOliveRecipe({
      passes: {
        gptq: { type: "GptqQuantizer", config: { bits: 4, block_size: 64, group_size: 128, desc_act: true } },
      },
    });
    expect(state.passes?.quantization).toBe(true);
    expect(state.passes?.quantMethod).toBe("gptq");
    expect(state.passes?.quantPrecision).toBe("int4");
    expect(state.passes?.gptqBlockSize).toBe(64);
    expect(state.passes?.gptqGroupSize).toBe(128);
    expect(state.passes?.gptqDescAct).toBe(true);
  });

  it("maps SpinQuant + QuaRot pass types to correct methods", () => {
    const sq = deriveUiStateFromOliveRecipe({
      passes: { sq: { type: "SpinQuant", config: { bits: 4 } } },
    });
    expect(sq.passes?.quantMethod).toBe("spinquant");
    expect(sq.passes?.quantPrecision).toBe("int4");

    const qr = deriveUiStateFromOliveRecipe({
      passes: { qr: { type: "QuaRot", config: { bits: 4 } } },
    });
    expect(qr.passes?.quantMethod).toBe("quarot");
    expect(qr.passes?.quantPrecision).toBe("int4");
  });

  it("maps OpenVINO weight compression pass to ptq with int4 default", () => {
    const state = deriveUiStateFromOliveRecipe({
      passes: {
        ov_q: { type: "OpenVINOWeightCompression", config: { bits: 8 } },
      },
    });
    expect(state.passes?.quantization).toBe(true);
    expect(state.passes?.quantMethod).toBe("ptq");
    // mapQuantPrecision returns int4 for any weightcompression pass type
    expect(state.passes?.quantPrecision).toBe("int4");
  });

  it("falls back to int8 precision when bits is absent from quant config", () => {
    const state = deriveUiStateFromOliveRecipe({
      passes: {
        quant: { type: "Quantization", config: { algorithm: "rtn" } },
      },
    });
    expect(state.passes?.quantization).toBe(true);
    expect(state.passes?.quantPrecision).toBe("int8");
  });

  it("skips non-object pass entries in the passes map", () => {
    const state = deriveUiStateFromOliveRecipe({
      passes: {
        bad: null,
        alsoBad: "string",
        good: { type: "Quantization", config: { bits: 8 } },
      },
    });
    // The null and string entries are ignored; good is processed
    expect(state.passes?.quantization).toBe(true);
    expect(state.passes?.quantMethod).toBe("ptq");
  });

  // ── pruning ─────────────────────────────────────────────────────────

  it("maps SparseGPT pruning pass with sparsity + semi_sparse_acc → structured", () => {
    const state = deriveUiStateFromOliveRecipe({
      passes: {
        prune: { type: "SparseGPT", config: { sparsity_ratio: 0.5, semi_sparse_acc: true } },
      },
    });
    expect(state.passes?.pruning).toBe(true);
    expect(state.passes?.pruningMethod).toBe("sparsegpt");
    expect(state.passes?.pruningSparsity).toBe(0.5);
    expect(state.passes?.pruningType).toBe("structured");
  });

  it("maps Wanda pruning pass with l2_norm criteria", () => {
    const state = deriveUiStateFromOliveRecipe({
      passes: {
        wanda: { type: "Wanda", config: { target_sparsity: 0.3, pruning_criteria: "l2_norm" } },
      },
    });
    expect(state.passes?.pruning).toBe(true);
    expect(state.passes?.pruningMethod).toBe("wanda");
    expect(state.passes?.pruningSparsity).toBe(0.3);
    expect(state.passes?.pruningCriteria).toBe("l2_norm");
  });

  it("falls back to l1_norm for unrecognized pruning_criteria", () => {
    const state = deriveUiStateFromOliveRecipe({
      passes: {
        m1: { type: "MagnitudePruner", config: { sparsity: 0.4, pruning_criteria: "unknown_criteria" } },
      },
    });
    expect(state.passes?.pruningMethod).toBe("magnitude");
    expect(state.passes?.pruningCriteria).toBe("l1_norm");
  });

  it("inherits default pruningCriteria 'l1_norm' when pruning_criteria is absent", () => {
    // createInactivePasses() spreads DEFAULT_PASSES which includes
    // pruningCriteria: "l1_norm". mapPruningCriteria returns undefined
    // when pruning_criteria is absent, so the default survives.
    const state = deriveUiStateFromOliveRecipe(
      {
        passes: {
          m1: { type: "MagnitudePruner", config: { sparsity: 0.4 } },

        },
      },
      { replacePasses: true },
    );
    expect(state.passes?.pruning).toBe(true);
    expect(state.passes?.pruningMethod).toBe("magnitude");
    expect(state.passes?.pruningCriteria).toBe("l1_norm");
  });

  // ── pass-config (conversion, peft, splitting, transforms) ───────────

  it("maps ONNX conversion pass to conversionFormat + opset", () => {
    const state = deriveUiStateFromOliveRecipe({
      passes: {
        conv: { type: "OnnxConversion", config: { target_opset: 17, precision: "fp16" } },
      },
    });
    expect(state.passes?.conversion).toBe(true);
    expect(state.passes?.conversionFormat).toBe("onnx");
    expect(state.passes?.conversionOpset).toBe(17);
  });

  it("maps OpenVINO conversion pass to openvino format", () => {
    const state = deriveUiStateFromOliveRecipe({
      passes: {
        conv: { type: "OpenVINOConversion", config: {} },
      },
    });
    expect(state.passes?.conversion).toBe(true);
    expect(state.passes?.conversionFormat).toBe("openvino");
  });

  it("maps QLoRA and LoRA passes to peft + method", () => {
    const qlora = deriveUiStateFromOliveRecipe({
      passes: { q: { type: "QLoRA", config: {} } },
    });
    expect(qlora.passes?.peft).toBe(true);
    expect(qlora.passes?.peftMethod).toBe("qlora");

    const lora = deriveUiStateFromOliveRecipe({
      passes: { l: { type: "LoRA", config: {} } },
    });
    expect(lora.passes?.peft).toBe(true);
    expect(lora.passes?.peftMethod).toBe("lora");
  });

  it("maps splitting and transforms passes", () => {
    const s = deriveUiStateFromOliveRecipe({
      passes: { sp: { type: "SplitModel", config: {} } },
    });
    expect(s.passes?.splitting).toBe(true);

    const t = deriveUiStateFromOliveRecipe({
      passes: { to: { type: "TransformersOptimization", config: {} } },
    });
    expect(t.passes?.onnxTransforms).toBe(true);
  });

  // ── replacePasses option ────────────────────────────────────────────

  it("replacePasses: true clears passRecipeOverrides and uses only recipe passes", () => {
    const state = deriveUiStateFromOliveRecipe(
      {
        passes: { quant: { type: "Quantization", config: { bits: 8 } } },
      },
      { replacePasses: true },
    );
    expect(state.passes?.quantization).toBe(true);
    // With replacePasses, the full DEFAULT_PASSES are NOT merged in
    // so untoggled flags like conversion/pruning should remain false
    expect(state.passes?.conversion).toBe(false);
    expect(state.passes?.pruning).toBe(false);
    expect(state.passRecipeOverrides).toEqual({});
  });

  it("replacePasses: false merges recipe passes onto DEFAULT_PASSES", () => {
    const state = deriveUiStateFromOliveRecipe(
      {
        passes: { quant: { type: "Quantization", config: { bits: 8 } } },
      },
      { replacePasses: false },
    );
    expect(state.passes?.quantization).toBe(true);
  });

  // ── full recipe smoke ───────────────────────────────────────────────

  it("derives all fields from a realistic multi-pass recipe", () => {
    const state = deriveUiStateFromOliveRecipe({
      input_model: {
        config: {
          hf_config: { model_name: "microsoft/phi-2", task: "text-generation", dataset: "wikitext" },
        },
      },
      systems: {
        gpu: {
          config: { accelerators: [{ execution_providers: ["CUDAExecutionProvider"] }] },
        },
      },
      passes: {
        conv: { type: "OnnxConversion", config: { target_opset: 17 } },
        quant: { type: "AutoAWQQuantizer", config: { bits: 4, group_size: 128, damp_percent: 0.01, sym: true } },
      },
    });
    expect(state.modelSource).toBe("huggingface");
    expect(state.hfModelId).toBe("microsoft/phi-2");
    expect(state.hfTask).toBe("text-generation");
    expect(state.hfDataset).toBe("wikitext");
    expect(state.ihvProvider).toBe("CUDAExecutionProvider");
    expect(state.passes?.conversion).toBe(true);
    expect(state.passes?.conversionFormat).toBe("onnx");
    expect(state.passes?.conversionOpset).toBe(17);
    expect(state.passes?.quantization).toBe(true);
    expect(state.passes?.quantMethod).toBe("awq");
    expect(state.passes?.quantPrecision).toBe("int4");
    expect(state.passes?.awqGroupSize).toBe(128);
  });

  // ── undefined / null / non-object parsed ────────────────────────────

  it("returns empty state for null parsed input", () => {
    const state = deriveUiStateFromOliveRecipe(null);
    expect(state.ihvProvider).toBeUndefined();
    expect(state.modelSource).toBeUndefined();
    expect(state.passes).toBeUndefined();
  });

  it("returns empty state for non-object parsed input", () => {
    const state = deriveUiStateFromOliveRecipe("not an object");
    expect(state.ihvProvider).toBeUndefined();
    expect(state.modelSource).toBeUndefined();

  });

  it("ignores non-object pruning config when mapping criteria", () => {
    const withNull = deriveUiStateFromOliveRecipe(
      { passes: { prune: { type: "SparseGPT", config: null } } },
      { replacePasses: true },
    );
    expect(withNull.passes?.pruning).toBe(true);
    expect(withNull.passes?.pruningMethod).toBe("sparsegpt");
    // null config must not invent criteria; inactive default remains
    expect(withNull.passes?.pruningCriteria).toBe("l1_norm");

    const withString = deriveUiStateFromOliveRecipe(
      {
        passes: {
          prune: {
            type: "SparseGPT",
            config: "not-an-object",
          },
        },
      },
      { replacePasses: true },
    );
    expect(withString.passes?.pruning).toBe(true);
    expect(withString.passes?.pruningCriteria).toBe("l1_norm");

    const withValid = deriveUiStateFromOliveRecipe(
      {
        passes: {
          prune: {
            type: "SparseGPT",
            config: { pruning_criteria: "l2_norm", sparsity: 0.4 },
          },
        },
      },
      { replacePasses: true },
    );
    expect(withValid.passes?.pruningCriteria).toBe("l2_norm");
  });
});

describe("mapExecutionProviderFromRecipe", () => {
  it("extracts execution provider from structured recipe object", () => {
    const recipe = recipeWithExecutionProviders(["WebGpuExecutionProvider"]);
    expect(mapExecutionProviderFromRecipe(recipe)).toBe("WebGpuExecutionProvider");
  });

  it("extracts execution provider directly from JSON string", () => {
    const recipeJson = JSON.stringify(recipeWithExecutionProviders(["WebGpuExecutionProvider"]));
    expect(mapExecutionProviderFromRecipe(recipeJson)).toBe("WebGpuExecutionProvider");
  });

  it("returns undefined for invalid JSON string or missing systems", () => {
    expect(mapExecutionProviderFromRecipe("invalid json")).toBeUndefined();
    expect(mapExecutionProviderFromRecipe({})).toBeUndefined();
  });
});

