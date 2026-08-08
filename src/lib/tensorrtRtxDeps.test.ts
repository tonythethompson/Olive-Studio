import { describe, expect, it } from "vitest";
import {
  PINNED_TENSORRT_VERSION, pinnedTensorRtInstallArgs, pinnedTensorRtLabel,
} from "./tensorrtDeps.ts";
import {
  TENSORRT_RTX_EP_ABI_PACKAGE,
  TENSORRT_RTX_EP_ABI_VERSION,
  TENSORRT_RTX_NVIDIA_INDEX_URL,
  TENSORRT_RTX_PIP_PACKAGE,
  isNvTensorRtRtxCatalogPath,
  isNvTensorRtRtxProvider,
  tensorrtRtxEpAbiInstallArgs,
  tensorrtRtxEpAbiInstallCommand,
  tensorrtRtxEpAbiLabel,
  tensorrtRtxInstallArgs,
  tensorrtRtxLabel,
} from "./tensorrtRtxDeps.ts";

/**
 * The PyPI `tensorrt-rtx` package alone does not register
 * NvTensorRTRTXExecutionProvider with onnxruntime. Registration only
 * happens after the NVIDIA EP-ABI plugin package
 * (`onnxruntime-ep-nv-tensorrt-rtx-cu13`) is installed and its op-library
 * DLL is registered with `onnxruntime.register_execution_provider_library`.
 * Tests here lock down the install-args shape, the label, the discovery
 * script, and provider/catalog recognition.
 */
describe("tensorrt-rtx deps", () => {
  it("keeps the PyPI py-name and Surface label for the runtime package", () => {
    expect(TENSORRT_RTX_PIP_PACKAGE).toBe("tensorrt-rtx");
    expect(tensorrtRtxInstallArgs()).toEqual(["tensorrt-rtx"]);
    expect(tensorrtRtxLabel()).toBe("tensorrt-rtx");
  });

  it("pins the NVIDIA EP-ABI plugin package name and version", () => {
    expect(TENSORRT_RTX_EP_ABI_PACKAGE).toBe("onnxruntime-ep-nv-tensorrt-rtx-cu13");
    expect(TENSORRT_RTX_EP_ABI_VERSION).toBe("0.3.0");
    expect(TENSORRT_RTX_NVIDIA_INDEX_URL).toBe("https://pypi.nvidia.com");
  });

  it("returns pip install args that include the NVIDIA extra-index-url", () => {
    const args = tensorrtRtxEpAbiInstallArgs();
    expect(args).toContain("--extra-index-url");
    expect(args).toContain(TENSORRT_RTX_NVIDIA_INDEX_URL);
    expect(args).toContain(`${TENSORRT_RTX_EP_ABI_PACKAGE}==${TENSORRT_RTX_EP_ABI_VERSION}`);
    // Pass a single requirement token (never split into a bare ==version).
    expect(args.filter((a) => a.startsWith("=="))).toEqual([]);
  });

  it("labels the EP-ABI plugin like the runtime package does", () => {
    expect(tensorrtRtxEpAbiLabel()).toBe(
      `${TENSORRT_RTX_EP_ABI_PACKAGE} (${TENSORRT_RTX_EP_ABI_VERSION})`,
    );
  });

  it("returns a copy-pasteable pip install command in the manual-install hint", () => {
    expect(tensorrtRtxEpAbiInstallCommand()).toBe(
      `pip install --extra-index-url ${TENSORRT_RTX_NVIDIA_INDEX_URL} ` +
        `${TENSORRT_RTX_EP_ABI_PACKAGE}==${TENSORRT_RTX_EP_ABI_VERSION}`,
    );
    // The hint must contain a parseable package==version spec, not the
    // human-readable label "(0.3.0)" form.
    expect(tensorrtRtxEpAbiInstallCommand()).not.toContain(" (");
    expect(tensorrtRtxEpAbiInstallCommand()).toMatch(/==\d+\.\d+\.\d+/);
  });

  it("matches the canonical provider name only", () => {
    expect(isNvTensorRtRtxProvider("NvTensorRTRTXExecutionProvider")).toBe(true);
    for (const wrong of [
      "TensorrtExecutionProvider",
      "nvtensorrtrtxexecutionprovider".toLowerCase(),
      "CUDAExecutionProvider",
      "CPUExecutionProvider",
      "",
    ]) {
      expect(isNvTensorRtRtxProvider(wrong)).toBe(false);
    }
  });

  it("recognises catalog paths that mention the RTX EP", () => {
    expect(isNvTensorRtRtxCatalogPath("NvTensorRtRtx_DeepSeek_R1_distill")).toBe(true);
    expect(isNvTensorRtRtxCatalogPath("recipe.NvTensorRTRTXConversion")).toBe(true);
    expect(isNvTensorRtRtxCatalogPath("recipes/NvTensorRtRtx_model_builder_int4")).toBe(true);
    expect(isNvTensorRtRtxCatalogPath("TensorrtExecutionProvider")).toBe(false);
    expect(isNvTensorRtRtxCatalogPath("cuda_and_tensorrt_decision")).toBe(false);
  });
});

// sanity check: classic TensorRT pin still pinned independently — the two
// paths must not collapse onto one another.
describe("tensorrt (classic) pin does not bleed into rtx deps", () => {
  it("keeps the classic tensorrt pin", () => {
    expect(PINNED_TENSORRT_VERSION).toMatch(/^10\./);
    const args = pinnedTensorRtInstallArgs();
    expect(args).toContain(`tensorrt==${PINNED_TENSORRT_VERSION}`);
  });
  it("does not include an NVIDIA-index-url for the classic path", () => {
    expect(pinnedTensorRtInstallArgs()).not.toContain("--extra-index-url");
  });
  it("does not duplicate the RTX surface label", () => {
    expect(pinnedTensorRtLabel()).not.toMatch(/tensorrt-rtx|RTX/i);
    expect(pinnedTensorRtLabel()).toMatch(/^tensorrt \(/);
  });
});
