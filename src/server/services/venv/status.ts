/**
 * Dual-family runtime status: integrity vs per-provider capabilities.
 */
import fs from "fs";
import type { IHVProvider } from "../../../types.ts";
import {
  emptyFamilyFlags,
  type RuntimeFamilyFlags,
  type VenvFamily,
  VENV_FAMILIES,
} from "../../../lib/venvFamily.ts";
import { execFileAsync } from "../shared/exec.ts";
import { getVenvPython } from "./paths.ts";
import { familyPythonExists, readVenvManifest } from "./promote.ts";
import {
  ALL_ORT_DISTRIBUTIONS,
  conflictingOrtDistributions,
  getFamilyRoot,
  getFamilySpec,
  type OrtDistributionName,
  VENV_SPEC_VERSION,
} from "./spec.ts";

export type CapabilityStatus =
  | { usable: true }
  | {
      usable: false;
      reason: "missing" | "broken" | "unsupported" | "probe_failed";
      detail?: string;
    };

export type RuntimeFamilyStatus = {
  family: VenvFamily;
  exists: boolean;
  oliveInstalled: boolean;
  oliveVersion: string | null;
  canonicalOrtInstalled: boolean;
  conflictingOrtDistributions: string[];
  integrityHealthy: boolean;
  needsRepair: boolean;
  python: string | null;
  capabilities: {
    cpu: CapabilityStatus;
    directml?: CapabilityStatus;
    cuda?: CapabilityStatus;
    openvino?: CapabilityStatus;
    tensorrt?: CapabilityStatus;
    tensorrtRtx?: CapabilityStatus;
  };
};

export type DualRuntimeStatus = {
  families: Record<VenvFamily, RuntimeFamilyStatus>;
  systemPython: string | null;
  configuredPython: string | null;
  platform: string;
  venvOnUserPath: boolean;
  hint: string;
};

const STATUS_TTL_MS = 8_000;
let cachedStatus: { at: number; value: DualRuntimeStatus } | null = null;

export function invalidateRuntimeStatusCache(): void {
  cachedStatus = null;
}

const ORT_DIST_PROBE = `
import importlib.metadata as m
names = ["onnxruntime", "onnxruntime-directml", "onnxruntime-gpu", "onnxruntime-openvino"]
found = []
for n in names:
    try:
        m.distribution(n)
        found.append(n)
    except Exception:
        pass
print(",".join(found))
`.trim();

const FAMILY_PROBE = `
import importlib.metadata as m
import json
out = {
  "olive": None,
  "ort_dists": [],
  "providers": [],
  "openvino": None,
  "tensorrt": None,
  "tensorrt_rtx": None,
  "optimum_intel": None,
}
try:
    import olive
    out["olive"] = getattr(olive, "__version__", "unknown")
except Exception:
    pass
for n in ["onnxruntime", "onnxruntime-directml", "onnxruntime-gpu", "onnxruntime-openvino"]:
    try:
        m.distribution(n)
        out["ort_dists"].append(n)
    except Exception:
        pass
try:
    import onnxruntime as ort
    out["providers"] = list(ort.get_available_providers())
except Exception as exc:
    out["ort_error"] = str(exc)
try:
    import openvino
    out["openvino"] = openvino.__version__
except Exception:
    pass
try:
    import optimum.intel
    out["optimum_intel"] = getattr(optimum.intel, "__version__", "unknown")
except Exception:
    pass
try:
    import tensorrt
    out["tensorrt"] = tensorrt.__version__
except Exception:
    pass
try:
    import tensorrt_rtx
    out["tensorrt_rtx"] = getattr(tensorrt_rtx, "__version__", "unknown")
except Exception:
    pass
print(json.dumps(out))
`.trim();

type ProbeJson = {
  olive?: string | null;
  ort_dists?: string[];
  providers?: string[];
  ort_error?: string;
  openvino?: string | null;
  optimum_intel?: string | null;
  tensorrt?: string | null;
  tensorrt_rtx?: string | null;
};

function missing(detail?: string): CapabilityStatus {
  return { usable: false, reason: "missing", detail };
}
function broken(detail?: string): CapabilityStatus {
  return { usable: false, reason: "broken", detail };
}
function unsupported(detail?: string): CapabilityStatus {
  return { usable: false, reason: "unsupported", detail };
}
function usable(): CapabilityStatus {
  return { usable: true };
}

async function probeFamilyPython(python: string): Promise<ProbeJson | null> {
  try {
    const { stdout } = await execFileAsync(python, ["-c", FAMILY_PROBE], { timeout: 45_000 });
    return JSON.parse(stdout.trim()) as ProbeJson;
  } catch {
    return null;
  }
}

export async function listInstalledOrtDistributions(python: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(python, ["-c", ORT_DIST_PROBE], { timeout: 20_000 });
    return stdout
      .trim()
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function buildCapabilities(
  family: VenvFamily,
  probe: ProbeJson | null,
): RuntimeFamilyStatus["capabilities"] {
  const providers = new Set(probe?.providers ?? []);
  const hasOrt = (probe?.ort_dists?.length ?? 0) > 0 && !probe?.ort_error;

  const cpu: CapabilityStatus = !probe
    ? missing("family not probed")
    : !hasOrt
      ? missing("onnxruntime not installed")
      : providers.has("CPUExecutionProvider")
        ? usable()
        : broken("CPUExecutionProvider missing from ORT providers");

  const caps: RuntimeFamilyStatus["capabilities"] = { cpu };

  if (family === "default") {
    if (process.platform !== "win32") {
      caps.directml = unsupported("DirectML requires Windows");
    } else if (!probe?.ort_dists?.includes("onnxruntime-directml")) {
      caps.directml = missing("onnxruntime-directml not installed");
    } else if (providers.has("DmlExecutionProvider")) {
      caps.directml = usable();
    } else {
      caps.directml = broken("DmlExecutionProvider absent despite onnxruntime-directml");
    }

    caps.openvino = unsupported(
      "OpenVINO uses the isolated OpenVINO runtime (.venvs/openvino), not the default runtime",
    );
  }

  if (family === "openvino") {
    if (!probe?.ort_dists?.includes("onnxruntime-openvino")) {
      caps.openvino = missing("onnxruntime-openvino not installed");
    } else if (!providers.has("OpenVINOExecutionProvider")) {
      caps.openvino = broken("OpenVINOExecutionProvider absent despite onnxruntime-openvino");
    } else if (probe?.openvino && probe?.optimum_intel) {
      caps.openvino = usable();
    } else if (!probe?.openvino) {
      caps.openvino = missing("openvino Python package not installed");
    } else {
      caps.openvino = missing("openvino installed but optimum-intel bridge missing");
    }
  }

  if (family === "cuda") {
    if (!probe?.ort_dists?.includes("onnxruntime-gpu")) {
      caps.cuda = missing("onnxruntime-gpu not installed");
    } else if (providers.has("CUDAExecutionProvider")) {
      caps.cuda = usable();
    } else {
      caps.cuda = broken("CUDAExecutionProvider absent despite onnxruntime-gpu");
    }

    if (probe?.tensorrt) {
      caps.tensorrt = providers.has("TensorrtExecutionProvider")
        ? usable()
        : broken("tensorrt installed but TensorrtExecutionProvider not loadable");
    } else {
      caps.tensorrt = missing("tensorrt SDK not installed");
    }

    if (probe?.tensorrt_rtx) {
      caps.tensorrtRtx = providers.has("NvTensorRTRTXExecutionProvider")
        ? usable()
        : broken("tensorrt-rtx present but NvTensorRTRTXExecutionProvider not registered");
    } else {
      caps.tensorrtRtx = missing("tensorrt-rtx / EP-ABI plugin not installed");
    }
  }

  return caps;
}

export async function probeFamilyStatus(family: VenvFamily): Promise<RuntimeFamilyStatus> {
  const spec = getFamilySpec(family);
  const root = getFamilyRoot(family);
  const exists = familyPythonExists(family);
  const python = exists ? getVenvPython(family) : null;
  const manifest = exists ? readVenvManifest(root) : null;

  if (!exists || !python) {
    return {
      family,
      exists: false,
      oliveInstalled: false,
      oliveVersion: null,
      canonicalOrtInstalled: false,
      conflictingOrtDistributions: [],
      integrityHealthy: false,
      needsRepair: false,
      python: null,
      capabilities: {
        cpu: missing("venv missing"),
        ...(family === "default"
          ? {
              directml:
                process.platform === "win32"
                  ? missing("venv missing")
                  : unsupported("DirectML requires Windows"),
              openvino: unsupported(
                "OpenVINO uses the isolated OpenVINO runtime (.venvs/openvino)",
              ),
            }
          : family === "openvino"
            ? {
                openvino: missing("venv missing"),
              }
            : {
                cuda: missing("venv missing"),
                tensorrt: missing("venv missing"),
                tensorrtRtx: missing("venv missing"),
              }),
      },
    };
  }

  const probe = await probeFamilyPython(python);
  const ortDists = (probe?.ort_dists ?? []).filter((d): d is OrtDistributionName =>
    (ALL_ORT_DISTRIBUTIONS as readonly string[]).includes(d),
  );
  const conflicting = ortDists.filter((d) =>
    conflictingOrtDistributions(spec.ortDistribution).includes(d),
  );
  const canonicalOrtInstalled = ortDists.includes(spec.ortDistribution);
  const oliveInstalled = Boolean(probe?.olive);
  const staleSpec = manifest != null && manifest.specVersion !== VENV_SPEC_VERSION;
  const needsRepair =
    conflicting.length > 0 || !canonicalOrtInstalled || !oliveInstalled || staleSpec || !manifest;
  const integrityHealthy =
    oliveInstalled && canonicalOrtInstalled && conflicting.length === 0 && !staleSpec && Boolean(manifest);

  return {
    family,
    exists: true,
    oliveInstalled,
    oliveVersion: probe?.olive ?? null,
    canonicalOrtInstalled,
    conflictingOrtDistributions: conflicting,
    integrityHealthy,
    needsRepair,
    python,
    capabilities: buildCapabilities(family, probe),
  };
}

export function familyFlagsFromStatus(
  families: Record<VenvFamily, RuntimeFamilyStatus>,
): RuntimeFamilyFlags {
  const flags = emptyFamilyFlags();
  for (const family of VENV_FAMILIES) {
    const st = families[family];
    flags[family] = {
      prepared: st.exists && st.oliveInstalled && st.canonicalOrtInstalled,
      cpuUsable: st.capabilities.cpu.usable === true,
    };
  }
  return flags;
}

export async function getDualRuntimeStatus(opts?: {
  force?: boolean;
  systemPython?: string | null;
  configuredPython?: string | null;
  venvOnUserPath?: boolean;
}): Promise<DualRuntimeStatus> {
  if (!opts?.force && cachedStatus && Date.now() - cachedStatus.at < STATUS_TTL_MS) {
    return cachedStatus.value;
  }

  const familyStatuses = await Promise.all(VENV_FAMILIES.map((family) => probeFamilyStatus(family)));
  const families = Object.fromEntries(
    VENV_FAMILIES.map((family, i) => [family, familyStatuses[i]!]),
  ) as Record<VenvFamily, RuntimeFamilyStatus>;

  const defaultOk = families.default.integrityHealthy;
  const cudaOk = families.cuda.integrityHealthy;
  const openvinoOk = families.openvino.integrityHealthy;
  const hint = !opts?.systemPython
    ? "No system Python found. Need 3.10–3.13 (3.12 recommended). Set python.exe below or OLIVE_STUDIO_PYTHON."
    : !families.default.exists
      ? "Default runtime (.venv) missing — Install Olive venv now, or first Execute Live will create it."
      : !defaultOk
        ? "Default runtime needs repair (Open Olive runtime / Install Olive venv)."
        : cudaOk && openvinoOk
          ? "Default, CUDA, and OpenVINO runtimes ready."
          : cudaOk
            ? "Default and CUDA runtimes ready. OpenVINO runtime (.venvs/openvino) is created on first OpenVINO job."
            : openvinoOk
              ? "Default and OpenVINO runtimes ready. CUDA runtime will be created on first CUDA/TensorRT job."
              : "Default runtime ready. CUDA and OpenVINO runtimes are created on first use.";

  const value: DualRuntimeStatus = {
    families,
    systemPython: opts?.systemPython ?? null,
    configuredPython: opts?.configuredPython ?? null,
    platform: process.platform,
    venvOnUserPath: opts?.venvOnUserPath ?? false,
    hint,
  };
  cachedStatus = { at: Date.now(), value };
  return value;
}

/** Map IHV provider to capability slot on a family status. */
export function capabilityForProvider(
  status: RuntimeFamilyStatus,
  provider: IHVProvider,
): CapabilityStatus | undefined {
  switch (provider) {
    case "CPUExecutionProvider":
      return status.capabilities.cpu;
    case "DmlExecutionProvider":
      return status.capabilities.directml;
    case "CUDAExecutionProvider":
      return status.capabilities.cuda;
    case "OpenVINOExecutionProvider":
      return status.capabilities.openvino;
    case "TensorrtExecutionProvider":
      return status.capabilities.tensorrt;
    case "NvTensorRTRTXExecutionProvider":
      return status.capabilities.tensorrtRtx;
    case "QNNExecutionProvider":
    case "ROCMExecutionProvider":
    case "WebGpuExecutionProvider":
      return undefined;
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}

export function fsExistsSync(p: string): boolean {
  return fs.existsSync(p);
}
