import { describe, it, expect } from "vitest";
import { pickCudaTag, parseCudaVersionFromNvidiaSmi } from "./cuda.ts";

describe("pickCudaTag", () => {
  it("maps modern CUDA versions to the matching wheel tier", () => {
    expect(pickCudaTag(12, 8)).toBe("cu126");
    expect(pickCudaTag(12, 6)).toBe("cu126");
    expect(pickCudaTag(12, 4)).toBe("cu124");
    expect(pickCudaTag(12, 1)).toBe("cu121");
    expect(pickCudaTag(11, 8)).toBe("cu118");
  });

  it("returns cpu for versions below the lowest supported tier", () => {
    // CUDA 11.7 and older have no compatible wheel — do not force cu118.
    expect(pickCudaTag(11, 7)).toBe("cpu");
    expect(pickCudaTag(10, 2)).toBe("cpu");
  });
});

describe("parseCudaVersionFromNvidiaSmi", () => {
  it("extracts version and tag from nvidia-smi output", () => {
    const out = "NVIDIA-SMI 550.00   Driver Version: 550.00   CUDA Version: 12.4";
    expect(parseCudaVersionFromNvidiaSmi(out)).toEqual({ cudaVersion: "12.4", cudaTag: "cu124" });
  });

  it("returns cpu tag for an old CUDA version", () => {
    const out = "CUDA Version: 11.6";
    expect(parseCudaVersionFromNvidiaSmi(out)).toEqual({ cudaVersion: "11.6", cudaTag: "cpu" });
  });

  it("returns null when no CUDA version present", () => {
    expect(parseCudaVersionFromNvidiaSmi("no gpu here")).toBeNull();
  });
});
