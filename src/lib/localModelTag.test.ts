import { describe, expect, it } from "vitest";
import { isValidLocalModelTag } from "./localModelTag";
import {
  findInstalledStarterId,
  LMS_STARTER_MODELS,
  OLLAMA_STARTER_MODELS,
  normalizeModelIdStem,
  resolveLocalEnableModelId,
  stemsLooselyMatch,
} from "./localEngineStarters";

describe("isValidLocalModelTag", () => {
  it("accepts Hugging Face model URLs and short engine ids", () => {
    expect(
      isValidLocalModelTag(
        "https://huggingface.co/lmstudio-community/Qwen2.5-Coder-1.5B-Instruct-GGUF",
      ),
    ).toBe(true);
    expect(
      isValidLocalModelTag(
        "https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf",
      ),
    ).toBe(true);
    expect(isValidLocalModelTag("llama-3.2-1b-instruct")).toBe(true);
    expect(isValidLocalModelTag("qwen2.5-coder:1.5b")).toBe(true);
  });

  it("rejects unsafe or empty tags", () => {
    expect(isValidLocalModelTag("")).toBe(false);
    expect(isValidLocalModelTag("-y")).toBe(false);
    expect(isValidLocalModelTag("foo bar")).toBe(false);
    expect(isValidLocalModelTag("https://evil.example/model")).toBe(false);
    expect(isValidLocalModelTag("../models/foo")).toBe(false);
    expect(isValidLocalModelTag("../../foo")).toBe(false);
    expect(isValidLocalModelTag("./models/foo")).toBe(false);
    expect(isValidLocalModelTag("/abs/path")).toBe(false);
    expect(isValidLocalModelTag("C:\\models\\foo")).toBe(false);
  });
});

describe("local starter enable resolution", () => {
  it("matches installed LMS keys after HF download tags", () => {
    const qwen = LMS_STARTER_MODELS[0]!;
    expect(findInstalledStarterId(qwen, ["qwen2.5-coder-1.5b-instruct"])).toBe(
      "qwen2.5-coder-1.5b-instruct",
    );
    expect(
      resolveLocalEnableModelId(qwen.tag, qwen.enableTag, ["qwen2.5-coder-1.5b-instruct"]),
    ).toBe("qwen2.5-coder-1.5b-instruct");
  });

  it("normalizes HF resolve URLs to repo stems", () => {
    expect(
      normalizeModelIdStem(
        "https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf",
      ),
    ).toContain("phi35miniinstruct");
  });

  it("rejects short fuzzy stems that would cross-match models", () => {
    expect(stemsLooselyMatch("a", "ba")).toBe(false);
    expect(stemsLooselyMatch("phi35", "phi35miniinstruct")).toBe(false);
    expect(stemsLooselyMatch("qwen25coder15b", "qwen25coder15binstruct")).toBe(true);
    expect(
      findInstalledStarterId(
        { enableTag: "other", match: "coder", tag: "coder" },
        ["qwen2.5-coder-1.5b-instruct", "other-model"],
      ),
    ).toBeNull();
  });

  it("resolves Ollama starters against engine-tag catalog (including :latest)", () => {
    const phi = OLLAMA_STARTER_MODELS.find((m) => m.name.includes("Phi-3.5"));
    expect(phi).toBeDefined();
    expect(phi!.tag).toBe("phi3.5:3.8b");
    expect(phi!.enableTag).toBe(phi!.tag);
    expect(phi!.match).toBe(phi!.tag);
    expect(findInstalledStarterId(phi!, [phi!.enableTag])).toBe(phi!.enableTag);
    expect(findInstalledStarterId(phi!, ["phi3.5:latest"])).toBe("phi3.5:latest");
    for (const starter of OLLAMA_STARTER_MODELS) {
      expect(findInstalledStarterId(starter, [starter.enableTag])).toBe(starter.enableTag);
    }
    for (const starter of LMS_STARTER_MODELS) {
      expect(findInstalledStarterId(starter, [starter.enableTag])).toBe(starter.enableTag);
    }
  });
});
