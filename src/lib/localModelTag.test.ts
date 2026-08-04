import { describe, expect, it } from "vitest";
import { isValidLocalModelTag } from "./localModelTag";
import {
  findInstalledStarterId,
  LMS_STARTER_MODELS,
  normalizeModelIdStem,
  resolveLocalEnableModelId,
} from "../components/features/gemini/aiProviderCatalog";

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
});
