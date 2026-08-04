/**
 * System hardware probe route handler.
 *
 * GET /api/system/hardware-probe — probes GPUs (NVIDIA / ROCm), ORT providers,
 * OpenVINO, TensorRT, and TensorRT RTX, returning a unified HardwareProbeResult.
 */
import type { Router } from "express";
import { execFile } from "child_process";
import { promisify } from "util";
import os from "os";
import fs from "fs";

import { getVenvPython } from "../services/venv/paths.ts";
import { findSystemPython } from "../services/venv/index.ts";
import { parseCudaVersionFromNvidiaSmi } from "../services/olive/cuda.ts";
import {
  isNvidiaGpuTensorRtFamily,
  mergeDetectedProviders,
  pickRecommendedProvider,
  TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY,
  type HardwareProbeResult,
} from "../../lib/hardwareProbe.ts";
import {
  isPreMaxwellNvidiaBox,
  CUDA_SM_FLOOR,
  pinnedOrtGpuInstallCommand,
  pinnedOrtGpuLabel,
} from "../../lib/cudaDeps.ts";
import {
  ORT_GPU_PROBE_SCRIPT,
  parseOrtGpuProbe,
} from "../../lib/oliveGpuRuntime.ts";

const execFileAsync = promisify(execFile);

const ORT_PROBE_TIMEOUT_MS = 30_000;

// ─── GPU probes ────────────────────────────────────────────────────────────

async function probeNvidiaGpus(): Promise<HardwareProbeResult["nvidia"] | undefined> {
  try {
    // compute_cap lets us gate TensorRT-family EPs on the SM ≥ 7.5 (Turing)
    // floor so pre-Turing cards are not falsely reported as compatible.
    const { stdout } = await execFileAsync("nvidia-smi", [
      "--query-gpu=name,driver_version,memory.total,compute_cap",
      "--format=csv,noheader",
    ]);
    const gpus = stdout
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(",").map((s) => s.trim());
        const name = parts[0] ?? "Unknown GPU";
        const driver = parts[1];
        const memStr = parts[2];
        // compute_cap is reported as e.g. "8.9" — leave as-is so callers can
        // compare via parseComputeCapability. Older drivers may emit "0.0" or
        // be missing; `undefined` means "we couldn't tell", which our
        // compat logic treats as permissive (no silent downgrade).
        const computeCapability = parts[3]?.match(/^\d+\.\d+$/) ? parts[3] : undefined;
        let vramMb: number | undefined;
        if (memStr) {
          const m = memStr.match(/(\d+)/);
          if (m) vramMb = parseInt(m[1], 10);
        }
        return { name, driver, vramMb, computeCapability };
      });

    if (gpus.length === 0) return undefined;

    let cudaVersion: string | undefined;
    let cudaTag: string | undefined;
    try {
      const { stdout: smiOut } = await execFileAsync("nvidia-smi", []);
      const parsed = parseCudaVersionFromNvidiaSmi(smiOut);
      if (parsed) {
        cudaVersion = parsed.cudaVersion;
        cudaTag = parsed.cudaTag;
      }
    } catch {
      /* ignore */
    }

    // Probe for the CUDA Toolkit (`nvcc`). Pure inference via onnxruntime-gpu
    // does NOT need the toolkit (it ships its own runtime libs), so a missing
    // toolkit is benign for OLIVE recipes — but the IHV panel still wants
    // to know so it can surface a download link when the user kicks off a
    // native build. `available` is `undefined` when we couldn't even tell.
    type NvidiaToolkit = NonNullable<HardwareProbeResult["nvidia"]>["cudaToolkit"];
    let cudaToolkit: NvidiaToolkit;
    try {
      const { stdout: nvccOut } = await execFileAsync("nvcc", ["--version"]);
      const m = nvccOut.match(/release\s+(\d+\.\d+)/i);
      cudaToolkit = { available: true, version: m?.[1] };
    } catch {
      cudaToolkit = { available: false };
    }

    return { gpus, cudaVersion, cudaTag, cudaToolkit };
  } catch {
    return undefined;
  }
}

async function probeRocmGpus(): Promise<HardwareProbeResult["rocm"] | undefined> {
  try {
    const { stdout } = await execFileAsync("rocm-smi", ["--showproductname"]);
    const gpus = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("=") && !line.toLowerCase().includes("product"))
      .map((name) => ({ name }));
    if (gpus.length === 0) return undefined;
    return { gpus };
  } catch {
    return undefined;
  }
}

async function probePythonRuntime(
  python: string,
): Promise<Pick<HardwareProbeResult, "openvino" | "onnxRuntimeProviders">> {
  const result: Pick<HardwareProbeResult, "openvino" | "onnxRuntimeProviders"> = {};

  try {
    const { stdout } = await execFileAsync(python, ["-c", "import openvino; print(openvino.__version__)"]);
    const version = stdout.trim();
    if (version) result.openvino = { available: true, version };
  } catch {
    result.openvino = { available: false };
  }

  try {
    const { stdout } = await execFileAsync(python, [
      "-c",
      "import onnxruntime as ort; print(','.join(ort.get_available_providers()))",
    ]);
    const providers = stdout.trim().split(",").filter(Boolean);
    if (providers.length > 0) result.onnxRuntimeProviders = providers;
  } catch {
    /* onnxruntime not installed */
  }

  return result;
}

// ─── Main probe orchestrator ───────────────────────────────────────────────

/**
 * TensorRT / TensorRT RTX probe functions.
 *
 * These are injected from server.ts because their implementations depend on
 * helpers (getNativeGpuLibPaths, envWithPrependedPaths, etc.) that live in
 * the server.ts module scope.  Passing them as options avoids a circular
 * dependency and keeps the route module self-contained.
 */
export interface SystemProbeOptions {
  probeTensorRtLoadable: (python: string) => Promise<{ loadable: boolean; detail?: string }>;
  probeTensorRtRtxLoadable: (
    python: string,
  ) => Promise<{ loadable: boolean; detail?: string; version?: string }>;
}

/**
 * Probes the host system for hardware capabilities and available inference runtimes.
 *
 * @param opts - Probes used to determine whether TensorRT and TensorRT RTX can load
 * @returns A timestamped report containing platform details, detected hardware, runtime capabilities, provider recommendations, and diagnostic notes
 */
async function probeSystemHardware(opts: SystemProbeOptions): Promise<HardwareProbeResult> {
  const notes: string[] = [];
  const cpus = os.cpus();
  const platform = {
    os: `${process.platform} ${os.release()}`,
    arch: os.arch(),
    cpuModel: cpus[0]?.model?.trim() || "Unknown CPU",
    cpuCores: cpus.length,
    systemRamGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
  };

  const [nvidia, rocm] = await Promise.all([probeNvidiaGpus(), probeRocmGpus()]);

  let openvino: HardwareProbeResult["openvino"];
  let onnxRuntimeProviders: string[] | undefined;
  let tensorrt: HardwareProbeResult["tensorrt"];
  let tensorRtRtx: HardwareProbeResult["tensorRtRtx"];
  let cuda: HardwareProbeResult["cuda"] | undefined;
  let tensorRtVenvLoadable = false;
  let tensorRtRtxVenvLoadable = false;
  let cudaVenvLoadable = false;

  const venvPython = getVenvPython();
  const pythonCandidates: string[] = [];
  if (fs.existsSync(venvPython)) pythonCandidates.push(venvPython);
  const systemPython = await findSystemPython();
  if (systemPython) pythonCandidates.push(systemPython);

  for (const python of pythonCandidates) {
    const pyResult = await probePythonRuntime(python);
    if (pyResult.openvino?.available && !openvino?.available) {
      openvino = pyResult.openvino;
    }
    if (pyResult.onnxRuntimeProviders?.length && !onnxRuntimeProviders?.length) {
      onnxRuntimeProviders = pyResult.onnxRuntimeProviders;
      notes.push(
        `ONNX Runtime providers probed via ${python === venvPython ? ".venv Python" : "system Python"}.`,
      );
    }
    // Probe whether the CUDA execution provider actually loads in this
    // python environment. Distinct from `onnxRuntimeProviders` (which just
    // reports what ORT sees) — this checks the pinned wheel version AND the
    // CUDA EP usability, so a driver/wheel mismatch surfaces as not-loadable
    // with the right error detail. Mirrors how `tensorRtVenvLoadable` is
    // tracked in this same loop.
    if (!cuda) {
      try {
        // Bound the onnxruntime import probe against a hung driver
        // loader. On any modern dev box the probe finishes in well
        // under 5 s; a 30 s ceiling still gives slow CI/turbo-boost-down
        // boxes headroom while keeping the route from stalling the UI
        // on a broken driver install. On timeout, the existing catch
        // branch records `cuda.loadable: false` with the probe-failure
        // detail.
        const { stdout } = await execFileAsync(python, ["-c", ORT_GPU_PROBE_SCRIPT], {
          timeout: ORT_PROBE_TIMEOUT_MS,
        });
        const probe = parseOrtGpuProbe(stdout);
        if (python === venvPython && probe.ok) cudaVenvLoadable = true;
        // Use the canonical pinned-version string from `pinnedOrtGpuLabel`
        // instead of hardcoding "1.26.0". A bump to `oliveGpuRuntime.ts`
        // then propagates here and to the install hint without drift.
        const pinnedLabel = pinnedOrtGpuLabel();
        const requiredVersionMatch = pinnedLabel.match(/==\s*([\d.]+[^\s]*)/);
        const pinnedVersion = requiredVersionMatch?.[1] ?? pinnedLabel;
        cuda = {
          loadable: probe.ok,
          detail: probe.ok
            ? undefined
            : probe.cudaUsable === false
              ? `onnxruntime-gpu CUDA EP not registered (driver/wheel mismatch — got dist ${probe.distVersion ?? "?"} / ort ${probe.ortVersion ?? "?"})`
              : `onnxruntime-gpu not at pinned version ${probe.distVersion ?? probe.ortVersion ?? "?"} (required ${pinnedVersion})`,
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        cuda = {
          loadable: false,
          detail: /No module named ['"]onnxruntime['"]/i.test(msg)
            ? "onnxruntime (CPU/GPU) not installed in .venv"
            : `onnxruntime-gpu probe failed: ${msg.split(/\r?\n/, 1)[0] ?? msg}`,
        };
      }
    }
    if (!tensorrt?.loadable) {
      const trt = await opts.probeTensorRtLoadable(python);
      if (python === venvPython && trt.loadable) {
        tensorRtVenvLoadable = true;
      }
      if (trt.loadable || !tensorrt) {
        tensorrt = trt;
      }
    }
    if (!tensorRtRtx?.loadable) {
      const rtx = await opts.probeTensorRtRtxLoadable(python);
      if (python === venvPython && rtx.loadable) {
        tensorRtRtxVenvLoadable = true;
      }
      if (rtx.loadable || !tensorRtRtx) {
        tensorRtRtx = rtx;
      }
    }
  }

  if (tensorRtRtxVenvLoadable) {
    notes.push(`TensorRT RTX runtime verified${tensorRtRtx?.version ? ` (${tensorRtRtx.version})` : ""}.`);
  } else if (nvidia?.gpus.length) {
    notes.push(
      tensorRtRtx?.detail
        ? `TensorRT RTX plugin not ready (${tensorRtRtx.detail}). GPU is compatible — install tensorrt-rtx from Hardware or on first TRT RTX run.`
        : "TensorRT RTX plugin (tensorrt-rtx) not in .venv yet. GPU is compatible — use Install in Hardware, or Olive installs it on first TRT RTX run.",
    );
  }

  if (tensorRtVenvLoadable) {
    notes.push("TensorRT execution provider load verified.");
  } else if (nvidia?.gpus.length) {
    notes.push(
      tensorrt?.detail
        ? `Full TensorRT SDK not ready (${tensorrt.detail}). GPU is compatible — install tensorrt from Hardware or on first TensorRT run.`
        : "Full TensorRT SDK (nvinfer_10) not in .venv yet. GPU is compatible — use Install in Hardware, or Olive installs it on first TensorRT run.",
    );
  }

  if (cudaVenvLoadable) {
    notes.push("CUDA execution provider load verified.");
  } else if (nvidia?.gpus.length) {
    // Derive the install command from the pinned args so a wheel-pin
    // bump updates this hint and the probe-detail string above in
    // lockstep.
    const ortGpuCmd = pinnedOrtGpuInstallCommand();
    notes.push(
      cuda?.detail
        ? `${cuda.detail}. GPU is compatible — click "Install onnxruntime-gpu" in Hardware (step 02) or run \`${ortGpuCmd}\` to enable CUDA EP.`
        : `${ortGpuCmd} not yet run in .venv. GPU is compatible — click "Install onnxruntime-gpu" in Hardware (step 02) or it installs on first CUDA run.`,
    );
  }

  if (onnxRuntimeProviders?.length) {
    notes.push(`ORT execution providers: ${onnxRuntimeProviders.join(", ")}`);
    if (nvidia && !onnxRuntimeProviders.includes("CUDAExecutionProvider")) {
      notes.push(
        "NVIDIA GPU detected but ONNX Runtime CUDA EP is not installed in Python (try onnxruntime-gpu in .venv).",
      );
    }
  } else if (nvidia) {
    notes.push("ONNX Runtime not installed in Python — NVIDIA GPU inferred from nvidia-smi.");
  }

  if (!nvidia) notes.push("No NVIDIA GPU detected (nvidia-smi unavailable or returned no devices).");
  if (!rocm) notes.push("No AMD ROCm GPU detected.");
  if (!openvino?.available) notes.push("OpenVINO Python package not found locally.");
  notes.push("QNN requires Snapdragon/Hexagon dev hardware — not probed on desktop.");

  // Surface pre-Maxwell NVIDIA boxes (every detected GPU below the CUDA 12
  // toolkit floor) so the IHV panel / recipe compat layer can suppress the
  // install hints (no install can recover Kepler SM 3.x). Mirrors the
  // pre-Turing TensorRT short-circuit a few lines above.
  if (nvidia?.gpus.length && isPreMaxwellNvidiaBox(nvidia.gpus)) {
    notes.push(
      `NVIDIA GPU(s) below CUDA 12 toolkit floor (compute capability < ${CUDA_SM_FLOOR}); modern CUDA cannot run on Maxwell/Pascal/Kepler cards.`,
    );
  } else if (nvidia?.cudaToolkit?.available === false) {
    notes.push(
      "CUDA driver detected but the CUDA Toolkit (nvcc) is not installed. Inference via onnxruntime-gpu does not need it; get it from NVIDIA's CUDA Toolkit Archive for native builds.",
    );
  }

  // Gate TensorRT-family EPs on the SM ≥ 7.5 (Turing) floor.
  // `hasNvidiaGpu` alone is not enough: pre-Turing cards return CUDA from
  // ONNX Runtime but cannot execute TensorRT 10.x or TensorRT-RTX, so we
  // must strip those EPs from the detected list (and from the install-needed
  // hint path) before reporting compat.
  const nvidiaTensorRtFamilyCapable = nvidia
    ? nvidia.gpus.some((g) => isNvidiaGpuTensorRtFamily(g))
    : false;
  // Only warn when there are *actual* GPUs below the floor — `[].some(...)`
  // returning false for an empty GPU list would otherwise print a misleading
  // "all NVIDIA GPUs below TensorRT floor" note on machines with zero GPUs.
  if (nvidiaTensorRtFamilyCapable === false && (nvidia?.gpus.length ?? 0) > 0) {
    notes.push(
      `NVIDIA GPU(s) below TensorRT 10.x floor (compute capability < ${TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY.major}.${TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY.minor}); TensorRT / TensorRT-RTX EPs hidden.`,
    );
  }

  const detectedProviders = mergeDetectedProviders({
    onnxRuntimeProviders,
    hasNvidiaGpu: Boolean(nvidia?.gpus.length),
    hasRocmGpu: Boolean(rocm?.gpus.length),
    hasOpenVino: Boolean(openvino?.available),
    tensorRtLoadable: tensorRtVenvLoadable,
    tensorRtRtxLoadable: tensorRtRtxVenvLoadable,
    nvidiaTensorRtFamilyCapable,
    cudaLoadable: cudaVenvLoadable,
  });

  return {
    probedAt: new Date().toISOString(),
    platform,
    nvidia,
    rocm,
    openvino,
    // UI consumers (IHV panel) read `.loadable`; keep it aligned with .venv readiness.
    tensorrt: tensorrt ? { ...tensorrt, loadable: tensorRtVenvLoadable } : tensorrt,
    tensorRtRtx: tensorRtRtx ? { ...tensorRtRtx, loadable: tensorRtRtxVenvLoadable } : tensorRtRtx,
    cuda: cuda ? { ...cuda, loadable: cudaVenvLoadable } : cuda,
    onnxRuntimeProviders,
    detectedProviders,
    recommendedProvider: pickRecommendedProvider(detectedProviders, {
      tensorRtRtxLoadable: tensorRtRtxVenvLoadable,
      tensorRtLoadable: tensorRtVenvLoadable,
    }),
    notes,
  };
}

// ─── Cache ─────────────────────────────────────────────────────────────────

let hardwareProbeCache: { at: number; result: HardwareProbeResult } | null = null;
const HARDWARE_PROBE_CACHE_MS = 30_000;

function enrichProbeWithSystemRam(result: HardwareProbeResult): HardwareProbeResult {
  const systemRamGb = Math.round((os.totalmem() / 1024 ** 3) * 10) / 10;
  return {
    ...result,
    platform: {
      ...result.platform,
      systemRamGb: result.platform.systemRamGb ?? systemRamGb,
    },
  };
}

// ─── Mount ─────────────────────────────────────────────────────────────────

export function mountSystemRoutes(router: Router, opts: SystemProbeOptions): void {
  router.get("/system/hardware-probe", async (req, res) => {
    try {
      const refresh = req.query.refresh === "1" || req.query.refresh === "true";
      const now = Date.now();
      if (!refresh && hardwareProbeCache && now - hardwareProbeCache.at < HARDWARE_PROBE_CACHE_MS) {
        return res.json(enrichProbeWithSystemRam(hardwareProbeCache.result));
      }
      const result = enrichProbeWithSystemRam(await probeSystemHardware(opts));
      hardwareProbeCache = { at: now, result };
      return res.json(result);
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : "Hardware probe failed.",
      });
    }
  });
}
