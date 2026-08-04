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
  mergeDetectedProviders,
  pickRecommendedProvider,
  type HardwareProbeResult,
  type OpenVinoProbeResult,
} from "../../lib/hardwareProbe.ts";

const execFileAsync = promisify(execFile);

// ─── GPU probes ────────────────────────────────────────────────────────────

async function probeNvidiaGpus(): Promise<HardwareProbeResult["nvidia"] | undefined> {
  try {
    const { stdout } = await execFileAsync("nvidia-smi", [
      "--query-gpu=name,driver_version,memory.total",
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
        let vramMb: number | undefined;
        if (memStr) {
          const m = memStr.match(/(\d+)/);
          if (m) vramMb = parseInt(m[1], 10);
        }
        return { name, driver, vramMb };
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

    return { gpus, cudaVersion, cudaTag };
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
): Promise<Pick<HardwareProbeResult, "onnxRuntimeProviders">> {
  const result: Pick<HardwareProbeResult, "onnxRuntimeProviders"> = {};

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
  probeOpenVino: (python: string) => Promise<OpenVinoProbeResult>;
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

  let openvino: OpenVinoProbeResult | undefined;
  let openvinoVenvAvailable = false;
  let onnxRuntimeProviders: string[] | undefined;
  let tensorrt: HardwareProbeResult["tensorrt"];
  let tensorRtRtx: HardwareProbeResult["tensorRtRtx"];
  let tensorRtVenvLoadable = false;
  let tensorRtRtxVenvLoadable = false;

  const venvPython = getVenvPython();
  const pythonCandidates: string[] = [];
  if (fs.existsSync(venvPython)) pythonCandidates.push(venvPython);
  const systemPython = await findSystemPython();
  if (systemPython) pythonCandidates.push(systemPython);

  for (const python of pythonCandidates) {
    const [pyResult, ov, trt, rtx] = await Promise.all([
      probePythonRuntime(python),
      opts.probeOpenVino(python),
      opts.probeTensorRtLoadable(python),
      opts.probeTensorRtRtxLoadable(python),
    ]);
    if (pyResult.onnxRuntimeProviders?.length && !onnxRuntimeProviders?.length) {
      onnxRuntimeProviders = pyResult.onnxRuntimeProviders;
      notes.push(
        `ONNX Runtime providers probed via ${python === venvPython ? ".venv Python" : "system Python"}.`,
      );
    }

    const hasOpenVinoSignal = Boolean(ov.version || ov.devices?.length || ov.optimumIntel || ov.detail);
    if (hasOpenVinoSignal || ov.available) {
      if (python === venvPython) {
        openvino = ov;
        openvinoVenvAvailable = ov.available;
      } else if (!openvino) {
        openvino = ov;
      }
    }

    if (python === venvPython && trt.loadable) tensorRtVenvLoadable = true;
    if (trt.loadable || !tensorrt) tensorrt = trt;
    if (python === venvPython && rtx.loadable) tensorRtRtxVenvLoadable = true;
    if (rtx.loadable || !tensorRtRtx) tensorRtRtx = rtx;
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
  if (openvinoVenvAvailable) {
    const deviceMsg = openvino?.devices?.length ? ` [${openvino.devices.join(", ")}]` : "";
    notes.push(`OpenVINO stack verified${openvino?.version ? ` (${openvino.version})` : ""}${deviceMsg}.`);
  } else if (openvino?.version || openvino?.devices?.length || openvino?.optimumIntel) {
    notes.push("OpenVINO is present but the complete .venv stack is not ready — use Install in Hardware.");
  } else {
    notes.push("OpenVINO Python package not found locally.");
  }
  notes.push("QNN requires Snapdragon/Hexagon dev hardware — not probed on desktop.");

  const hasOpenVinoCompatibleHardware = /Intel|Xeon|Core|Arc|Ultra/i.test(platform.cpuModel);

  const detectedProviders = mergeDetectedProviders({
    onnxRuntimeProviders,
    hasNvidiaGpu: Boolean(nvidia?.gpus.length),
    hasRocmGpu: Boolean(rocm?.gpus.length),
    hasOpenVino: Boolean(openvino?.available),
    hasOpenVinoCompatibleHardware,
    tensorRtLoadable: tensorRtVenvLoadable,
    tensorRtRtxLoadable: tensorRtRtxVenvLoadable,
  });

  return {
    probedAt: new Date().toISOString(),
    platform,
    nvidia,
    rocm,
    openvino: openvino ? { ...openvino, available: openvinoVenvAvailable } : undefined,
    // UI consumers (IHV panel) read `.loadable`; keep it aligned with .venv readiness.
    tensorrt: tensorrt ? { ...tensorrt, loadable: tensorRtVenvLoadable } : tensorrt,
    tensorRtRtx: tensorRtRtx ? { ...tensorRtRtx, loadable: tensorRtRtxVenvLoadable } : tensorRtRtx,
    onnxRuntimeProviders,
    detectedProviders,
    recommendedProvider: pickRecommendedProvider(detectedProviders, {
      tensorRtRtxLoadable: tensorRtRtxVenvLoadable,
      tensorRtLoadable: tensorRtVenvLoadable,
      openvinoLoadable: openvinoVenvAvailable,
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
