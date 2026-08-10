import { describe, it, expect, beforeEach } from "vitest";
import { usePipelineStore, createDefaultPipelineState } from "@/lib/stores/pipelineStore";
import { applyMigrations } from "@/lib/passMigration";
import { commitUiStateUpdate, coercePassFields } from "@/lib/pipelineStateCommit";
import { usePlaygroundStore } from "@/lib/stores/playgroundStore";
import { DEFAULT_PASSES } from "@/lib/defaultPasses";
import type { UIState } from "@/types";

describe("pipelineStore", () => {
  beforeEach(() => {
    usePipelineStore.getState().resetState();
  });

  it("initializes with default state", () => {
    const { state } = usePipelineStore.getState();
    expect(state.modelSource).toBe("huggingface");
    expect(state.hfModelId).toBe("");
    expect(state.ihvProvider).toBe("CPUExecutionProvider");
    expect(state.passes.conversion).toBe(true);
    expect(state.passes.quantization).toBe(false);
  });

  it("setState merges partial updates", () => {
    usePipelineStore.getState().setState({ hfModelId: "mistralai/Mistral-7B-v0.3" });
    const { state } = usePipelineStore.getState();
    expect(state.hfModelId).toBe("mistralai/Mistral-7B-v0.3");
    // Other fields unchanged
    expect(state.modelSource).toBe("huggingface");
  });

  it("setState merges passes shallowly", () => {
    usePipelineStore.getState().setState({
      passes: { ...DEFAULT_PASSES, quantization: true },
    });
    const { state } = usePipelineStore.getState();
    expect(state.passes.quantization).toBe(true);
    // Other pass fields preserved
    expect(state.passes.conversion).toBe(true);
  });

  it("setState runs sanitization (coerces invalid pass combinations)", () => {
    // pruning + quantization at INT4 is invalid: sanitizer coerces precision to INT8
    usePipelineStore.getState().setState({
      ihvProvider: "CUDAExecutionProvider",
      passes: {
        ...DEFAULT_PASSES,
        quantization: true,
        quantMethod: "ptq",
        quantPrecision: "int4",
        pruning: true,
      },
    });
    const { state } = usePipelineStore.getState();
    expect(state.passes.quantPrecision).toBe("int8");
    expect(state.passes.pruning).toBe(true);
    expect(state.passes.quantization).toBe(true);
  });

  it("replaceState replaces the entire state", () => {
    const newState = {
      modelSource: "local" as const,
      localFiles: [{ name: "model.onnx", size: 1024 }],
      azureModelPath: "",
      hfModelId: "",
      hfDataset: "",
      ihvProvider: "CUDAExecutionProvider" as const,
      openvinoTargetDevice: "CPU" as const,
      memoryOffload: "gpu_only" as const,
      cudaVersion: "cu121" as const,
      cacheDir: "/tmp/cache",
      azureStr: "",
      distributedCaching: true,
      activeJobId: null,
      passes: { ...DEFAULT_PASSES, conversion: false },
    };
    usePipelineStore.getState().replaceState(newState);
    const { state } = usePipelineStore.getState();
    expect(state.modelSource).toBe("local");
    expect(state.ihvProvider).toBe("CUDAExecutionProvider");
    expect(state.passes.conversion).toBe(false);
  });

  it("replaceState migrates deprecated passRecipeOverrides", () => {
    usePipelineStore.getState().replaceState({
      ...createDefaultPipelineState(),
      passRecipeOverrides: {
        MobiusModelBuilder: { model_name: "phi-2" },
        QairtPreparation: { mode: "calibrate" },
        OnnxConversion: { target_opset: 20 },
      },
    } as UIState);
    const { state } = usePipelineStore.getState();
    expect(state.passRecipeOverrides?.MobiusBuilder).toEqual({ model_name: "phi-2" });
    expect(state.passRecipeOverrides).not.toHaveProperty("MobiusModelBuilder");
    expect(state.passRecipeOverrides).not.toHaveProperty("QairtPreparation");
    expect(state.passRecipeOverrides?.OnnxConversion).toEqual({ target_opset: 20 });
  });

  it("replaceState keeps MobiusBuilder authoritative over legacy MobiusModelBuilder", () => {
    usePipelineStore.getState().replaceState({
      ...createDefaultPipelineState(),
      passRecipeOverrides: {
        MobiusModelBuilder: { model_name: "legacy" },
        MobiusBuilder: { model_name: "current" },
      },
    } as UIState);
    const { state } = usePipelineStore.getState();
    expect(state.passRecipeOverrides?.MobiusBuilder).toEqual({ model_name: "current" });
    expect(state.passRecipeOverrides).not.toHaveProperty("MobiusModelBuilder");
  });

  it("rehydration merge path migrates persisted legacy overrides", () => {
    const merged = {
      ...createDefaultPipelineState(),
      hfModelId: "mistralai/Mistral-7B-v0.1",
      passes: { ...DEFAULT_PASSES, quantization: true },
      passRecipeOverrides: {
        MobiusModelBuilder: { model_name: "mistral" },
        QairtGenAIBuilder: { recipe: "default" },
      },
    } as UIState;
    const { state: migrated } = applyMigrations(merged);
    const committed = commitUiStateUpdate(migrated, {});
    expect(committed.passRecipeOverrides?.MobiusBuilder).toEqual({ model_name: "mistral" });
    expect(committed.passRecipeOverrides).not.toHaveProperty("MobiusModelBuilder");
    expect(committed.passRecipeOverrides).not.toHaveProperty("QairtGenAIBuilder");
  });

  it("coerces PEFT off when provider is QnnAbiExecutionProvider", () => {
    const next = coercePassFields(
      { ...DEFAULT_PASSES, peft: true },
      "QnnAbiExecutionProvider",
    );
    expect(next.peft).toBe(false);
  });

  it("resetState restores defaults", () => {
    usePipelineStore.getState().setState({ hfModelId: "test/model", ihvProvider: "CUDAExecutionProvider" });
    usePipelineStore.getState().resetState();
    const { state } = usePipelineStore.getState();
    expect(state.hfModelId).toBe("");
    expect(state.ihvProvider).toBe("CPUExecutionProvider");
  });

  it("resetState does not touch playground store fields", () => {
    usePlaygroundStore.getState().setActiveSubView("arena");
    usePlaygroundStore.getState().setSlotA({ type: "cloud", apiKey: "sk-test" });
    usePipelineStore.getState().resetState();
    expect(usePlaygroundStore.getState().activeSubView).toBe("arena");
    expect(usePlaygroundStore.getState().slotA.apiKey).toBe("sk-test");
  });
});
