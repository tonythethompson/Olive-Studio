import { describe, expect, it } from "vitest";
import { deriveUiStateFromOliveRecipe } from "../oliveRecipeHub";

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
});
