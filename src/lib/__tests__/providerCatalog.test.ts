import { describe, expect, it } from "vitest";

import { PROVIDER_CATALOG, getProviderCatalogEntry } from "@/lib/providerCatalog";
import {
  TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY,
  getProviderAvailabilityBlock,
  type HardwareProbeResult,
} from "@/lib/hardwareProbe";

/**
 * Build a probe stub with `detectedProviders = ["CPUExecutionProvider"]` so
 * `getProviderAvailabilityBlock` falls into the unavailable branch and
 * surfaces the `undetectedProviderReason(...)` text the user sees for any
 * non-CPU / non-WebGPU provider we ask about. This is exactly the path
 * taken when a pre-Turing GPU is detected and `mergeDetectedProviders`
 * strips the TensorRT-family EPs.
 */
function probeWithoutRecommendedProviders(): HardwareProbeResult {
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
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Catalog structure
// ─────────────────────────────────────────────────────────────────────────

describe("PROVIDER_CATALOG", () => {
  it("contains exactly one entry per known execution provider id", () => {
    const ids = PROVIDER_CATALOG.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("CUDAExecutionProvider");
    expect(ids).toContain("TensorrtExecutionProvider");
    expect(ids).toContain("NvTensorRTRTXExecutionProvider");
    expect(ids).toContain("CPUExecutionProvider");
    expect(ids).toContain("OpenVINOExecutionProvider");
    expect(ids).toContain("DmlExecutionProvider");
    expect(ids).toContain("ROCMExecutionProvider");
    expect(ids).toContain("QNNExecutionProvider");
    expect(ids).toContain("WebGpuExecutionProvider");
  });

  it("returns the matching entry from getProviderCatalogEntry", () => {
    expect(getProviderCatalogEntry("TensorrtExecutionProvider")?.name).toBe("NVIDIA TensorRT");
    expect(getProviderCatalogEntry("NvTensorRTRTXExecutionProvider")?.shortName).toBe("TRT RTX");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// SM 7.5 (Turing) floor lockstep — IMPORTANT DRIFT GUARD
// ─────────────────────────────────────────────────────────────────────────
//
// `TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY` is the single source of truth in
// `hardwareProbe.ts` for the floor required by both `TensorrtExecutionProvider`
// AND `NvTensorRTRTXExecutionProvider`. Two user-facing surfaces tell the
// user about this floor:
//
//   1. The catalog chip (desc + tooltip.requirements) in PROVIDER_CATALOG
//      for NvTensorRTRTXExecutionProvider — surface A.
//
//   2. The `undetectedProviderReason('NvTensorRTRTXExecutionProvider')`
//      text surfaced via `getProviderAvailabilityBlock` when a recipe
//      provider is missing locally — surface B.
//
// When the floor changes, BOTH surfaces must change together. These tests
// assert each surface contains the SAME numeric constant from
// TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY so a one-sided edit can't slip
// through.
// ─────────────────────────────────────────────────────────────────────────

describe("TensorRT-RTX SM floor lockstep (catalog chip ↔ hardware probe)", () => {
  const rtx = getProviderCatalogEntry("NvTensorRTRTXExecutionProvider");
  // Hard require — the catalog must carry a TRT-RTX entry.
  if (!rtx) throw new Error("PROVIDER_CATALOG is missing NvTensorRTRTXExecutionProvider");

  const floor = `${TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY.major}.${TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY.minor}`;

  it("TRT-RTX chip tooltip.requirements states the SM floor numerically", () => {
    expect(rtx.tooltip.requirements).toContain(floor);
  });

  it("TRT-RTX chip desc states the SM floor numerically", () => {
    expect(rtx.desc).toContain(floor);
  });

  it("TRT-RTX chip tooltip mentions the Turing / RTX 20xx families by name", () => {
    // The chip should name at least Turing + RTX 20xx so the user can map
    // the floor onto a real product. The phrase is loose (allows
    // "Turing" + "RTX 20xx" to appear separately) to keep the test stable
    // against small wording tweaks.
    expect(/Turing/i.test(rtx.tooltip.requirements)).toBe(true);
    expect(/RTX\s*20xx?/i.test(rtx.tooltip.requirements)).toBe(true);
  });

  it("TRT-RTX chip tooltip calls out the pre-Turing cards that will never work", () => {
    // The companion message to the floor — pre-Turing users must read this
    // and understand that no install will recover them.
    expect(rtx.tooltip.requirements).toMatch(/Maxwell|Pascal|Kepler/i);
  });

  it("hardware probe's unavailable reason for TRT-RTX carries the SAME SM floor constant", () => {
    const block = getProviderAvailabilityBlock(
      "NvTensorRTRTXExecutionProvider",
      probeWithoutRecommendedProviders(),
    );
    expect(block).not.toBeNull();
    expect(block?.reason).toContain(floor);
  });

  it("hardware probe's unavailable reason for full TensorRT carries the SAME SM floor constant", () => {
    // Same drift guard for the OTHER half of the family. Both TRT and
    // TRT-RTX share the same floor; both surfaces must reference it.
    const block = getProviderAvailabilityBlock(
      "TensorrtExecutionProvider",
      probeWithoutRecommendedProviders(),
    );
    expect(block).not.toBeNull();
    expect(block?.reason).toContain(floor);
  });

  it("does not regress to a misleading '30xx-only' requirement on the TRT-RTX chip", () => {
    // The earlier chip said "GeForce RTX 30xx or newer (Ampere+)" which
    // implied SM 8.0, contradicting the SM 7.5 floor. Make sure no future
    // edit reintroduces that tighter (and incorrect) wording without
    // bumping the gate too.
    expect(rtx.tooltip.requirements).not.toMatch(/30xx or newer \(Ampere\+\)/);
    expect(rtx.desc).not.toMatch(/GeForce 30xx\+/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Full TensorRT SM floor lockstep (catalog chip ↔ hardware probe)
// ─────────────────────────────────────────────────────────────────────────
//
// Same drift guard as above but for the OTHER half of the family.
// `TensorrtExecutionProvider` and `NvTensorRTRTXExecutionProvider` share
// the same SM 7.5 floor (Turing / GeForce RTX 20xx+) — the catalog and
// the hardware-probe reason for BOTH providers must cite the same
// numeric constant. Previously the chip for full TensorRT said only
// "Turing or newer (GeForce RTX 20xx+)" with no numeric anchor, so a
// constant bump could silently desync the chip copy and the floor.
// ─────────────────────────────────────────────────────────────────────────

describe("TensorRT SM floor lockstep (catalog chip ↔ hardware probe)", () => {
  const trt = getProviderCatalogEntry("TensorrtExecutionProvider");
  if (!trt) throw new Error("PROVIDER_CATALOG is missing TensorrtExecutionProvider");

  const floor = `${TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY.major}.${TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY.minor}`;

  it("full TensorRT chip tooltip.requirements states the SM floor numerically", () => {
    expect(trt.tooltip.requirements).toContain(floor);
  });

  it("full TensorRT chip desc states the SM floor numerically", () => {
    expect(trt.desc).toContain(floor);
  });

  it("full TensorRT chip tooltip mentions Turing / RTX 20xx by name", () => {
    expect(/Turing/i.test(trt.tooltip.requirements)).toBe(true);
    expect(/RTX\s*20xx?/i.test(trt.tooltip.requirements)).toBe(true);
  });

  it("full TensorRT chip tooltip calls out pre-Turing cards that will never work", () => {
    expect(trt.tooltip.requirements).toMatch(/Maxwell|Pascal|Kepler/i);
  });

  it(`full TensorRT chip and TRT-RTX chip share the SAME ${floor} string`, () => {
    // Across-the-family lockstep: both halves of the family must cite the
    // exact same numeric constant so a future bump updates both halves
    // atomically. If only one chip gets a new floor, this test fails.
    const rtx = getProviderCatalogEntry("NvTensorRTRTXExecutionProvider");
    expect(rtx).toBeDefined();
    expect(trt.tooltip.requirements).toContain(floor);
    expect(rtx!.tooltip.requirements).toContain(floor);
  });

  it("hardware probe's unavailable reason for full TensorRT carries the SAME SM floor constant", () => {
    const block = getProviderAvailabilityBlock(
      "TensorrtExecutionProvider",
      probeWithoutRecommendedProviders(),
    );
    expect(block).not.toBeNull();
    expect(block?.reason).toContain(floor);
  });

  it("does not regress to a 'no numeric anchor' copy on the full TensorRT chip", () => {
    // Earlier copy was "NVIDIA GPU Turing or newer (GeForce RTX 20xx+, Quadro,
    // datacenter)" with no 7.5 anchor. A future edit that drops the numeric
    // floor would leave the chip and the constant out of sync. Belt and
    // braces: assert we never drop the numeric floor from the chip.
    expect(trt.tooltip.requirements).toMatch(/\b\d+\.\d+\b/);
    expect(trt.desc).toMatch(/\b\d+\.\d+\b/);
  });
});
