import { describe, expect, it } from "vitest";
import {
  computeDirectMlHardwareReady,
  computeDirectMlNeedsInstall,
  computeOpenVinoCompatibleHardware,
  computeQnnCompatibleHardware,
  getProviderAvailabilityBlock,
  isNvidiaGpuTensorRtFamily,
  isProviderDetectedLocally,
  mergeDetectedProviders,
  parseComputeCapability,
  pickRecommendedProvider,
  TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY,
  type HardwareProbeResult,
} from "@/lib/hardwareProbe";

describe("mergeDetectedProviders TensorRT", () => {
  it("infers classic TensorRT from GPU capability alone, same as TensorRT RTX", () => {
    // Both TensorRT variants soft-detect on compute-capability (tensorRtFamilyCapable),
    // not on whether the SDK/wheel is already probed-loadable — a compatible GPU without
    // the package installed yet is "compatible, not yet installed", not "not on this
    // system". The install-readiness distinction shows up in badge/CTA text instead.
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: true,
      hasRocmGpu: false,
      hasOpenVino: false,
      tensorRtLoadable: false,
      tensorRtRtxLoadable: true,
    });
    expect(detected).toContain("CUDAExecutionProvider");
    expect(detected).toContain("TensorrtExecutionProvider");
    expect(detected).toContain("NvTensorRTRTXExecutionProvider");
  });

  it("includes classic TensorRT when the runtime probe succeeds", () => {
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: true,
      hasRocmGpu: false,
      hasOpenVino: false,
      tensorRtLoadable: true,
      tensorRtRtxLoadable: false,
    });
    expect(detected).toContain("TensorrtExecutionProvider");
  });

  it("does not recommend uninstalled classic TensorRT over CUDA", () => {
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: true,
      hasRocmGpu: false,
      hasOpenVino: false,
      tensorRtLoadable: false,
      tensorRtRtxLoadable: false,
    });
    expect(pickRecommendedProvider(detected, { tensorRtLoadable: false, tensorRtRtxLoadable: false })).toBe(
      "CUDAExecutionProvider",
    );
  });

  it("prefers loadable TensorRT RTX when present", () => {
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: true,
      hasRocmGpu: false,
      hasOpenVino: false,
      tensorRtLoadable: false,
      tensorRtRtxLoadable: true,
    });
    expect(pickRecommendedProvider(detected, { tensorRtRtxLoadable: true, tensorRtLoadable: false })).toBe(
      "NvTensorRTRTXExecutionProvider",
    );
  });

  it("treats an unknown compute capability as permissive (does not silently downgrade)", () => {
    // Older nvidia-smi drivers or parse hiccups can drop compute_cap.
    // mergeDetectedProviders must NOT use that absence as an excuse to hide
    // RTX-family EPs — the user already sees a separate "loadable" probe
    // for the runtime side. Missing SM data == we don't know == assume yes.
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: true,
      hasRocmGpu: false,
      hasOpenVino: false,
      tensorRtLoadable: true,
      tensorRtRtxLoadable: true,
      nvidiaTensorRtFamilyCapable: undefined,
    });
    expect(detected).toContain("TensorrtExecutionProvider");
    expect(detected).toContain("NvTensorRTRTXExecutionProvider");
  });
});

describe("parseComputeCapability", () => {
  it("parses a well-formed '8.9' into a comparable pair", () => {
    expect(parseComputeCapability("8.9")).toEqual({ major: 8, minor: 9 });
    expect(parseComputeCapability("7.5")).toEqual({ major: 7, minor: 5 });
    expect(parseComputeCapability("12.0")).toEqual({ major: 12, minor: 0 });
  });

  it("treats undefined / malformed input as 'unknown'", () => {
    expect(parseComputeCapability(undefined)).toBeUndefined();
    expect(parseComputeCapability("")).toBeUndefined();
    expect(parseComputeCapability("8")).toBeUndefined();
    expect(parseComputeCapability("8.x")).toBeUndefined();
    expect(parseComputeCapability("0.0")).toEqual({ major: 0, minor: 0 });
  });
});

describe("isNvidiaGpuTensorRtFamily", () => {
  it("accepts Turing (7.5) as the boundary case", () => {
    expect(isNvidiaGpuTensorRtFamily({ name: "RTX 2080 Ti", computeCapability: "7.5" })).toBe(true);
  });

  it("accepts cards at or above the floor", () => {
    expect(isNvidiaGpuTensorRtFamily({ name: "RTX 3080", computeCapability: "8.6" })).toBe(true);
    expect(isNvidiaGpuTensorRtFamily({ name: "RTX 4090", computeCapability: "8.9" })).toBe(true);
    expect(isNvidiaGpuTensorRtFamily({ name: "RTX 5070", computeCapability: "10.0" })).toBe(true);
  });

  it("rejects pre-Turing cards (Maxwell, Pascal, Kepler)", () => {
    expect(isNvidiaGpuTensorRtFamily({ name: "GTX 1080", computeCapability: "6.1" })).toBe(false);
    expect(isNvidiaGpuTensorRtFamily({ name: "GTX 980", computeCapability: "5.2" })).toBe(false);
    expect(isNvidiaGpuTensorRtFamily({ name: "GT 1030", computeCapability: "6.0" })).toBe(false);
    // Older drivers report '0.0' which must be treated as below floor,
    // not as 'unknown', so pre-Turing cards never silently downgrade.
    expect(isNvidiaGpuTensorRtFamily({ name: "Unidentified", computeCapability: "0.0" })).toBe(false);
  });

  it("treats missing compute capability as 'we don't know -> permissive'", () => {
    expect(isNvidiaGpuTensorRtFamily({ name: "GTX 1080" })).toBe(true);
  });

  it("exports the constant matching the actual minimum", () => {
    expect(TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY).toEqual({ major: 7, minor: 5 });
  });
});

describe("mergeDetectedProviders — CUDA cudaLoadable gating", () => {
  it("still detects CUDAExecutionProvider via capability when cudaLoadable is false", () => {
    // `cudaLoadable: false` covers both "never probed (wheel not installed)" and
    // "probed and failed" — this codebase has no separate signal for those two
    // cases (see cudaVenvLoadable in server/routes/system.ts, initialized false
    // and only ever flipped to true on success). Since the common case is "not
    // installed yet", gating hard on cudaLoadable produced the exact bug this
    // fix addresses: a GPU-compatible CUDA target reported as "not on this
    // system" instead of "compatible, not yet installed" — same as TensorRT RTX.
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: true,
      hasRocmGpu: false,
      hasOpenVino: false,
      cudaLoadable: false,
      cudaFamilyCapable: true,
    });
    expect(detected).toContain("CUDAExecutionProvider");
  });

  it("does not detect CUDAExecutionProvider when the NVIDIA GPU is pre-Maxwell", () => {
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: true,
      hasRocmGpu: false,
      hasOpenVino: false,
      cudaLoadable: false,
      cudaFamilyCapable: false,
    });
    expect(detected).not.toContain("CUDAExecutionProvider");
  });

  it("strips CUDAExecutionProvider from a reported ORT list when cudaLoadable is false", () => {
    // The ORT-providers-list filter (distinct from the capability-based
    // soft-detect above) still distrusts a reported CUDAExecutionProvider
    // entry when cudaLoadable is false — this only matters when hasNvidiaGpu
    // is false, since the soft-detect block re-adds it otherwise.
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: false,
      hasRocmGpu: false,
      hasOpenVino: false,
      onnxRuntimeProviders: ["CPUExecutionProvider", "CUDAExecutionProvider"],
      cudaLoadable: false,
    });
    expect(detected).toContain("CPUExecutionProvider");
    expect(detected).not.toContain("CUDAExecutionProvider");
  });

  it("keeps CUDAExecutionProvider when cudaLoadable is true (or undefined, permissive default)", () => {
    expect(
      mergeDetectedProviders({
        hasNvidiaGpu: true,
        hasRocmGpu: false,
        hasOpenVino: false,
        cudaLoadable: true,
      }).includes("CUDAExecutionProvider"),
    ).toBe(true);
    expect(
      mergeDetectedProviders({
        hasNvidiaGpu: true,
        hasRocmGpu: false,
        hasOpenVino: false,
        // cudaLoadable undefined → permissive
      }).includes("CUDAExecutionProvider"),
    ).toBe(true);
  });
});

describe("mergeDetectedProviders — pre-Turing (SM < 7.5) gating", () => {
  it("hides classic TensorRT and TensorRT-RTX when every NVIDIA GPU is below the floor", () => {
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: true,
      hasRocmGpu: false,
      hasOpenVino: false,
      tensorRtLoadable: true, // SDK installed; doesn't matter — GPU can't run it
      tensorRtRtxLoadable: true,
      nvidiaTensorRtFamilyCapable: false,
    });
    expect(detected).toContain("CUDAExecutionProvider");
    expect(detected).not.toContain("TensorrtExecutionProvider");
    expect(detected).not.toContain("NvTensorRTRTXExecutionProvider");
  });

  it("keeps TensorRT family when at least one GPU meets the floor (mixed box)", () => {
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: true,
      hasRocmGpu: false,
      hasOpenVino: false,
      tensorRtLoadable: true,
      tensorRtRtxLoadable: true,
      nvidiaTensorRtFamilyCapable: true,
    });
    expect(detected).toContain("NvTensorRTRTXExecutionProvider");
    expect(detected).toContain("TensorrtExecutionProvider");
  });

  it("strips the RTX-family EPs from a reported ORT list when the GPU is pre-Turing", () => {
    // Belt-and-braces: even if onnxruntime reports CUDA/CPU only, an ORT
    // build that ALSO reports TensorrtExecutionProvider must still be filtered
    // when the GPU is below floor. The probe-aware caller passes the flag;
    // we mirror the same gate for the ORT branch.
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: true,
      hasRocmGpu: false,
      hasOpenVino: false,
      onnxRuntimeProviders: [
        "CPUExecutionProvider",
        "CUDAExecutionProvider",
        "TensorrtExecutionProvider",
        "NvTensorRTRTXExecutionProvider",
      ],
      tensorRtLoadable: true,
      tensorRtRtxLoadable: true,
      nvidiaTensorRtFamilyCapable: false,
    });
    expect(detected).toContain("CUDAExecutionProvider");
    expect(detected).not.toContain("TensorrtExecutionProvider");
    expect(detected).not.toContain("NvTensorRTRTXExecutionProvider");
  });
});

describe("getProviderAvailabilityBlock — pre-Turing messaging", () => {
  // Lock the user-facing wording so future rewording can't drop the
  // SM 7.5 floor or the Maxwell/Pascal/Kepler callout — those are the
  // three pieces the user needs to understand the EP is unavailable
  // even after a fresh install.
  const smFloor = `${TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY.major}.${TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY.minor}`;
  const preTuringProbe = {
    probedAt: new Date().toISOString(),
    platform: { os: "win32 10.0", arch: "x64", cpuModel: "Test CPU", cpuCores: 8 },
    nvidia: { gpus: [{ name: "NVIDIA GeForce GTX 1080", computeCapability: "6.1" }] },
    detectedProviders: ["CPUExecutionProvider", "CUDAExecutionProvider"],
    recommendedProvider: "CUDAExecutionProvider",
    notes: [],
  } as HardwareProbeResult;

  it("explains the SM 7.5 floor when classic TensorRT is unavailable on a pre-Turing GPU", () => {
    const block = getProviderAvailabilityBlock("TensorrtExecutionProvider", preTuringProbe);
    expect(block?.reason).toContain(smFloor);
    expect(block?.reason.toLowerCase()).toContain("turing");
    expect(block?.reason.toLowerCase()).toMatch(/maxwell|pascal|kepler/);
  });

  it("explains the SM 7.5 floor when TensorRT RTX is unavailable on a pre-Turing GPU", () => {
    const block = getProviderAvailabilityBlock("NvTensorRTRTXExecutionProvider", preTuringProbe);
    expect(block?.reason).toContain(smFloor);
    expect(block?.reason.toLowerCase()).toContain("turing");
    expect(block?.reason.toLowerCase()).toMatch(/maxwell|pascal|kepler/);
  });

  it("returns null for missing providers that are not gated by SM (CPU)", () => {
    expect(getProviderAvailabilityBlock("CPUExecutionProvider", preTuringProbe)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// CUDA: 4-state unavailable-reason branching
// ─────────────────────────────────────────────────────────────────────────

describe("getProviderAvailabilityBlock — CUDA 4-state branching", () => {
  const cudaSmFloor = "5.0";

  function makeProbe(overrides: Partial<HardwareProbeResult>): HardwareProbeResult {
    return {
      probedAt: new Date().toISOString(),
      platform: { os: "win32 10.0", arch: "x64", cpuModel: "Test CPU", cpuCores: 8 },
      nvidia: undefined,
      rocm: undefined,
      openvino: undefined,
      tensorrt: undefined,
      tensorRtRtx: undefined,
      onnxRuntimeProviders: undefined,
      detectedProviders: ["CPUExecutionProvider"],
      recommendedProvider: "CPUExecutionProvider",
      notes: [],
      ...overrides,
    };
  }

  it("1) reports 'no GPU' wording for a CPU-only box (no nvidia field)", () => {
    const block = getProviderAvailabilityBlock(
      "CUDAExecutionProvider",
      makeProbe({ detectedProviders: ["CPUExecutionProvider"] }),
    );
    expect(block?.reason).toMatch(/No NVIDIA GPU|nvidia-smi/);
  });

  it("2) reports 'pre-Maxwell' wording when every NVIDIA GPU is below SM 5.0", () => {
    const probe = makeProbe({
      nvidia: {
        gpus: [{ name: "NVIDIA GeForce GTX 680", computeCapability: "3.0" }],
      },
      onnxRuntimeProviders: ["CPUExecutionProvider"],
    });
    const block = getProviderAvailabilityBlock("CUDAExecutionProvider", probe);
    expect(block?.reason).toContain(cudaSmFloor);
    // Names at least one of the pre-floor families for clarity.
    expect(block?.reason.toLowerCase()).toMatch(/maxwell|pascal|kepler/);
    // Must not advertise a one-click install that cannot succeed.
    expect(block?.reason).not.toMatch(/pip install/);
  });

  it("3) reports pip install hint when NVIDIA driver is fine but onnxruntime-gpu missing", () => {
    const probe = makeProbe({
      nvidia: {
        gpus: [{ name: "NVIDIA GeForce RTX 5070", computeCapability: "12.0" }],
        cudaVersion: "12.8",
        cudaToolkit: { available: true, version: "12.8" },
      },
    });
    const block = getProviderAvailabilityBlock("CUDAExecutionProvider", probe);
    expect(block?.reason).toMatch(/pip install onnxruntime-gpu/);
    expect(block?.reason).toContain("RTX 5070");
  });

  it("3b) pip install hint references the pinned wheel version 1.26.0", () => {
    const probe = makeProbe({
      nvidia: {
        gpus: [{ name: "NVIDIA GeForce RTX 5070", computeCapability: "12.0" }],
      },
    });
    const block = getProviderAvailabilityBlock("CUDAExecutionProvider", probe);
    expect(block?.reason).toContain("onnxruntime-gpu==1.26.0");
  });

  it("3c) mentions NVIDIA Toolkit archive link when toolkit is also missing", () => {
    const probe = makeProbe({
      nvidia: {
        gpus: [{ name: "NVIDIA GeForce RTX 5070", computeCapability: "12.0" }],
        cudaToolkit: { available: false },
      },
    });
    const block = getProviderAvailabilityBlock("CUDAExecutionProvider", probe);
    expect(block?.reason).toMatch(/developer\.nvidia\.com/);
  });

  it("4) reports state-4 driver/wheel mismatch when NVIDIA + ORT + toolkit OK but EP stripped from detectedProviders", () => {
    // State 4: NVIDIA + driver + toolkit + onnxruntime-gpu CUDA EP all
    // detected — but the EP is NOT in detectedProviders (because the
    // route's mergeDetectedProviders stripped it via cudaLoadable=false,
    // e.g. a CUDA 13 wheel against a CUDA 11 driver). `detectedProviders`
    // set explicitly here mirrors what /api/system/hardware-probe would
    // surface so getProviderAvailabilityBlock reaches the state-4
    // reason branch instead of the install-hint branch.
    const probe = makeProbe({
      nvidia: {
        gpus: [{ name: "NVIDIA GeForce RTX 5070", computeCapability: "12.0" }],
        cudaVersion: "12.8",
        cudaToolkit: { available: true, version: "12.8" },
      },
      // state-4 fixture: NVIDIA + driver + toolkit all healthy AND
      // probe.cuda.loadable === true (so the state-3 install-hint branch
      // is bypassed), but detectedProviders was post-processed to drop
      // CUDAExecutionProvider (e.g. a downstream merge only kept EP
      // strings whose .loadable flag was true at probe time, and the EP
      // fell out). This exercises the cascade through state 3 -> state
      // 4 and surfaces the driver/wheel mismatch reason rather than the
      // 'install onnxruntime-gpu' advice.
      cuda: { loadable: true },
      onnxRuntimeProviders: ["CPUExecutionProvider", "CUDAExecutionProvider"],
      detectedProviders: ["CPUExecutionProvider"],
    });
    const block = getProviderAvailabilityBlock("CUDAExecutionProvider", probe);
    expect(block?.reason).toMatch(/driver\/wheel version mismatch/i);
    expect(block?.reason).not.toMatch(/pip install onnxruntime-gpu/);
  });

  it("returns null block when CUDA is in detectedProviders (already working)", () => {
    const probe = makeProbe({
      nvidia: {
        gpus: [{ name: "NVIDIA GeForce RTX 5070", computeCapability: "12.0" }],
        cudaToolkit: { available: true, version: "12.8" },
      },
      onnxRuntimeProviders: ["CPUExecutionProvider", "CUDAExecutionProvider"],
      detectedProviders: ["CPUExecutionProvider", "CUDAExecutionProvider"],
    });
    expect(getProviderAvailabilityBlock("CUDAExecutionProvider", probe)).toBeNull();
  });

  it("CUDA reason always names the SM 5.0 floor when NVIDIA is present but pre-Maxwell", () => {
    // Use a pure pre-Maxwell box so the pre-Maxwell terminator branch
    // fires (mixed boxes hit the install-needed path, which doesn't pin
    // the SM floor). The terminator message must lock the 5.0 floor in
    // user-facing copy so a future rewording can't drift away from it.
    const probe = makeProbe({
      nvidia: {
        gpus: [
          { name: "GTX 680", computeCapability: "3.0" },
          { name: "GT 730 Kepler", computeCapability: "3.5" },
        ],
      },
      detectedProviders: ["CPUExecutionProvider"],
    });
    const block = getProviderAvailabilityBlock("CUDAExecutionProvider", probe);
    expect(block?.reason).toContain(cudaSmFloor);
  });
});

describe("computeDirectMlHardwareReady", () => {
  it("treats Windows hosts as DirectX 12 / DirectML capable", () => {
    expect(computeDirectMlHardwareReady({ os: "win32 10.0" })).toBe(true);
    expect(computeDirectMlHardwareReady({ os: "Windows_NT" })).toBe(true);
    expect(computeDirectMlHardwareReady({ os: "linux 6.8" })).toBe(false);
    expect(computeDirectMlHardwareReady({ os: "darwin" })).toBe(false);
  });
});

describe("computeDirectMlNeedsInstall", () => {
  const baseProbe = {
    probedAt: "now",
    platform: { cpuModel: "Test", cpuCores: 8, os: "win32 10.0", arch: "x64" },
    detectedProviders: ["CPUExecutionProvider"] as const,
    recommendedProvider: "CPUExecutionProvider" as const,
    notes: [] as string[],
  };

  it("offers DirectML install on Windows when EP is missing", () => {
    expect(
      computeDirectMlNeedsInstall({
        ...baseProbe,
        platform: { ...baseProbe.platform, os: "win32 10.0" },
        detectedProviders: ["CPUExecutionProvider"],
      }),
    ).toBe(true);
  });

  it("does not offer DirectML install on macOS (darwin must not match win)", () => {
    // HardwareProviderCard gates its DirectML CTA on this boolean.
    expect(
      computeDirectMlNeedsInstall({
        ...baseProbe,
        platform: { ...baseProbe.platform, os: "darwin 24.0" },
        detectedProviders: ["CPUExecutionProvider"],
      }),
    ).toBe(false);
  });

  it("omits the install CTA when DmlExecutionProvider is already detected", () => {
    expect(
      computeDirectMlNeedsInstall({
        ...baseProbe,
        detectedProviders: ["CPUExecutionProvider", "DmlExecutionProvider"],
      }),
    ).toBe(false);
  });
});

describe("computeOpenVinoCompatibleHardware", () => {
  it("detects Intel CPU by vendor qualifiers", () => {
    expect(
      computeOpenVinoCompatibleHardware({
        cpuModel: "Intel(R) Core(TM) i9-13900K",
      }),
    ).toBe(true);
    expect(
      computeOpenVinoCompatibleHardware({
        cpuModel: "Intel(R) Xeon(R) Platinum 8480+",
      }),
    ).toBe(true);
  });

  it("does not treat AMD N-Core Processor strings as Intel", () => {
    expect(
      computeOpenVinoCompatibleHardware({
        cpuModel: "AMD Ryzen 9 7950X 16-Core Processor",
      }),
    ).toBe(false);
  });

  it("detects AMD CPU + Intel Arc GPU as OpenVINO-compatible", () => {
    expect(
      computeOpenVinoCompatibleHardware({
        cpuModel: "AMD Ryzen 7 5800X 8-Core Processor",
        intelGpuNames: ["Intel(R) Arc(TM) A770 Graphics"],
      }),
    ).toBe(true);
  });

  it("detects OpenVINO GPU/NPU devices even without Intel CPU/GPU names", () => {
    expect(
      computeOpenVinoCompatibleHardware({
        cpuModel: "AMD Ryzen 9 7950X 16-Core Processor",
        openvinoDevices: ["CPU", "GPU.0"],
      }),
    ).toBe(true);
  });
});

describe("mergeDetectedProviders OpenVINO", () => {
  it("detects OpenVINO when hasOpenVinoCompatibleHardware is true (Intel CPU)", () => {
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: false,
      hasRocmGpu: false,
      hasOpenVino: false,
      hasOpenVinoCompatibleHardware: true,
    });
    expect(detected).toContain("OpenVINOExecutionProvider");
  });

  it("detects OpenVINO when hasOpenVino is true (runtime installed)", () => {
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: false,
      hasRocmGpu: false,
      hasOpenVino: true,
      hasOpenVinoCompatibleHardware: false,
    });
    expect(detected).toContain("OpenVINOExecutionProvider");
  });

  it("propagates Arc-compatible hardware flag into detected providers", () => {
    const compatible = computeOpenVinoCompatibleHardware({
      cpuModel: "AMD Ryzen 7 5800X 8-Core Processor",
      intelGpuNames: ["Intel(R) Arc(TM) A770 Graphics"],
    });
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: false,
      hasRocmGpu: false,
      hasOpenVino: false,
      hasOpenVinoCompatibleHardware: compatible,
    });
    expect(compatible).toBe(true);
    expect(detected).toContain("OpenVINOExecutionProvider");
  });

  it("does not detect OpenVINO without compatible hardware or runtime", () => {
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: false,
      hasRocmGpu: false,
      hasOpenVino: false,
      hasOpenVinoCompatibleHardware: false,
    });
    expect(detected).not.toContain("OpenVINOExecutionProvider");
  });
});

describe("mergeDetectedProviders DirectML", () => {
  it("adds DmlExecutionProvider when hasDirectMl is true (ORT reports it)", () => {
    const withDml = mergeDetectedProviders({
      hasNvidiaGpu: false,
      hasRocmGpu: false,
      hasOpenVino: false,
      hasDirectMl: true,
    });
    expect(withDml).toContain("DmlExecutionProvider");
  });

  it("does not add DmlExecutionProvider on Windows without hasDirectMl (runtime not installed)", () => {
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: false,
      hasRocmGpu: false,
      hasOpenVino: false,
      hasDirectMl: false,
      os: "win32 10.0",
    });
    expect(detected).not.toContain("DmlExecutionProvider");
  });

  it("does not add DmlExecutionProvider on non-Windows without hasDirectMl", () => {
    const without = mergeDetectedProviders({
      hasNvidiaGpu: false,
      hasRocmGpu: false,
      hasOpenVino: false,
      hasDirectMl: false,
      os: "linux 6.8",
    });
    expect(without).not.toContain("DmlExecutionProvider");

    const withoutOs = mergeDetectedProviders({
      hasNvidiaGpu: false,
      hasRocmGpu: false,
      hasOpenVino: false,
      hasDirectMl: false,
    });
    expect(withoutOs).not.toContain("DmlExecutionProvider");
  });

  it("maps DmlExecutionProvider from ORT provider list without hasDirectMl", () => {
    const detected = mergeDetectedProviders({
      onnxRuntimeProviders: ["CPUExecutionProvider", "DmlExecutionProvider"],
      hasNvidiaGpu: false,
      hasRocmGpu: false,
      hasOpenVino: false,
      hasDirectMl: false,
    });
    expect(detected).toContain("DmlExecutionProvider");
  });
});

describe("mergeDetectedProviders QNN", () => {
  it("does not trust ORT QNN listing alone without host-compatible soft-detect", () => {
    const detected = mergeDetectedProviders({
      onnxRuntimeProviders: ["CPUExecutionProvider", "QNNExecutionProvider"],
      hasNvidiaGpu: false,
      hasRocmGpu: false,
      hasOpenVino: false,
    });
    expect(detected).not.toContain("QNNExecutionProvider");
  });

  it("soft-detects QNN on compatible Windows hosts", () => {
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: false,
      hasRocmGpu: false,
      hasOpenVino: false,
      hasQnnCompatibleHardware: true,
    });
    expect(detected).toContain("QNNExecutionProvider");
  });

  it("computeQnnCompatibleHardware is Windows ARM64 only (local accelerator)", () => {
    expect(computeQnnCompatibleHardware({ os: "win32 10.0", arch: "arm64" })).toBe(true);
    // Windows x64 is preparation-only (cross-compile), not a local accelerator
    expect(computeQnnCompatibleHardware({ os: "win32 10.0", arch: "x64" })).toBe(false);
    expect(computeQnnCompatibleHardware({ os: "linux 6.8", arch: "x64" })).toBe(false);
    expect(
      computeQnnCompatibleHardware({
        os: "linux 6.8",
        arch: "x64",
        qnnLoadable: true,
        ortReportsQnn: true,
      }),
    ).toBe(false);
  });
});

describe("isProviderDetectedLocally", () => {
  it("always detects CPUExecutionProvider locally even when probe is null", () => {
    expect(isProviderDetectedLocally("CPUExecutionProvider", null)).toBe(true);
    expect(isProviderDetectedLocally("CPUExecutionProvider", undefined)).toBe(true);
  });

  it("checks probe detectedProviders for GPU providers", () => {
    const probe = {
      probedAt: "now",
      platform: { os: "win", arch: "x64", cpuModel: "CPU", cpuCores: 4 },
      detectedProviders: ["CPUExecutionProvider", "CUDAExecutionProvider"],
      recommendedProvider: "CUDAExecutionProvider",
      notes: [],
    } as HardwareProbeResult;

    expect(isProviderDetectedLocally("CUDAExecutionProvider", probe)).toBe(true);
    expect(isProviderDetectedLocally("ROCMExecutionProvider", probe)).toBe(false);
  });

  it("returns false for non-CPU providers when probe is null", () => {
    expect(isProviderDetectedLocally("CUDAExecutionProvider", null)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// CoreML detection and recommendation
// ─────────────────────────────────────────────────────────────────────────

describe("CoreML detection and recommendation", () => {
  /**
   * Property 1: CoreML is not soft-detected from Apple hardware
   *
   * Without an ORT-reported CoreML EP, the returned provider list SHALL NOT
   * contain `CoreMLExecutionProvider`.
   *
   * **Validates: Requirements 2.1**
   */
  it("Property 1: CoreML is not detected without an ORT provider report", () => {
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: false,
      hasRocmGpu: false,
      hasOpenVino: false,
    });
    expect(detected).not.toContain("CoreMLExecutionProvider");
    expect(pickRecommendedProvider(detected)).toBe("CPUExecutionProvider");
  });

  it("Property 1: other hardware signals do not imply CoreML", () => {
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: true,
      hasRocmGpu: false,
      hasOpenVino: true,
      hasDirectMl: true,
    });
    expect(detected).not.toContain("CoreMLExecutionProvider");
    expect(detected).toContain("CUDAExecutionProvider");
    expect(detected).toContain("OpenVINOExecutionProvider");
  });

  it("Property 1: an empty ORT providers list does not imply CoreML", () => {
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: false,
      hasRocmGpu: false,
      hasOpenVino: false,
      onnxRuntimeProviders: [],
    });
    expect(detected).not.toContain("CoreMLExecutionProvider");
  });

  /**
   * Property 2: CoreML requires an explicit ORT provider report
   *
   * When `onnxRuntimeProviders` does NOT include
   * `CoreMLExecutionProvider`, the returned list SHALL NOT contain it.
   *
   * **Validates: Requirements 2.2**
   */
  it("Property 2: CoreML not detected when ORT providers are unavailable", () => {
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: false,
      hasRocmGpu: false,
      hasOpenVino: false,
    });
    expect(detected).not.toContain("CoreMLExecutionProvider");
  });

  it("Property 2: CoreML not detected when ORT providers are omitted", () => {
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: false,
      hasRocmGpu: false,
      hasOpenVino: false,
    });
    expect(detected).not.toContain("CoreMLExecutionProvider");
  });

  it("Property 2: CoreML not detected on non-Apple with ORT providers that exclude CoreML", () => {
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: true,
      hasRocmGpu: false,
      hasOpenVino: false,
      onnxRuntimeProviders: ["CPUExecutionProvider", "CUDAExecutionProvider"],
    });
    expect(detected).not.toContain("CoreMLExecutionProvider");
  });

  /**
   * Property 3: ORT-listed CoreML is detected
   *
   * For any input where `onnxRuntimeProviders` includes `CoreMLExecutionProvider`,
   * the returned list SHALL contain it.
   *
   * **Validates: Requirements 2.3**
   */
  it("Property 3: ORT-listed CoreML is detected", () => {
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: false,
      hasRocmGpu: false,
      hasOpenVino: false,
      onnxRuntimeProviders: ["CPUExecutionProvider", "CoreMLExecutionProvider"],
    });
    expect(detected).toContain("CoreMLExecutionProvider");
  });

  it("Property 3: ORT-listed CoreML remains detected with the minimal probe input", () => {
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: false,
      hasRocmGpu: false,
      hasOpenVino: false,
      onnxRuntimeProviders: ["CPUExecutionProvider", "CoreMLExecutionProvider"],
    });
    expect(detected).toContain("CoreMLExecutionProvider");
  });

  it("Property 3: duplicate ORT CoreML entries are de-duplicated", () => {
    const detected = mergeDetectedProviders({
      hasNvidiaGpu: false,
      hasRocmGpu: false,
      hasOpenVino: false,
      onnxRuntimeProviders: ["CPUExecutionProvider", "CoreMLExecutionProvider", "CoreMLExecutionProvider"],
    });
    expect(detected).toContain("CoreMLExecutionProvider");
    // Should not have duplicate entries
    const coremlCount = detected.filter((p) => p === "CoreMLExecutionProvider").length;
    expect(coremlCount).toBe(1);
  });

  /**
   * Property 4: CoreML recommended over CPU without GPU providers
   *
   * When CoreML and CPU are detected but no GPU providers, `pickRecommendedProvider`
   * SHALL NOT return `CPUExecutionProvider`.
   *
   * **Validates: Requirements 3.1**
   */
  it("Property 4: CoreML recommended over CPU when no GPU providers present", () => {
    const detected: ReturnType<typeof mergeDetectedProviders> = [
      "CPUExecutionProvider",
      "CoreMLExecutionProvider",
    ];
    const recommended = pickRecommendedProvider(detected);
    expect(recommended).not.toBe("CPUExecutionProvider");
    expect(recommended).toBe("CoreMLExecutionProvider");
  });

  it("Property 4: CoreML recommended over CPU even with WebGPU present", () => {
    const detected: ReturnType<typeof mergeDetectedProviders> = [
      "CPUExecutionProvider",
      "CoreMLExecutionProvider",
      "WebGpuExecutionProvider",
    ];
    const recommended = pickRecommendedProvider(detected);
    // CoreML is above WebGPU in priority, so it should be picked
    expect(recommended).not.toBe("CPUExecutionProvider");
    expect(recommended).toBe("CoreMLExecutionProvider");
  });

  it("Property 4: CoreML recommended over CPU with OpenVINO (not loadable)", () => {
    // OpenVINO only gets priority boost when loadable; without loadable flag,
    // CoreML is above CPU but OpenVINO needs the `openvinoLoadable` opt to rank higher.
    const detected: ReturnType<typeof mergeDetectedProviders> = [
      "CPUExecutionProvider",
      "CoreMLExecutionProvider",
      "OpenVINOExecutionProvider",
    ];
    const recommended = pickRecommendedProvider(detected, { openvinoLoadable: false });
    expect(recommended).not.toBe("CPUExecutionProvider");
  });

  /**
   * Property 5: GPU providers recommended over CoreML
   *
   * When CoreML and a GPU provider are both detected, `pickRecommendedProvider`
   * SHALL NOT return `CoreMLExecutionProvider`.
   *
   * **Validates: Requirements 3.2**
   */
  it("Property 5: CUDA recommended over CoreML", () => {
    const detected: ReturnType<typeof mergeDetectedProviders> = [
      "CPUExecutionProvider",
      "CoreMLExecutionProvider",
      "CUDAExecutionProvider",
    ];
    const recommended = pickRecommendedProvider(detected);
    expect(recommended).not.toBe("CoreMLExecutionProvider");
    expect(recommended).toBe("CUDAExecutionProvider");
  });

  it("Property 5: TensorRT recommended over CoreML when loadable", () => {
    const detected: ReturnType<typeof mergeDetectedProviders> = [
      "CPUExecutionProvider",
      "CoreMLExecutionProvider",
      "TensorrtExecutionProvider",
    ];
    const recommended = pickRecommendedProvider(detected, { tensorRtLoadable: true });
    expect(recommended).not.toBe("CoreMLExecutionProvider");
    expect(recommended).toBe("TensorrtExecutionProvider");
  });

  it("Property 5: TensorRT RTX recommended over CoreML when loadable", () => {
    const detected: ReturnType<typeof mergeDetectedProviders> = [
      "CPUExecutionProvider",
      "CoreMLExecutionProvider",
      "NvTensorRTRTXExecutionProvider",
    ];
    const recommended = pickRecommendedProvider(detected, { tensorRtRtxLoadable: true });
    expect(recommended).not.toBe("CoreMLExecutionProvider");
    expect(recommended).toBe("NvTensorRTRTXExecutionProvider");
  });

  it("Property 5: ROCm recommended over CoreML", () => {
    const detected: ReturnType<typeof mergeDetectedProviders> = [
      "CPUExecutionProvider",
      "CoreMLExecutionProvider",
      "ROCMExecutionProvider",
    ];
    const recommended = pickRecommendedProvider(detected);
    expect(recommended).not.toBe("CoreMLExecutionProvider");
    expect(recommended).toBe("ROCMExecutionProvider");
  });

  it("Property 5: DirectML recommended over CoreML", () => {
    const detected: ReturnType<typeof mergeDetectedProviders> = [
      "CPUExecutionProvider",
      "CoreMLExecutionProvider",
      "DmlExecutionProvider",
    ];
    const recommended = pickRecommendedProvider(detected);
    expect(recommended).not.toBe("CoreMLExecutionProvider");
    expect(recommended).toBe("DmlExecutionProvider");
  });

  it("Property 5: OpenVINO (loadable) recommended over CoreML", () => {
    const detected: ReturnType<typeof mergeDetectedProviders> = [
      "CPUExecutionProvider",
      "CoreMLExecutionProvider",
      "OpenVINOExecutionProvider",
    ];
    const recommended = pickRecommendedProvider(detected, { openvinoLoadable: true });
    expect(recommended).not.toBe("CoreMLExecutionProvider");
    expect(recommended).toBe("OpenVINOExecutionProvider");
  });
});
