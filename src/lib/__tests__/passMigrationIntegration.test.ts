/**
 * Integration tests for pass migration (Task 11.1).
 * Concrete fixture-based scenarios for the migration + recipe pipeline.
 */
import { describe, it, expect } from "vitest";
import { applyMigrations } from "@/lib/passMigration";
import { createDefaultPipelineState } from "@/lib/stores/pipelineStore";
import { commitUiStateUpdate } from "@/lib/pipelineValidation";
import { buildOliveRecipe } from "@/lib/oliveRecipeBuilder";
import type { UIState } from "@/types";

describe("passMigration integration", () => {
  describe("MobiusModelBuilder rename", () => {
    it("renames MobiusModelBuilder to MobiusBuilder in passRecipeOverrides", () => {
      const state: UIState = {
        ...createDefaultPipelineState(),
        passRecipeOverrides: {
          MobiusModelBuilder: { model_name: "phi-2", cache_config: "default" },
          OnnxConversion: { target_opset: 20 },
        },
      } as UIState;

      const result = applyMigrations(state);

      // Should rename the key.
      expect(result.state.passRecipeOverrides).toHaveProperty("MobiusBuilder");
      expect(result.state.passRecipeOverrides).not.toHaveProperty("MobiusModelBuilder");

      // Should preserve the override values.
      expect(result.state.passRecipeOverrides!.MobiusBuilder).toEqual({
        model_name: "phi-2",
        cache_config: "default",
      });

      // Other entries preserved.
      expect(result.state.passRecipeOverrides!.OnnxConversion).toEqual({ target_opset: 20 });

      // Counts correct.
      expect(result.renamedPasses).toEqual([
        { oldName: "MobiusModelBuilder", newName: "MobiusBuilder" },
      ]);
      expect(result.removedPasses).toEqual([]);
    });

    it("preserves MobiusBuilder override when legacy MobiusModelBuilder key also exists", () => {
      const state: UIState = {
        ...createDefaultPipelineState(),
        passRecipeOverrides: {
          MobiusModelBuilder: { model_name: "legacy" },
          MobiusBuilder: { model_name: "current" },
        },
      } as UIState;

      const result = applyMigrations(state);

      expect(result.state.passRecipeOverrides?.MobiusBuilder).toEqual({ model_name: "current" });
      expect(result.state.passRecipeOverrides).not.toHaveProperty("MobiusModelBuilder");
      expect(result.renamedPasses).toEqual([
        { oldName: "MobiusModelBuilder", newName: "MobiusBuilder" },
      ]);
    });
  });

  describe("QairtPreparation and QairtGenAIBuilder removal", () => {
    it("removes both passes and surfaces them in removedPasses", () => {
      const state: UIState = {
        ...createDefaultPipelineState(),
        passRecipeOverrides: {
          QairtPreparation: { mode: "calibrate" },
          QairtGenAIBuilder: { recipe_path: "/path/to/recipe.yaml" },
          OnnxQuantization: { quant_mode: "static" },
        },
      } as UIState;

      const result = applyMigrations(state);

      // Removed passes gone from overrides.
      expect(result.state.passRecipeOverrides).not.toHaveProperty("QairtPreparation");
      expect(result.state.passRecipeOverrides).not.toHaveProperty("QairtGenAIBuilder");

      // Valid passes preserved.
      expect(result.state.passRecipeOverrides!.OnnxQuantization).toEqual({ quant_mode: "static" });

      // Counts correct.
      expect(result.removedPasses).toContain("QairtPreparation");
      expect(result.removedPasses).toContain("QairtGenAIBuilder");
      expect(result.removedPasses.length).toBe(2);
      expect(result.renamedPasses).toEqual([]);
    });

    it("removes passRecipeOverrides entirely when all passes are removed", () => {
      const state: UIState = {
        ...createDefaultPipelineState(),
        passRecipeOverrides: {
          QairtPreparation: { mode: "calibrate" },
        },
      } as UIState;

      const result = applyMigrations(state);
      expect(result.state.passRecipeOverrides).toBeUndefined();
    });
  });

  describe("trust_remote_code in built recipe", () => {
    it("emits trust_remote_code: true for HuggingFace models", () => {
      const state = createDefaultPipelineState();
      state.modelSource = "huggingface";
      state.hfModelId = "microsoft/phi-2";
      state.passes.trustRemoteCode = true;

      const coerced = commitUiStateUpdate(state, {});
      const recipe = buildOliveRecipe(coerced) as Record<string, unknown>;
      const inputModel = recipe.input_model as Record<string, unknown>;
      const config = inputModel.config as Record<string, unknown>;

      expect(config.trust_remote_code).toBe(true);
    });

    it("does not emit trust_remote_code when trustRemoteCode is false (default)", () => {
      const state = createDefaultPipelineState();
      state.modelSource = "huggingface";
      state.hfModelId = "microsoft/phi-2";
      expect(state.passes.trustRemoteCode).toBe(false);

      const coerced = commitUiStateUpdate(state, {});
      const recipe = buildOliveRecipe(coerced) as Record<string, unknown>;
      const config = (recipe.input_model as Record<string, unknown>).config as Record<string, unknown>;

      expect(config.trust_remote_code).toBeUndefined();
    });

    it("does not emit trust_remote_code for local models", () => {
      const state = createDefaultPipelineState();
      state.modelSource = "local";
      state.passes.trustRemoteCode = true;

      const coerced = commitUiStateUpdate(state, {});
      const recipe = buildOliveRecipe(coerced) as Record<string, unknown>;
      const inputModel = recipe.input_model as Record<string, unknown>;
      const config = (inputModel.config as Record<string, unknown>) ?? {};

      // Local models don't use trust_remote_code.
      expect(config.trust_remote_code).toBeUndefined();
    });
  });

  describe("full pipeline round-trip", () => {
    it("migrated state produces valid recipe through recipe builder", () => {
      const state: UIState = {
        ...createDefaultPipelineState(),
        modelSource: "huggingface",
        hfModelId: "mistralai/Mistral-7B-v0.1",
        passRecipeOverrides: {
          MobiusModelBuilder: { model_name: "mistral" },
          QairtGenAIBuilder: { recipe: "default" },
          OnnxConversion: { target_opset: 20 },
        },
      } as UIState;

      const { state: migrated } = applyMigrations(state);
      const coerced = commitUiStateUpdate(migrated, {});
      const recipe = buildOliveRecipe(coerced);

      expect(recipe).toBeDefined();
      expect(recipe).toHaveProperty("passes");
      expect(recipe).toHaveProperty("input_model");
    });
  });
});
