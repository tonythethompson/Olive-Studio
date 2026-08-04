import { describe, expect, it } from "vitest";

import {
  CUDA_DOWNLOAD_LINKS,
  CUDA_SM_FLOOR,
  CUDA_TOOLKIT_MIN_COMPUTE_CAPABILITY,
  cudaDownloadUrlForOs,
  isNvidiaGpuCudaToolkitFamily,
  isPreMaxwellNvidiaBox,
  pinnedOrtGpuInstallArgs,
  pinnedOrtGpuInstallCommand,
  pinnedOrtGpuLabel,
} from "@/lib/cudaDeps";

describe("CUDA_TOOLKIT_MIN_COMPUTE_CAPABILITY", () => {
  it("is locked at SM 5.0 (Maxwell floor for CUDA 12)", () => {
    expect(CUDA_TOOLKIT_MIN_COMPUTE_CAPABILITY).toEqual({ major: 5, minor: 0 });
    expect(CUDA_SM_FLOOR).toBe("5.0");
  });
});

describe("isNvidiaGpuCudaToolkitFamily", () => {
  it("accepts Maxwell SM 5.0 (the boundary)", () => {
    expect(isNvidiaGpuCudaToolkitFamily({ name: "GTX 750 Ti", computeCapability: "5.0" })).toBe(true);
  });

  it("accepts Pascal SM 6.0 / 6.1 and Volta SM 7.0", () => {
    expect(isNvidiaGpuCudaToolkitFamily({ name: "GTX 1060", computeCapability: "6.1" })).toBe(true);
    expect(isNvidiaGpuCudaToolkitFamily({ name: "Tesla V100", computeCapability: "7.0" })).toBe(true);
  });

  it("accepts Turing / Ampere / Ada / Hopper / Blackwell", () => {
    expect(isNvidiaGpuCudaToolkitFamily({ name: "RTX 2080 Ti", computeCapability: "7.5" })).toBe(true);
    expect(isNvidiaGpuCudaToolkitFamily({ name: "RTX 3090", computeCapability: "8.6" })).toBe(true);
    expect(isNvidiaGpuCudaToolkitFamily({ name: "RTX 4090", computeCapability: "8.9" })).toBe(true);
    expect(isNvidiaGpuCudaToolkitFamily({ name: "RTX 5070", computeCapability: "12.0" })).toBe(true);
  });

  it("rejects Kepler SM 3.x (below the CUDA 12 floor)", () => {
    expect(isNvidiaGpuCudaToolkitFamily({ name: "GTX 680", computeCapability: "3.0" })).toBe(false);
    expect(isNvidiaGpuCudaToolkitFamily({ name: "GT 730", computeCapability: "3.5" })).toBe(false);
  });

  it("treats '0.0' as below floor (older driver / parse glitch)", () => {
    expect(isNvidiaGpuCudaToolkitFamily({ name: "Unidentified", computeCapability: "0.0" })).toBe(false);
  });

  it("treats missing compute capability as permissive", () => {
    expect(isNvidiaGpuCudaToolkitFamily({ name: "Some NVIDIA" })).toBe(true);
  });
});

describe("isPreMaxwellNvidiaBox", () => {
  it("returns false when no GPUs are listed", () => {
    expect(isPreMaxwellNvidiaBox([])).toBe(false);
  });

  it("returns false when every card is at or above the floor", () => {
    expect(
      isPreMaxwellNvidiaBox([
        { name: "GTX 680", computeCapability: "3.0" },
        { name: "GTX 750 Ti Maxwell", computeCapability: "5.0" }, // boundary — supported
      ]),
    ).toBe(false);
    expect(
      isPreMaxwellNvidiaBox([{ name: "GT 730", computeCapability: "3.5" }]),
    ).toBe(true);
  });

  it("returns false when at least one card meets the floor (mixed box)", () => {
    expect(
      isPreMaxwellNvidiaBox([
        { name: "GTX 680", computeCapability: "3.0" },
        { name: "RTX 3090", computeCapability: "8.6" },
      ]),
    ).toBe(false);
  });
});

describe("cudaDownloadUrlForOs", () => {
  it("returns the Windows-specific URL when the OS string mentions win", () => {
    expect(cudaDownloadUrlForOs("win32 10.0.19041")).toBe(CUDA_DOWNLOAD_LINKS.windows);
    expect(cudaDownloadUrlForOs("Windows 11")).toBe(CUDA_DOWNLOAD_LINKS.windows);
  });

  it("returns the WSL-specific URL when the OS string mentions wsl", () => {
    expect(cudaDownloadUrlForOs("linux wsl2")).toBe(CUDA_DOWNLOAD_LINKS.wsl);
  });

  it("returns the Linux-specific URL when the OS string mentions linux (but not wsl)", () => {
    expect(cudaDownloadUrlForOs("linux 5.15.0-91-generic")).toBe(CUDA_DOWNLOAD_LINKS.linux);
  });

  it("falls back to the archive landing page for unrecognized / missing OS", () => {
    expect(cudaDownloadUrlForOs(undefined)).toBe(CUDA_DOWNLOAD_LINKS.archive);
    expect(cudaDownloadUrlForOs(null)).toBe(CUDA_DOWNLOAD_LINKS.archive);
    expect(cudaDownloadUrlForOs("freebsd")).toBe(CUDA_DOWNLOAD_LINKS.archive);
    expect(cudaDownloadUrlForOs("")).toBe(CUDA_DOWNLOAD_LINKS.archive);
  });

  it("constant URLs are HTTPS and live under developer.nvidia.com", () => {
    for (const url of Object.values(CUDA_DOWNLOAD_LINKS)) {
      expect(url.startsWith("https://developer.nvidia.com/")).toBe(true);
    }
  });
});

describe("pinnedOrtGpu* — pinned onnxruntime-gpu install command", () => {
  it("pinnedOrtGpuInstallArgs carries the wheel + version pin from oliveGpuRuntime", () => {
    expect(pinnedOrtGpuInstallArgs()).toEqual(["onnxruntime-gpu==1.26.0"]);
  });

  it("pinnedOrtGpuInstallCommand is a paste-ready pip command", () => {
    expect(pinnedOrtGpuInstallCommand()).toBe("pip install onnxruntime-gpu==1.26.0");
  });

  it("pinnedOrtGpuLabel names the package + the pinned version", () => {
    expect(pinnedOrtGpuLabel()).toBe("onnxruntime-gpu (1.26.0)");
  });
});
