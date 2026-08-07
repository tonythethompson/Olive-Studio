import { describe, expect, it } from "vitest";
import {
  deriveUiStateFromOliveRecipe,
  getCatalogDeviceFromRecipe,
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

  it("maps a valid execution provider token to ihvProvider", () => {
    const state = deriveUiStateFromOliveRecipe(recipeWithExecutionProviders(["CUDAExecutionProvider"]));
    expect(state.ihvProvider).toBe("CUDAExecutionProvider");
  });

  it("ignores malformed execution_providers instead of casting them into a provider", () => {
    const fromObject = deriveUiStateFromOliveRecipe(
      recipeWithExecutionProviders([{ not: "a-provider" }]),
    );
    expect(fromObject.ihvProvider).toBeUndefined();

    const fromNonArray = deriveUiStateFromOliveRecipe(
      recipeWithExecutionProviders("CUDAExecutionProvider"),
    );
    expect(fromNonArray.ihvProvider).toBeUndefined();

    const fromBadSystems = deriveUiStateFromOliveRecipe({
      systems: "local_system",
    });
    expect(fromBadSystems.ihvProvider).toBeUndefined();

    const fromBadAccelerators = deriveUiStateFromOliveRecipe({
      systems: {
        local_system: {
          config: { accelerators: "CUDAExecutionProvider" },
        },
      },
    });
    expect(fromBadAccelerators.ihvProvider).toBeUndefined();
  });

  it("maps catalog device labels from valid providers and ignores malformed ones", () => {
    expect(getCatalogDeviceFromRecipe(recipeWithExecutionProviders(["OpenVINOExecutionProvider"]))).toBe(
      "OpenVINO",
    );
    expect(getCatalogDeviceFromRecipe(recipeWithExecutionProviders([42]))).toBeUndefined();
    expect(getCatalogDeviceFromRecipe(recipeWithExecutionProviders(null))).toBeUndefined();
  });

  it("accepts a string model_path as the HF model id when no hf_config.model_name is present", () => {
    const state = deriveUiStateFromOliveRecipe({
      input_model: {
        model_path: "org/model-name",
        config: {},
      },
    });
    expect(state.modelSource).toBe("huggingface");
    expect(state.hfModelId).toBe("org/model-name");
  });

  it("ignores non-string model_path values", () => {
    const state = deriveUiStateFromOliveRecipe({
      input_model: {
        model_path: { path: "org/model-name" },
        config: {
          model_path: ["not", "a", "string"],
          hf_config: { model_name: { bad: true } },
        },
      },
    });
    expect(state.hfModelId).toBeUndefined();
    expect(state.modelSource).toBeUndefined();
    expect(state.azureModelPath).toBeUndefined();
  });

  it("maps valid quantization and pruning pass configs into UI passes", () => {
    const state = deriveUiStateFromOliveRecipe(
      {
        passes: {
          awq: { type: "AutoAWQQuantization", config: { group_size: 64, sym: true } },
          prune: {
            type: "SparseGPT",
            config: { sparsity: 0.5, pruning_criteria: "l2_norm", semi_sparse_acc: true },
          },
        },
      },
      { replacePasses: true },
    );

    expect(state.passes?.quantization).toBe(true);
    expect(state.passes?.quantMethod).toBe("awq");
    expect(state.passes?.awqGroupSize).toBe(64);
    expect(state.passes?.awqSym).toBe(true);
    expect(state.passes?.pruning).toBe(true);
    expect(state.passes?.pruningMethod).toBe("sparsegpt");
    expect(state.passes?.pruningSparsity).toBe(0.5);
    expect(state.passes?.pruningType).toBe("structured");
    expect(state.passes?.pruningCriteria).toBe("l2_norm");
  });

  it("ignores malformed passes / pass-config shapes instead of accepting them via casts", () => {
    const arrayPasses = deriveUiStateFromOliveRecipe(
      { passes: [{ type: "AutoAWQQuantization", config: {} }] },
      { replacePasses: true },
    );
    expect(arrayPasses.passes).toBeUndefined();

    const junkEntries = deriveUiStateFromOliveRecipe(
      {
        passes: {
          ok: { type: "OnnxConversion", config: { target_opset: 17 } },
          badNull: null,
          badString: "AutoAWQQuantization",
          badConfig: { type: "AutoAWQQuantization", config: "not-an-object" },
        },
      },
      { replacePasses: true },
    );
    expect(junkEntries.passes?.conversion).toBe(true);
    expect(junkEntries.passes?.conversionFormat).toBe("onnx");
    expect(junkEntries.passes?.conversionOpset).toBe(17);
    // string config is treated as empty config object fallback — method still maps from type
    expect(junkEntries.passes?.quantization).toBe(true);
    expect(junkEntries.passes?.quantMethod).toBe("awq");
  });
});
