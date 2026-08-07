import { describe, expect, it } from "vitest";
import {
  buildOwrConfigs,
  deduceOwrArchitecture,
  OWR_NNAPI_EP,
  OWR_WEB_GPU_EP,
  OWR_WASM_EP,
  OWR_XNNPACK_EP,
  resolveOwrModelName,
  studioNnapiToOwrEp,
  studioWebGpuToOwrEp,
  STUDIO_NNAPI_EP,
  STUDIO_WEB_GPU_EP,
} from "@/lib/owrExportConfigs";
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

  it("keeps intentional Studio vs OWR EP spelling dualism", () => {
    expect(STUDIO_WEB_GPU_EP).toBe("WebGpuExecutionProvider");
    expect(studioWebGpuToOwrEp()).toBe(OWR_WEB_GPU_EP);
    expect(OWR_WEB_GPU_EP).toBe("WebGPUExecutionProvider");
    expect(STUDIO_NNAPI_EP).toBe("NNAPIExecutionProvider");
    expect(studioNnapiToOwrEp()).toBe(OWR_NNAPI_EP);
    expect(OWR_NNAPI_EP).toBe("NnapiExecutionProvider");
  });

  it("builds web and mobile configs without throwing", () => {
    const configs = buildOwrConfigs({
      state: minimalState(),
      platform: "web",
      threads: "4",
      vramMode: "performance",
    });
    expect(configs.ortConfig.session_options.execution_providers).toEqual([
      OWR_WEB_GPU_EP,
      OWR_WASM_EP,
    ]);
    expect(configs.manifestConfig.model_metadata.architecture).toBe("Llama");
    expect(configs.webInitCode).toContain("webgpu");
    expect(configs.mobileInitCode).toContain("OnnxModelExecutor");

    const mobile = buildOwrConfigs({
      state: minimalState(),
      platform: "mobile",
      threads: "2",
      vramMode: "memory",
    });
    expect(mobile.ortConfig.session_options.execution_providers).toEqual([
      OWR_XNNPACK_EP,
      OWR_NNAPI_EP,
    ]);
  });
});
