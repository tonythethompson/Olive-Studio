import { describe, expect, it } from "vitest";
import {
  assessRecipeHardwareCompatibility,
  summarizeRecipeHardwareCompatibility,
  type RecipeHardwareCompatResult,
} from "@/lib/recipeHardwareCompatibility";
import {
  TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY,
  type HardwareProbeResult,
} from "@/lib/hardwareProbe";
import type { RecipeCatalogItem } from "@/lib/oliveRecipeHub";

function makeProbe(overrides: Partial<HardwareProbeResult> = {}): HardwareProbeResult {
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

function tensorRtProbe(opts: {
  nvidiaGpus?: Array<{ name: string; computeCapability?: string }>;
  tensorrtLoadable?: boolean;
  tensorrtDetail?: string;
  tensorRtRtxLoadable?: boolean;
  tensorRtRtxDetail?: string;
  detectedProviders?: HardwareProbeResult["detectedProviders"];
  onnxRuntimeProviders?: HardwareProbeResult["onnxRuntimeProviders"];
}): HardwareProbeResult {
  const result: Partial<HardwareProbeResult> = {
    platform: { os: "win32 10.0", arch: "x64", cpuModel: "Test CPU", cpuCores: 8 },
    nvidia: opts.nvidiaGpus
      ? {
          gpus: opts.nvidiaGpus,
        }
      : undefined,
    tensorrt: {
      loadable: opts.tensorrtLoadable ?? false,
      detail: opts.tensorrtDetail,
    },
    tensorRtRtx: {
      loadable: opts.tensorRtRtxLoadable ?? false,
      detail: opts.tensorRtRtxDetail,
    },
    detectedProviders: opts.detectedProviders ?? ["CPUExecutionProvider"],
    onnxRuntimeProviders: opts.onnxRuntimeProviders,
    recommendedProvider: "CUDAExecutionProvider",
  };
  return makeProbe(result);
}

function makeCatalogItem(device: string, repoPath = "fake/recipe"): RecipeCatalogItem {
  return {
    repoPath,
    name: `recipe (${device})`,
    description: "",
    device,
    architecture: "Other",
    metadataSource: "recipe",
  } as RecipeCatalogItem;
}

describe("assessRecipeHardwareCompatibility — TensorRT install-needed fallback", () => {
  it("returns 'compatible' with a tensorrt install hint when NVIDIA GPU is present but tensorrt deps aren't loaded", () => {
    const probe = tensorRtProbe({
      nvidiaGpus: [{ name: "NVIDIA GeForce RTX 5070" }],
      tensorrtLoadable: false,
      tensorrtDetail: "tensorrt not installed",
      detectedProviders: ["CPUExecutionProvider", "CUDAExecutionProvider", "NvTensorRTRTXExecutionProvider"],
    });

    const result: RecipeHardwareCompatResult = assessRecipeHardwareCompatibility("TensorRT", probe);

    expect(result.tier).toBe("compatible");
    expect(result.requiredProvider).toBe("TensorrtExecutionProvider");
    expect(result.requiresInstall).toBeDefined();
    expect(result.requiresInstall?.kind).toBe("tensorrt");
    expect(result.requiresInstall?.provider).toBe("TensorrtExecutionProvider");
    // The install command MUST match what the project actually installs.
    // No `--index-url` override (TRT 10.x is on PyPI) and version pinned.
    expect(result.requiresInstall?.installCommand).toBe("pip install tensorrt==10.9.0.34");
    expect(result.requiresInstall?.hint).toContain("RTX 5070");
    expect(result.requiresInstall?.detail).toBe("tensorrt not installed");
  });

  it("returns plain 'compatible' (no install hint) when tensorrt deps are loaded", () => {
    const probe = tensorRtProbe({
      nvidiaGpus: [{ name: "NVIDIA GeForce RTX 5070" }],
      tensorrtLoadable: true,
      detectedProviders: [
        "CPUExecutionProvider",
        "CUDAExecutionProvider",
        "TensorrtExecutionProvider",
        "NvTensorRTRTXExecutionProvider",
      ],
    });

    const result = assessRecipeHardwareCompatibility("TensorRT", probe);

    expect(result.tier).toBe("compatible");
    expect(result.requiredProvider).toBe("TensorrtExecutionProvider");
    expect(result.requiresInstall).toBeUndefined();
  });

  it("still reports 'unavailable' when no NVIDIA GPU is present even if tensorrt deps were loaded", () => {
    const probe = tensorRtProbe({
      nvidiaGpus: undefined,
      tensorrtLoadable: false,
      detectedProviders: ["CPUExecutionProvider"],
    });

    const result = assessRecipeHardwareCompatibility("TensorRT", probe);

    expect(result.tier).toBe("unavailable");
    expect(result.requiresInstall).toBeUndefined();
  });

  it("returns 'compatible' with a tensorrt-rtx install hint when an NVIDIA GPU is present, RTX EP isn't in detectedProviders, and RTX deps aren't loaded", () => {
    // Defensive fallback: as of this writing `mergeDetectedProviders` adds
    // NvTensorRTRTXExecutionProvider unconditionally for any NVIDIA GPU, so
    // this branch is unreachable in practice. The probe below strips RTX
    // from detectedProviders to exercise the fallback anyway — it guards
    // against future probes that report a more conservative detected list.
    const probe = tensorRtProbe({
      nvidiaGpus: [{ name: "NVIDIA GeForce RTX 5070" }],
      tensorRtRtxLoadable: false,
      tensorRtRtxDetail: "EP-ABI plugin missing",
      detectedProviders: ["CPUExecutionProvider", "CUDAExecutionProvider"],
    });

    const result = assessRecipeHardwareCompatibility("TensorRT RTX", probe);

    expect(result.tier).toBe("compatible");
    expect(result.requiredProvider).toBe("NvTensorRTRTXExecutionProvider");
    expect(result.requiresInstall).toBeDefined();
    expect(result.requiresInstall?.kind).toBe("tensorrt-rtx");
    // `--extra-index-url` (NOT `--index-url`) so other PyPI packages keep
    // resolving from PyPI; matches `tensorrtRtxEpAbiInstallCommand()`.
    expect(result.requiresInstall?.installCommand).toBe(
      "pip install --extra-index-url https://pypi.nvidia.com onnxruntime-ep-nv-tensorrt-rtx-cu13==0.3.0",
    );
    expect(result.requiresInstall?.detail).toBe("EP-ABI plugin missing");
  });

  it("does not surface an install hint for non-TensorRT targets", () => {
    const probe = tensorRtProbe({
      nvidiaGpus: [{ name: "NVIDIA GeForce RTX 5070" }],
      tensorrtLoadable: false,
      detectedProviders: ["CPUExecutionProvider", "CUDAExecutionProvider"],
    });

    expect(assessRecipeHardwareCompatibility("CPU", probe).requiresInstall).toBeUndefined();
    expect(assessRecipeHardwareCompatibility("CUDA", probe).requiresInstall).toBeUndefined();
  });
});

describe("summarizeRecipeHardwareCompatibility — install-needed recipes count as compatible", () => {
  it("rolls up install-needed TensorRT recipes under 'compatible', not 'unavailable'", () => {
    const probe = tensorRtProbe({
      nvidiaGpus: [{ name: "NVIDIA GeForce RTX 5070" }],
      tensorrtLoadable: false,
      detectedProviders: ["CPUExecutionProvider", "CUDAExecutionProvider", "NvTensorRTRTXExecutionProvider"],
    });

    const catalog: RecipeCatalogItem[] = [
      makeCatalogItem("CPU"),
      makeCatalogItem("CUDA"),
      makeCatalogItem("TensorRT"),
      makeCatalogItem("TensorRT RTX"),
    ];

    const summary = summarizeRecipeHardwareCompatibility(catalog, probe);

    expect(summary.compatible).toBe(4);
    expect(summary.unavailable).toBe(0);
    expect(summary.unknown).toBe(0);
  });
});

describe("assessRecipeHardwareCompatibility — pre-Turing NVIDIA boxes (SM < 7.5)", () => {
  it("reports TensorRT 'unavailable' (no install hint) on a Pascal/Maxwell/Kepler GPU", () => {
    const probe = tensorRtProbe({
      // GTX 1080 = SM 6.1 (Pascal). Even when tensorrt.loadable is true
      // (impossible in practice, but the test exercises the floor gate),
      // the recipe must NOT be marked compatible.
      nvidiaGpus: [{ name: "NVIDIA GeForce GTX 1080", computeCapability: "6.1" }],
      tensorrtLoadable: false,
      detectedProviders: ["CPUExecutionProvider", "CUDAExecutionProvider"],
    });

    const result = assessRecipeHardwareCompatibility("TensorRT", probe);

    expect(result.tier).toBe("unavailable");
    expect(result.requiredProvider).toBe("TensorrtExecutionProvider");
    expect(result.requiresInstall).toBeUndefined();
    expect(result.reason).toMatch(/compute capability/i);
    expect(result.reason).toMatch(/GTX 1080/);
    expect(result.reason).toMatch(/Turing/i);
  });

  it("reports TensorRT RTX 'unavailable' (no install hint) on a pre-Turing GPU", () => {
    const probe = tensorRtProbe({
      nvidiaGpus: [{ name: "NVIDIA GeForce GTX 980", computeCapability: "5.2" }],
      tensorRtRtxLoadable: false,
      detectedProviders: ["CPUExecutionProvider", "CUDAExecutionProvider"],
    });

    const result = assessRecipeHardwareCompatibility("TensorRT RTX", probe);

    expect(result.tier).toBe("unavailable");
    expect(result.requiredProvider).toBe("NvTensorRTRTXExecutionProvider");
    expect(result.requiresInstall).toBeUndefined();
    expect(result.reason).toMatch(/GTX 980/);
    expect(result.reason).toMatch(/Maxwell\/Pascal\/Kepler/);
  });

  it("still falls through to the install-needed path on a Turing GPU at the floor boundary", () => {
    // Boundary: SM 7.5 IS supported. If tensorrt deps aren't installed yet,
    // we still want the green-banner-with-install-hint behavior.
    const probe = tensorRtProbe({
      nvidiaGpus: [{ name: "NVIDIA GeForce RTX 2080 Ti", computeCapability: "7.5" }],
      tensorrtLoadable: false,
      detectedProviders: ["CPUExecutionProvider", "CUDAExecutionProvider", "NvTensorRTRTXExecutionProvider"],
    });

    const result = assessRecipeHardwareCompatibility("TensorRT", probe);

    expect(result.tier).toBe("compatible");
    expect(result.requiresInstall).toBeDefined();
    expect(result.requiresInstall?.kind).toBe("tensorrt");
  });

  it("treats missing compute capability as permissive (existing behavior preserved)", () => {
    // No computeCapability reported (older driver). The pre-Turing gate
    // must NOT silently downgrade — compatibility falls back to the existing
    // install-needed path.
    const probe = tensorRtProbe({
      nvidiaGpus: [{ name: "NVIDIA GeForce RTX 5070" }],
      tensorrtLoadable: false,
      detectedProviders: ["CPUExecutionProvider", "CUDAExecutionProvider", "NvTensorRTRTXExecutionProvider"],
    });

    const result = assessRecipeHardwareCompatibility("TensorRT", probe);

    expect(result.tier).toBe("compatible");
    expect(result.requiresInstall?.kind).toBe("tensorrt");
  });

  it("mixed box (one pre-Turing, one Ampere) still reports TensorRT compatible", () => {
    // The mergeDetectedProviders / isNvidiaGpuTensorRtFamily logic is true
    // if AT LEAST ONE GPU meets the floor, since Olive picks one EP. A
    // workstation with a GTX 1080 AND an RTX 3090 should still see TensorRT
    // recipes as compatible / installable.
    const probe = tensorRtProbe({
      nvidiaGpus: [
        { name: "NVIDIA GeForce GTX 1080", computeCapability: "6.1" },
        { name: "NVIDIA GeForce RTX 3090", computeCapability: "8.6" },
      ],
      tensorrtLoadable: false,
      detectedProviders: ["CPUExecutionProvider", "CUDAExecutionProvider", "NvTensorRTRTXExecutionProvider"],
    });

    const result = assessRecipeHardwareCompatibility("TensorRT", probe);

    expect(result.tier).toBe("compatible");
    expect(result.requiresInstall?.kind).toBe("tensorrt");
  });

  it("summary correctly counts pre-Tuning NVIDIA GPU as unavailable for TRTRTX recipes", () => {
    const probe = tensorRtProbe({
      nvidiaGpus: [{ name: "NVIDIA GeForce GTX 1060", computeCapability: "6.0" }],
      detectedProviders: ["CPUExecutionProvider", "CUDAExecutionProvider"],
    });

    const catalog: RecipeCatalogItem[] = [
      makeCatalogItem("CPU"),
      makeCatalogItem("CUDA"),
      makeCatalogItem("TensorRT"),
      makeCatalogItem("TensorRT RTX"),
    ];

    const summary = summarizeRecipeHardwareCompatibility(catalog, probe);

    expect(summary.compatible).toBe(2); // CPU + CUDA only
    expect(summary.unavailable).toBe(2); // TensorRT + TensorRT RTX
    expect(summary.unknown).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// CUDA — pre-Maxwell SM 5.0 short-circuit + onnxruntime-gpu install hint
// ─────────────────────────────────────────────────────────────────────────

describe("assessRecipeHardwareCompatibility — CUDA pre-Maxwell (SM < 5.0)", () => {
  it("reports CUDA 'unavailable' (no install hint) on a Kepler SM 3.0 GPU", () => {
    // Mirror what the real route produces: when CUDA cannot run on this
    // hardware, `mergeDetectedProviders` strips the EP from the detected
    // list — so this probe uses `["CPUExecutionProvider"]` only.
    const probe = tensorRtProbe({
      // GTX 680 = SM 3.0 (Kepler). Modern CUDA 12 wheels / toolkit cannot
      // run on this card even when onnxruntime-gpu is installed.
      nvidiaGpus: [{ name: "NVIDIA GeForce GTX 680", computeCapability: "3.0" }],
      // `mergeDetectedProviders` keeps CUDA EP for any NVIDIA card; the
      // pre-Maxwell short-circuit is what protects the user.
      detectedProviders: ["CPUExecutionProvider"],
    });

    const result = assessRecipeHardwareCompatibility("CUDA", probe);

    expect(result.tier).toBe("unavailable");
    expect(result.requiredProvider).toBe("CUDAExecutionProvider");
    expect(result.requiresInstall).toBeUndefined();
    expect(result.reason).toMatch(/compute capability/i);
    expect(result.reason).toMatch(/GTX 680/);
    expect(result.reason).toMatch(/5\.0|Maxwell/);
    expect(result.reason).toMatch(/Kepler/);
  });

  it("returns plain 'compatible' for CUDA recipes on a Maxwell boundary SM 5.0 card when EP is loaded", () => {
    const probe = tensorRtProbe({
      nvidiaGpus: [{ name: "NVIDIA GeForce GTX 750 Ti", computeCapability: "5.0" }],
      detectedProviders: ["CPUExecutionProvider", "CUDAExecutionProvider"],
      onnxRuntimeProviders: ["CPUExecutionProvider", "CUDAExecutionProvider"],
    });

    const result = assessRecipeHardwareCompatibility("CUDA", probe);
    expect(result.tier).toBe("compatible");
    expect(result.requiresInstall).toBeUndefined();
  });

  it("still falls through to install-needed on a SM 5.0 boundary card when onnxruntime-gpu missing", () => {
    // Mirror what `mergeDetectedProviders` would produce when the ORT CUDA
    // probe reports `cudaLoadable: false` — CUDA stripped from the detected
    // list, so the install-needed branch is reachable.
    const probe = tensorRtProbe({
      nvidiaGpus: [{ name: "NVIDIA GeForce GTX 750 Ti", computeCapability: "5.0" }],
      detectedProviders: ["CPUExecutionProvider"],
    });

    const result = assessRecipeHardwareCompatibility("CUDA", probe);
    expect(result.tier).toBe("compatible");
    expect(result.requiresInstall).toBeDefined();
    expect(result.requiresInstall?.kind).toBe("onnxruntime-gpu");
  });

  it("mixed box (one Kepler SM 3.x + one Ampere SM 8.x) still reports CUDA compatible with install hint", () => {
    // `isPreMaxwellNvidiaBox` is true only if every card is below the
    // floor. A workstation with a GTX 680 AND an RTX 3090 should NOT
    // hit the terminator — the user can run CUDA recipes on the RTX.
    const probe = tensorRtProbe({
      nvidiaGpus: [
        { name: "NVIDIA GeForce GTX 680", computeCapability: "3.0" },
        { name: "NVIDIA GeForce RTX 3090", computeCapability: "8.6" },
      ],
      detectedProviders: ["CPUExecutionProvider"],
    });

    const result = assessRecipeHardwareCompatibility("CUDA", probe);
    expect(result.tier).toBe("compatible");
    expect(result.requiredProvider).toBe("CUDAExecutionProvider");
    expect(result.requiresInstall?.kind).toBe("onnxruntime-gpu");
  });

  it("locks the install command to the pinned onnxruntime-gpu==1.26.0", () => {
    const probe = tensorRtProbe({
      nvidiaGpus: [{ name: "NVIDIA GeForce RTX 5070", computeCapability: "12.0" }],
      detectedProviders: ["CPUExecutionProvider"],
    });

    const result = assessRecipeHardwareCompatibility("CUDA", probe);
    expect(result.requiresInstall?.installCommand).toBe("pip install onnxruntime-gpu==1.26.0");
  });

  it("locks the SM 5.0 floor in the pre-Maxwell reason text", () => {
    // Drift-guard: parallel to the hardwareProbe.test.ts pre-Turing lock
    // and the catalog chip SM 7.5 lock — future rewording can't drop 5.0.
    const probe = tensorRtProbe({
      nvidiaGpus: [{ name: "NVIDIA GeForce GT 730 Kepler", computeCapability: "3.5" }],
      detectedProviders: ["CPUExecutionProvider"],
    });

    const reason = assessRecipeHardwareCompatibility("CUDA", probe).reason;
    expect(reason).toMatch(/compute capability ≥ 5\.0/);
    expect(reason.toLowerCase()).toMatch(/maxwell|pascal|kepler/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Drift-guard: pre-Turing SM floor in recipe-compat reason
// ─────────────────────────────────────────────────────────────────────────
//
// Mirrors the providerCatalog.test.ts and hardwareProbe.test.ts drift
// guards. Bumping TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY (e.g. 7.5 → 8.6
// when Triton/Blackwell drops late-Turing support) must update THREE
// places atomically: the catalog chip copy, the hardwareProbe
// undetected-reason wording, and this recipe-compat reason. These tests
// fail CI if any of them drifts out of lockstep with the constant.

describe("assessRecipeHardwareCompatibility — pre-Turing drift-guard (recipe-compat reason)", () => {
  const smFloor = `${TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY.major}.${TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY.minor}`;

  it("the SM-floor constant is exactly 7.5 today (catches accidental constant typos)", () => {
    expect(TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY).toEqual({ major: 7, minor: 5 });
    expect(smFloor).toBe("7.5");
  });

  it("the pre-Turing reason for classic TensorRT pins SM ≥ 7.5 + Turing + Maxwell/Pascal/Kepler", () => {
    const probe = tensorRtProbe({
      nvidiaGpus: [{ name: "NVIDIA GeForce GTX 1080", computeCapability: "6.1" }],
      detectedProviders: ["CPUExecutionProvider", "CUDAExecutionProvider"],
    });

    const reason = assessRecipeHardwareCompatibility("TensorRT", probe).reason;
    // The reason must literally interpolate the constant — caught if the
    // template switches to a hardcoded "7.5" string literal.
    expect(reason).toContain(`compute capability ≥ ${smFloor}`);
    // Floor name + floor-as-hardware delineation. Maxwell/Pascal/Kepler
    // names the families that can NEVER run this EP — protects against a
    // generic "no compatible GPU" copy that drops the actionable callout.
    expect(reason.toLowerCase()).toContain("turing");
    expect(reason.toLowerCase()).toMatch(/maxwell|pascal|kepler/);
    // The GPU name must be quoted so the user knows which of their cards
    // is the offender.
    expect(reason).toContain("GTX 1080");
  });

  it("the pre-Turing reason for TensorRT RTX pins SM ≥ 7.5 + Turing + Maxwell/Pascal/Kepler", () => {
    const probe = tensorRtProbe({
      nvidiaGpus: [{ name: "NVIDIA GeForce GTX 980", computeCapability: "5.2" }],
      detectedProviders: ["CPUExecutionProvider", "CUDAExecutionProvider"],
    });

    const reason = assessRecipeHardwareCompatibility("TensorRT RTX", probe).reason;
    expect(reason).toContain(`compute capability ≥ ${smFloor}`);
    expect(reason.toLowerCase()).toContain("turing");
    expect(reason.toLowerCase()).toMatch(/maxwell|pascal|kepler/);
    expect(reason).toContain("GTX 980");
  });

  it("locks the classical 'Turing / RTX 20xx+' tie-in phrase so the floor name stays exact", () => {
    // The recipe-compat reason uses the copy pattern
    // "≥ X.Y (Turing / RTX 20xx+)" — if a future change drops the
    // "RTX 20xx+" tie-in (which is the consumer-friendly anchor of
    // "Turing = which cards?"), the user can't tell what to upgrade to.
    const probe = tensorRtProbe({
      nvidiaGpus: [{ name: "NVIDIA GeForce GTX 1660", computeCapability: "6.1" }],
      detectedProviders: ["CPUExecutionProvider", "CUDAExecutionProvider"],
    });

    const reason = assessRecipeHardwareCompatibility("TensorRT", probe).reason;
    expect(reason).toMatch(/turing\s*\/\s*rtx 20xx\+?/i);
  });

  it("locks the 'cannot execute on Maxwell/Pascal/Kepler' terminator phrasing — install hint must NEVER appear here", () => {
    // If a future change re-introduces a pip-install hint on a pre-Turing
    // box, the user gets a one-click install that cannot succeed. The
    // drift-guard asserts both the negative (no install hint) and the
    // positive (the families that can never run this EP are named).
    const probe = tensorRtProbe({
      nvidiaGpus: [{ name: "NVIDIA GeForce GT 1030", computeCapability: "6.0" }],
      detectedProviders: ["CPUExecutionProvider", "CUDAExecutionProvider"],
    });

    const trt = assessRecipeHardwareCompatibility("TensorRT", probe);
    expect(trt.requiresInstall).toBeUndefined();
    expect(trt.reason.toLowerCase()).toMatch(/maxwell\/pascal\/kepler/);

    const rtx = assessRecipeHardwareCompatibility("TensorRT RTX", probe);
    expect(rtx.requiresInstall).toBeUndefined();
    expect(rtx.reason.toLowerCase()).toMatch(/maxwell\/pascal\/kepler/);
  });
});
