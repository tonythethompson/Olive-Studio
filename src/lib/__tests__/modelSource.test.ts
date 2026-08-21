import { describe, it, expect } from "vitest";
import type { UIState } from "@/types";
import { getEffectiveModelSource } from "@/lib/modelSource";
import { baseState } from "@/lib/__tests__/testState";
describe("getEffectiveModelSource", () => {
  it("prefers the active tab when it has a model", () => {
    const state = baseState({
      modelSource: "local",
      localFiles: [{ name: "model.bin", size: 1024 }],
      hfModelId: "microsoft/phi-3",
    });
    expect(getEffectiveModelSource(state)).toBe("local");
  });

  it("falls back to a Hugging Face model when the active Local tab is empty", () => {
    const state = baseState({
      modelSource: "local",
      localFiles: [],
      hfModelId: "microsoft/Phi-3.5-mini-instruct",
    });
    expect(getEffectiveModelSource(state)).toBe("huggingface");
  });

  it("falls back to an Azure path when the active Local tab is empty", () => {
    const state = baseState({
      modelSource: "local",
      localFiles: [],
      azureModelPath: "azureml://models/m/versions/1",
    });
    expect(getEffectiveModelSource(state)).toBe("azure");
  });

  it("falls back to Azure when the active Hugging Face tab has no model", () => {
    const state = baseState({
      modelSource: "huggingface",
      hfModelId: "   ",
      azureModelPath: "azureml://models/m/versions/1",
    });
    expect(getEffectiveModelSource(state)).toBe("azure");
  });

  it("falls back to Local when the active Hugging Face tab has no model", () => {
    const state = baseState({
      modelSource: "huggingface",
      hfModelId: "",
      localFiles: [{ name: "model.safetensors", size: 1024 }],
    });
    expect(getEffectiveModelSource(state)).toBe("local");
  });

  it("prefers Local over Azure in fallback order when the active tab is empty", () => {
    const state = baseState({
      modelSource: "huggingface",
      hfModelId: "",
      localFiles: [{ name: "model.safetensors", size: 1024 }],
      azureModelPath: "azureml://models/m/versions/1",
    });
    expect(getEffectiveModelSource(state)).toBe("local");
  });

  it("returns null when no source has any model", () => {
    const state = baseState({ modelSource: "local", localFiles: [] });
    expect(getEffectiveModelSource(state)).toBeNull();
  });

  it("is defensive against partial states (missing fields)", () => {
    const partial = { ihvProvider: "cuda", passes: [] } as unknown as UIState;
    expect(getEffectiveModelSource(partial)).toBeNull();
  });
});
