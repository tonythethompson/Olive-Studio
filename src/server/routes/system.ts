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
import { envForFamily } from "../services/venv/pathIsolation.ts";
import { parseCudaVersionFromNvidiaSmi } from "../services/olive/cuda.ts";
import {
  computeOpenVinoCompatibleHardware,
  computeQnnCompatibleHardware,
  isNvidiaGpuTensorRtFamily,
  mergeDetectedProviders,
  pickRecommendedProvider,
  TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY,
  type HardwareProbeResult,
  type OpenVinoProbeResult,
  type QnnProbeResult,
} from "../../lib/hardwareProbe.ts";
import {
  isQnnSnapdragonReleaseGatePassed,
  resolveQnnHostMode,
} from "../../lib/qnnDeps.ts";
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
import {
  markQnnVenvLoadable,
  markTensorRtVenvLoadable,
  mergeOrtProvidersForDisplay,
  resolveDirectMlEpDetected,
} from "./systemHardwareProbePolicy.ts";

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

async function probeIntelGpuNames(): Promise<string[]> {
  if (process.platform === "linux") {
    try {
      const { stdout } = await execFileAsync("lspci", ["-nn"]);
      return stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /VGA|3D|Display/i.test(line) && /Intel/i.test(line));
    } catch {
      return [];
    }
  }
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name",
      ]);
      return stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((name) => name.length > 0 && /Intel/i.test(name));
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Probes a Python interpreter for OpenVINO and ONNX Runtime support.
 *
 * @param python - The Python interpreter to probe
 * @param env - Environment variables used when launching the interpreter
 * @returns Detected OpenVINO availability and version, plus available ONNX Runtime providers
 */
async function probePythonRuntime(
  python: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Pick<HardwareProbeResult, "openvino" | "onnxRuntimeProviders">> {
  const result: Pick<HardwareProbeResult, "openvino" | "onnxRuntimeProviders"> = {};

  try {
    const { stdout } = await execFileAsync(
      python,
      ["-c", "import openvino; print(openvino.__version__)"],
      { env, timeout: ORT_PROBE_TIMEOUT_MS },
    );
    const version = stdout.trim();
    if (version) result.openvino = { available: true, version };
  } catch {
    result.openvino = { available: false };
  }

  try {
    const { stdout } = await execFileAsync(
      python,
      ["-c", "import onnxruntime as ort; print(','.join(ort.get_available_providers()))"],
      { env, timeout: ORT_PROBE_TIMEOUT_MS },
    );
    const providers = stdout.trim().split(",").filter(Boolean);
    if (providers.length > 0) result.onnxRuntimeProviders = providers;
  } catch {
    /* onnxruntime not installed */
  }

  return result;
}

// ─── Probe diagnostics ────────────────────────────────────────────────────

export interface ProbeDiagnosticInput {
  defaultOrtProviders?: string[];
  cudaOrtProviders?: string[];
  openvinoOrtProviders?: string[];
  qnnOrtProviders?: string[];
  systemOrtProviders?: string[];
  tensorRtRtxVenvLoadable: boolean;
  tensorRtRtx?: HardwareProbeResult["tensorRtRtx"];
  tensorRtVenvLoadable: boolean;
  tensorrt?: HardwareProbeResult["tensorrt"];
  cudaVenvLoadable: boolean;
  cuda?: HardwareProbeResult["cuda"];
  nvidia?: HardwareProbeResult["nvidia"];
  rocm?: HardwareProbeResult["rocm"];
  openvinoVenvAvailable: boolean;
  openvino?: OpenVinoProbeResult;
  qnnVenvLoadable: boolean;
  qnn?: QnnProbeResult;
  platformArch: string;
  platformOs: NodeJS.Platform;
}

export interface ProbeDiagnosticOutput {
  notes: string[];
  onnxRuntimeProviders?: string[];
  nvidiaTensorRtFamilyCapable: boolean;
  qnnHostMode: ReturnType<typeof resolveQnnHostMode>;
}

/**
 * Builds diagnostic notes for ONNX Runtime provider detection and GPU availability.
 *
 * @param input - Probe results used to identify the runtime source and detected GPUs
 * @param onnxRuntimeProviders - Merged ONNX Runtime execution providers
 * @returns Diagnostic notes describing provider detection and missing NVIDIA or AMD GPUs
 */
function buildOrtProviderNotes(
  input: ProbeDiagnosticInput,
  onnxRuntimeProviders: string[] | undefined,
): string[] {
  const notes: string[] = [];
  if (input.defaultOrtProviders?.length) {
    notes.push("ONNX Runtime providers probed via default runtime.");
  } else if (input.cudaOrtProviders?.length) {
    notes.push("ONNX Runtime providers probed via CUDA runtime.");
  } else if (input.openvinoOrtProviders?.length) {
    notes.push("ONNX Runtime providers probed via OpenVINO runtime.");
  } else if (input.qnnOrtProviders?.length) {
    notes.push("ONNX Runtime providers probed via QNN runtime.");
  } else if (input.systemOrtProviders?.length) {
    notes.push("ONNX Runtime providers probed via system Python.");
  }

  // List merged providers for display only. Do not infer CUDA readiness from
  // this combined list — default/DirectML/OpenVINO entries would falsely trip
  // a CUDA-missing warning. CUDA install/loadability notes already gate on
  // `cudaVenvLoadable` / the cuda-family probe.
  if (onnxRuntimeProviders?.length) {
    notes.push(`ORT execution providers: ${onnxRuntimeProviders.join(", ")}`);
  } else if (input.nvidia) {
    notes.push("ONNX Runtime not installed in Python — NVIDIA GPU inferred from nvidia-smi.");
  }

  if (!input.nvidia) notes.push("No NVIDIA GPU detected (nvidia-smi unavailable or returned no devices).");
  if (!input.rocm) notes.push("No AMD ROCm GPU detected.");
  return notes;
}

/**
 * Builds diagnostic notes for TensorRT and TensorRT RTX runtime readiness and GPU compatibility.
 *
 * @param input - Probe results used to determine TensorRT runtime status and NVIDIA GPU capability
 * @returns TensorRT diagnostic notes and whether any NVIDIA GPU supports the TensorRT family
 */
function buildTensorRtNotes(input: ProbeDiagnosticInput): {
  notes: string[];
  nvidiaTensorRtFamilyCapable: boolean;
} {
  const notes: string[] = [];
  if (input.tensorRtRtxVenvLoadable) {
    notes.push(`TensorRT RTX runtime verified${input.tensorRtRtx?.version ? ` (${input.tensorRtRtx.version})` : ""}.`);
  } else if (input.nvidia?.gpus.length) {
    notes.push(
      input.tensorRtRtx?.detail
        ? `TensorRT RTX plugin not ready (${input.tensorRtRtx.detail}). GPU is compatible — install tensorrt-rtx from Hardware or on first TRT RTX run.`
        : "TensorRT RTX plugin (tensorrt-rtx) not in .venv yet. GPU is compatible — use Install in Hardware, or Olive installs it on first TRT RTX run.",
    );
  }

  if (input.tensorRtVenvLoadable) {
    notes.push("TensorRT execution provider load verified.");
  } else if (input.nvidia?.gpus.length) {
    notes.push(
      input.tensorrt?.detail
        ? `Full TensorRT SDK not ready (${input.tensorrt.detail}). GPU is compatible — install tensorrt from Hardware or on first TensorRT run.`
        : "Full TensorRT SDK (nvinfer_10) not in .venv yet. GPU is compatible — use Install in Hardware, or Olive installs it on first TensorRT run.",
    );
  }

  // Gate TensorRT-family EPs on the SM ≥ 7.5 (Turing) floor.
  const nvidiaTensorRtFamilyCapable = input.nvidia
    ? input.nvidia.gpus.some((g) => isNvidiaGpuTensorRtFamily(g))
    : false;
  // Only warn when there are *actual* GPUs below the floor — `[].some(...)`
  // returning false for an empty GPU list would otherwise print a misleading
  // "all NVIDIA GPUs below TensorRT floor" note on machines with zero GPUs.
  if (nvidiaTensorRtFamilyCapable === false && (input.nvidia?.gpus.length ?? 0) > 0) {
    notes.push(
      `NVIDIA GPU(s) below TensorRT 10.x floor (compute capability < ${TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY.major}.${TENSORRT_FAMILY_MIN_COMPUTE_CAPABILITY.minor}); TensorRT / TensorRT-RTX EPs hidden.`,
    );
  }
  return { notes, nvidiaTensorRtFamilyCapable };
}

/**
 * Builds diagnostic notes for CUDA execution provider readiness and GPU compatibility.
 *
 * @param input - Probe results used to assess CUDA availability, NVIDIA GPU support, and CUDA Toolkit installation
 * @returns Diagnostic messages describing CUDA readiness, installation requirements, or compatibility limitations
 */
function buildCudaNotes(input: ProbeDiagnosticInput): string[] {
  const notes: string[] = [];
  if (input.cudaVenvLoadable) {
    notes.push("CUDA execution provider load verified.");
  } else if (input.nvidia?.gpus.length) {
    // Derive the install command from the pinned args so a wheel-pin
    // bump updates this hint and the probe-detail string above in lockstep.
    const ortGpuCmd = pinnedOrtGpuInstallCommand();
    notes.push(
      input.cuda?.detail
        ? `${input.cuda.detail}. GPU is compatible — click "Install onnxruntime-gpu" in Hardware (step 02) or run \`${ortGpuCmd}\` to enable CUDA EP.`
        : `${ortGpuCmd} not yet run in .venv. GPU is compatible — click "Install onnxruntime-gpu" in Hardware (step 02) or it installs on first CUDA run.`,
    );
  }

  // Surface pre-Maxwell NVIDIA boxes (every detected GPU below the CUDA 12
  // toolkit floor) so the IHV panel / recipe compat layer can suppress the
  // install hints (no install can recover Kepler SM 3.x).
  if (input.nvidia?.gpus.length && isPreMaxwellNvidiaBox(input.nvidia.gpus)) {
    notes.push(
      `NVIDIA GPU(s) below CUDA 12 toolkit floor (compute capability < ${CUDA_SM_FLOOR}); modern CUDA cannot run on Maxwell/Pascal/Kepler cards.`,
    );
  } else if (input.nvidia?.cudaToolkit?.available === false) {
    notes.push(
      "CUDA driver detected but the CUDA Toolkit (nvcc) is not installed. Inference via onnxruntime-gpu does not need it; get it from NVIDIA's CUDA Toolkit Archive for native builds.",
    );
  }
  return notes;
}

/**
 * Builds diagnostic notes describing the availability and readiness of the OpenVINO Python stack.
 *
 * @param input - Probe results used to determine OpenVINO installation status and device details
 * @returns Diagnostic messages for the OpenVINO stack
 */
function buildOpenVinoNotes(input: ProbeDiagnosticInput): string[] {
  const notes: string[] = [];
  if (input.openvinoVenvAvailable) {
    const deviceMsg = input.openvino?.devices?.length ? ` [${input.openvino.devices.join(", ")}]` : "";
    notes.push(
      `OpenVINO stack verified${input.openvino?.version ? ` (${input.openvino.version})` : ""}${deviceMsg}.`,
    );
  } else if (input.openvino?.version || input.openvino?.devices?.length || input.openvino?.optimumIntel) {
    notes.push(
      input.openvino?.detail
        ? `OpenVINO stack not ready (${input.openvino.detail}). Use Install in Hardware (openvino + optimum-intel).`
        : "OpenVINO packages are incomplete — use Install in Hardware.",
    );
  } else {
    notes.push("OpenVINO Python stack not found locally (needs openvino + optimum-intel).");
  }
  return notes;
}

/**
 * Builds diagnostic notes describing QNN runtime availability and host compatibility.
 *
 * @param input - Probe results and QNN runtime state used to determine readiness.
 * @param qnnHostMode - Host mode that determines whether local inference or preparation is supported.
 * @returns Diagnostic messages describing QNN readiness, installation requirements, or platform limitations.
 */
function buildQnnNotes(
  input: ProbeDiagnosticInput,
  qnnHostMode: ReturnType<typeof resolveQnnHostMode>,
): string[] {
  const notes: string[] = [];
  if (input.qnnVenvLoadable) {
    if (input.qnn?.verifiedInference && isQnnSnapdragonReleaseGatePassed()) {
      notes.push(
        `QNN NPU ready${input.qnn.pluginVersion ? ` (plugin ${input.qnn.pluginVersion})` : ""} — fail-closed HTP diagnostic passed.`,
      );
    } else if (qnnHostMode === "preparation") {
      notes.push(
        `QNN runtime installed${input.qnn?.pluginVersion ? ` (${input.qnn.pluginVersion})` : ""} — Windows x64 preparation / plugin AOT only (not local HTP inference).`,
      );
    } else if (input.qnn?.npuDevice) {
      notes.push(
        `QNN runtime installed with NPU EpDevice${input.qnn.pluginVersion ? ` (${input.qnn.pluginVersion})` : ""}. “QNN NPU ready” waits on the Snapdragon release gate` +
          (input.qnn.htpSmoke?.status === "passed" ? " (HTP diagnostic already cached)." : " + Test QNN NPU."),
      );
    } else {
      notes.push(
        `QNN runtime installed${input.qnn?.pluginVersion ? ` (${input.qnn.pluginVersion})` : ""} — plugin registration ok; NPU device not filtered yet.`,
      );
    }
  } else if (qnnHostMode === "local-inference" || qnnHostMode === "preparation") {
    notes.push(
      input.qnn?.detail
        ? `QNN stack not ready (${input.qnn.detail}). Use Install QNN runtime in Hardware (.venvs/qnn).`
        : qnnHostMode === "preparation"
          ? "Windows x64: install QNN runtime for plugin preparation / AOT (not local HTP inference)."
          : "Windows ARM64: install QNN runtime (.venvs/qnn) for Snapdragon NPU workflows.",
    );
  } else {
    notes.push(
      "QNN plugin install/UX is Windows-first in this release (Win ARM64 inference / Win x64 preparation).",
    );
  }
  return notes;
}

/**
 * Assembles hardware-probe diagnostics and derived provider capability data.
 *
 * @param input - Probe results and platform information used to generate diagnostics.
 * @returns Diagnostic notes, merged ONNX Runtime providers, TensorRT family capability, and QNN host mode.
 */
export function buildProbeDiagnostics(input: ProbeDiagnosticInput): ProbeDiagnosticOutput {
  const onnxRuntimeProviders = mergeOrtProvidersForDisplay(
    input.defaultOrtProviders,
    input.cudaOrtProviders,
    input.openvinoOrtProviders,
    input.qnnOrtProviders,
    input.systemOrtProviders,
  );
  const qnnHostMode = resolveQnnHostMode({ platform: input.platformOs, arch: input.platformArch });

  const ortNotes = buildOrtProviderNotes(input, onnxRuntimeProviders);
  const { notes: tensorRtNotes, nvidiaTensorRtFamilyCapable } = buildTensorRtNotes(input);
  const cudaNotes = buildCudaNotes(input);

  const ortSourceNotes = ortNotes.filter((n) => n.startsWith("ONNX Runtime providers probed"));
  const ortSummaryNotes = ortNotes.filter((n) => !n.startsWith("ONNX Runtime providers probed"));
  const tensorRtLoadNotes = tensorRtNotes.filter((n) => !n.includes("below TensorRT 10.x floor"));
  const tensorRtFloorNotes = tensorRtNotes.filter((n) => n.includes("below TensorRT 10.x floor"));
  const cudaLoadNotes = cudaNotes.filter(
    (n) => !n.includes("below CUDA 12 toolkit floor") && !n.includes("CUDA Toolkit (nvcc)"),
  );
  const cudaFloorNotes = cudaNotes.filter(
    (n) => n.includes("below CUDA 12 toolkit floor") || n.includes("CUDA Toolkit (nvcc)"),
  );

  const notes = [
    ...ortSourceNotes,
    ...tensorRtLoadNotes,
    ...cudaLoadNotes,
    ...ortSummaryNotes,
    ...buildOpenVinoNotes(input),
    ...buildQnnNotes(input, qnnHostMode),
    ...cudaFloorNotes,
    ...tensorRtFloorNotes,
  ];

  return { notes, onnxRuntimeProviders, nvidiaTensorRtFamilyCapable, qnnHostMode };
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
  probeTensorRtLoadable: (
    python: string,
    env?: NodeJS.ProcessEnv,
  ) => Promise<{ loadable: boolean; detail?: string }>;
  probeTensorRtRtxLoadable: (
    python: string,
    env?: NodeJS.ProcessEnv,
  ) => Promise<{ loadable: boolean; detail?: string; version?: string }>;
  probeOpenVino: (python: string) => Promise<OpenVinoProbeResult>;
  probeQnn: (python: string) => Promise<QnnProbeResult>;
}

/**
 * Probes the host system for hardware capabilities and available inference runtimes.
 *
 * @param opts - Probe functions used to determine runtime availability and loadability
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

  const [nvidia, rocm, intelGpuNames] = await Promise.all([
    probeNvidiaGpus(),
    probeRocmGpus(),
    probeIntelGpuNames(),
  ]);

  let openvino: OpenVinoProbeResult | undefined;
  let openvinoVenvAvailable = false;
  let qnn: QnnProbeResult | undefined;
  let qnnVenvLoadable = false;
  let defaultOrtProviders: string[] | undefined;
  let cudaOrtProviders: string[] | undefined;
  let openvinoOrtProviders: string[] | undefined;
  let qnnOrtProviders: string[] | undefined;
  let systemOrtProviders: string[] | undefined;
  let tensorrt: HardwareProbeResult["tensorrt"];
  let tensorRtRtx: HardwareProbeResult["tensorRtRtx"];
  let cuda: HardwareProbeResult["cuda"] | undefined;
  let tensorRtVenvLoadable = false;
  let tensorRtRtxVenvLoadable = false;
  let cudaVenvLoadable = false;

  const defaultPython = getVenvPython("default");
  const cudaPython = getVenvPython("cuda");
  const openvinoPython = getVenvPython("openvino");
  const qnnPython = getVenvPython("qnn");
  const cudaPythonExists = fs.existsSync(cudaPython);
  const openvinoPythonExists = fs.existsSync(openvinoPython);
  const qnnPythonExists = fs.existsSync(qnnPython);
  const pythonCandidates: string[] = [];
  if (fs.existsSync(defaultPython)) pythonCandidates.push(defaultPython);
  if (cudaPythonExists) pythonCandidates.push(cudaPython);
  if (openvinoPythonExists) pythonCandidates.push(openvinoPython);
  if (qnnPythonExists) pythonCandidates.push(qnnPython);
  const systemPython = await findSystemPython();
  if (systemPython) pythonCandidates.push(systemPython);

  for (const python of pythonCandidates) {
    const isDefault = python === defaultPython;
    const isCuda = python === cudaPython;
    const isOpenvino = python === openvinoPython;
    const isQnn = python === qnnPython;
    const familyEnv = isCuda
      ? envForFamily("cuda")
      : isOpenvino
        ? envForFamily("openvino")
        : isQnn
          ? envForFamily("qnn")
          : isDefault
            ? envForFamily("default")
            : process.env;
    const [pyResult, ov, qnnProbe] = await Promise.all([
      probePythonRuntime(python, familyEnv),
      isOpenvino
        ? opts.probeOpenVino(python)
        : Promise.resolve({ available: false } as OpenVinoProbeResult),
      isQnn
        ? opts.probeQnn(python)
        : Promise.resolve({ available: false } as QnnProbeResult),
    ]);
    const hasOpenVinoSignal = Boolean(ov.version || ov.devices?.length || ov.optimumIntel || ov.detail);
    if (isOpenvino && (hasOpenVinoSignal || ov.available)) {
      openvino = ov;
      openvinoVenvAvailable = ov.available;
    }
    if (isQnn && (qnnProbe.available || qnnProbe.detail || qnnProbe.pluginVersion)) {
      qnn = qnnProbe;
      if (
        markQnnVenvLoadable({
          isQnn: true,
          loadable: Boolean(qnnProbe.loadable || qnnProbe.preparation),
        })
      ) {
        qnnVenvLoadable = true;
      }
    }
    if (pyResult.onnxRuntimeProviders?.length) {
      if (isDefault) defaultOrtProviders = pyResult.onnxRuntimeProviders;
      else if (isCuda) cudaOrtProviders = pyResult.onnxRuntimeProviders;
      else if (isOpenvino) openvinoOrtProviders = pyResult.onnxRuntimeProviders;
      else if (isQnn) qnnOrtProviders = pyResult.onnxRuntimeProviders;
      else systemOrtProviders = pyResult.onnxRuntimeProviders;
    }
    // CUDA / TRT probes prefer the cuda-family python, with PATH isolation so
    // sibling family Scripts dirs cannot skew EP discovery.
    if (!cuda && (isCuda || (!cudaPythonExists && isDefault))) {
      try {
        const { stdout } = await execFileAsync(python, ["-c", ORT_GPU_PROBE_SCRIPT], {
          timeout: ORT_PROBE_TIMEOUT_MS,
          env: familyEnv,
        });
        const probe = parseOrtGpuProbe(stdout);
        if (isCuda && probe.ok) cudaVenvLoadable = true;
        if (isDefault && !cudaPythonExists && probe.ok) cudaVenvLoadable = true;
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
            ? "onnxruntime (CPU/GPU) not installed in CUDA runtime"
            : `onnxruntime-gpu probe failed: ${msg.split(/\r?\n/, 1)[0] ?? msg}`,
        };
      }
    }
    if (!tensorrt?.loadable && (isCuda || (!cudaPythonExists && isDefault))) {
      const trt = await opts.probeTensorRtLoadable(python, familyEnv);
      if (
        markTensorRtVenvLoadable({
          isCuda,
          isDefault,
          cudaPythonExists,
          loadable: trt.loadable,
        })
      ) {
        tensorRtVenvLoadable = true;
      }
      if (trt.loadable || !tensorrt) {
        tensorrt = trt;
      }
    }
    if (!tensorRtRtx?.loadable && (isCuda || (!cudaPythonExists && isDefault))) {
      const rtx = await opts.probeTensorRtRtxLoadable(python, familyEnv);
      if (
        markTensorRtVenvLoadable({
          isCuda,
          isDefault,
          cudaPythonExists,
          loadable: rtx.loadable,
        })
      ) {
        tensorRtRtxVenvLoadable = true;
      }
      if (rtx.loadable || !tensorRtRtx) {
        tensorRtRtx = rtx;
      }
    }
  }

  const diag = buildProbeDiagnostics({
    defaultOrtProviders,
    cudaOrtProviders,
    openvinoOrtProviders,
    qnnOrtProviders,
    systemOrtProviders,
    tensorRtRtxVenvLoadable,
    tensorRtRtx,
    tensorRtVenvLoadable,
    tensorrt,
    cudaVenvLoadable,
    cuda,
    nvidia,
    rocm,
    openvinoVenvAvailable,
    openvino,
    qnnVenvLoadable,
    qnn,
    platformArch: platform.arch,
    platformOs: process.platform,
  });
  notes.push(...diag.notes);
  const { onnxRuntimeProviders, nvidiaTensorRtFamilyCapable, qnnHostMode } = diag;


  const hasOpenVinoCompatibleHardware = computeOpenVinoCompatibleHardware({
    cpuModel: platform.cpuModel,
    intelGpuNames,
    openvinoDevices: openvino?.devices,
  });

  const hasQnnCompatibleHardware = computeQnnCompatibleHardware({
    os: platform.os,
    arch: platform.arch,
    qnnLoadable: qnnVenvLoadable,
    ortReportsQnn: Boolean(
      onnxRuntimeProviders?.includes("QNNExecutionProvider") || qnnOrtProviders?.includes("QNNExecutionProvider"),
    ),
  });

  // Execute Live uses the default Olive runtime for platform-local EPs. Do not
  // let providers from system/CUDA/OpenVINO/QNN runtimes authorize that path.
  const detectedProviders = mergeDetectedProviders({
    onnxRuntimeProviders: defaultOrtProviders,
    hasNvidiaGpu: Boolean(nvidia?.gpus.length),
    hasRocmGpu: Boolean(rocm?.gpus.length),
    hasOpenVino: Boolean(openvino?.available),
    hasOpenVinoCompatibleHardware,
    // Hardware readiness (Windows / DX12 class) is separate from EP registration.
    // hasDirectMl must reflect ORT reporting DmlExecutionProvider so install CTAs stay accurate.
    hasDirectMl: resolveDirectMlEpDetected({
      defaultProviders: onnxRuntimeProviders,
    }),
    hasQnnCompatibleHardware,
    qnnLoadable: qnnVenvLoadable,
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
    openvino: openvino
      ? { ...openvino, available: openvinoVenvAvailable, loadable: openvinoVenvAvailable }
      : undefined,
    qnn: qnn
      ? {
          ...qnn,
          available: qnnVenvLoadable,
          loadable: qnnVenvLoadable,
          hostMode: qnn.hostMode ?? qnnHostMode,
        }
      : qnnHostMode !== "out-of-scope"
        ? {
            available: false,
            loadable: false,
            preparation: false,
            npuDevice: false,
            potentialInference: false,
            verifiedInference: false,
            hostMode: qnnHostMode,
            detail:
              qnnHostMode === "preparation"
                ? "QNN runtime not installed (.venvs/qnn) — Windows x64 preparation / plugin AOT only"
                : "QNN runtime not installed (.venvs/qnn)",
          }
        : {
            available: false,
            loadable: false,
            preparation: false,
            npuDevice: false,
            potentialInference: false,
            verifiedInference: false,
            hostMode: qnnHostMode,
            detail: "QNN plugin install/UX is Windows-first in this release",
          },
    // UI consumers (IHV panel) read `.loadable`; keep it aligned with .venv readiness.
    tensorrt: tensorrt ? { ...tensorrt, loadable: tensorRtVenvLoadable } : tensorrt,
    tensorRtRtx: tensorRtRtx ? { ...tensorRtRtx, loadable: tensorRtRtxVenvLoadable } : tensorRtRtx,
    cuda: cuda ? { ...cuda, loadable: cudaVenvLoadable } : cuda,
    onnxRuntimeProviders,
    detectedProviders,
    recommendedProvider: pickRecommendedProvider(detectedProviders, {
      tensorRtRtxLoadable: tensorRtRtxVenvLoadable,
      tensorRtLoadable: tensorRtVenvLoadable,
      openvinoLoadable: openvinoVenvAvailable,
      qnnLoadable: qnnVenvLoadable,
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
