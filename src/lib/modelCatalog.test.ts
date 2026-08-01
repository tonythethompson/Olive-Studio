import { describe, it, expect } from "vitest";
import {
  catalogModelsFromOpenAiCompatRows,
  isLikelyChatModelId,
  normalizeCatalogModels,
  resolveCatalogSelection,
} from "./modelCatalog.ts";

describe("isLikelyChatModelId", () => {
  it("keeps chat models", () => {
    expect(isLikelyChatModelId("meta/llama-3.1-8b-instruct")).toBe(true);
    expect(isLikelyChatModelId("google/gemma-3-12b-it")).toBe(true);
    expect(isLikelyChatModelId("gpt-4o")).toBe(true);
  });

  it("drops embeddings and non-chat modalities by id", () => {
    expect(isLikelyChatModelId("text-embedding-3-large")).toBe(false);
    expect(isLikelyChatModelId("nvidia/nv-embedqa-e5-v5")).toBe(false);
    expect(isLikelyChatModelId("openai/whisper-large-v3")).toBe(false);
    expect(isLikelyChatModelId("black-forest-labs/FLUX.1-dev")).toBe(false);
    expect(isLikelyChatModelId("stabilityai/stable-diffusion-xl")).toBe(false);
  });
});

describe("catalogModelsFromOpenAiCompatRows", () => {
  it("filters by architecture modality when present", () => {
    const models = catalogModelsFromOpenAiCompatRows([
      { id: "chat/ok", architecture: { modality: "text->text", output_modalities: ["text"] } },
      { id: "embed/bad", architecture: { modality: "text->embedding", output_modalities: ["embeddings"] } },
      { id: "text-embedding-ada-002" },
    ]);
    expect(models.map((m) => m.id)).toEqual(["chat/ok"]);
  });
});

describe("resolveCatalogSelection", () => {
  it("keeps in-catalog selection", () => {
    const catalog = normalizeCatalogModels([{ id: "a" }, { id: "b" }]);
    expect(resolveCatalogSelection(["b"], catalog)).toEqual({ nextId: "b", staleId: null });
  });

  it("replaces stale selection with first live model", () => {
    const catalog = normalizeCatalogModels([{ id: "a" }, { id: "b" }]);
    expect(resolveCatalogSelection(["gone"], catalog)).toEqual({ nextId: "a", staleId: "gone" });
  });

  it("clears when catalog is empty", () => {
    expect(resolveCatalogSelection(["gone"], [])).toEqual({ nextId: "", staleId: "gone" });
  });
});
