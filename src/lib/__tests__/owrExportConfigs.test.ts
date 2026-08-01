import { describe, expect, it } from "vitest";
import { buildOwrConfigs, deduceOwrArchitecture, resolveOwrModelName } from "@/lib/owrExportConfigs";
import type { UIState } from "@/types";

function minimalState(overrides: Partial<UIState> = {}): UIState {
  return {
    hfModelId: "meta-llama/Meta-Llama-3-8B",
    localFiles: [],
    passes: {
      quantization: true,
      quantPrecision: "int8",
      conversionInputTargetTypes: "float16",
    },
    ...overrides,
  } as UIState;
}

describe("owrExportConfigs", () => {
  it("deduces architecture from model names", () => {
    expect(deduceOwrArchitecture("Meta-Llama-3-8B")).toBe("Llama");
    expect(deduceOwrArchitecture("phi-3-mini")).toBe("Phi");
    expect(deduceOwrArchitecture("whisper-tiny")).toBe("Whisper");
    expect(deduceOwrArchitecture("stable-diffusion-xl")).toBe("Stable Diffusion");
    expect(deduceOwrArchitecture("custom-decoder")).toBe("DecoderLLM");
  });

  it("resolves model basename from HF id or local file", () => {
    expect(resolveOwrModelName({ hfModelId: "org/model-name", localFiles: [] })).toBe("model-name");
    expect(
      resolveOwrModelName({
        hfModelId: "",
        localFiles: [{ name: "weights.bin", size: 1 }],
      }),
    ).toBe("weights.bin");
  });

  it("builds web and mobile configs without throwing", () => {
    const configs = buildOwrConfigs({
      state: minimalState(),
      platform: "web",
      threads: "4",
      vramMode: "performance",
    });
    expect(configs.ortConfig.session_options.execution_providers).toContain("WebGPUExecutionProvider");
    expect(configs.manifestConfig.model_metadata.architecture).toBe("Llama");
    expect(configs.webInitCode).toContain("webgpu");
    expect(configs.mobileInitCode).toContain("OnnxModelExecutor");
  });
});
