/**
 * Client-safe venv family policy: provider → family routing and queue planning.
 * Filesystem roots, package pins, and validation live in server-only
 * `src/server/services/venv/spec.ts`.
 */
import type { IHVProvider } from "@/types";

export type VenvFamily = "default" | "cuda" | "openvino";

export const VENV_FAMILIES: readonly VenvFamily[] = ["default", "cuda", "openvino"] as const;

/** Known Olive Studio execution-provider IDs (exhaustive). */
export const KNOWN_IHV_PROVIDERS: readonly IHVProvider[] = [
  "CPUExecutionProvider",
  "CUDAExecutionProvider",
  "TensorrtExecutionProvider",
  "NvTensorRTRTXExecutionProvider",
  "DmlExecutionProvider",
  "OpenVINOExecutionProvider",
  "QNNExecutionProvider",
  "ROCMExecutionProvider",
  "WebGpuExecutionProvider",
] as const;

const KNOWN_SET = new Set<string>(KNOWN_IHV_PROVIDERS);

/**
 * Exact case-insensitive aliases (documented short names + lowercased canonical IDs).
 * Substring matching is intentionally rejected (`fake-cuda`, `openvino-custom`, etc.).
 */
const PROVIDER_ALIASES: ReadonlyMap<string, IHVProvider> = new Map([
  ["cpuexecutionprovider", "CPUExecutionProvider"],
  ["cudaexecutionprovider", "CUDAExecutionProvider"],
  ["tensorrtexecutionprovider", "TensorrtExecutionProvider"],
  ["nvtensorrtrtxexecutionprovider", "NvTensorRTRTXExecutionProvider"],
  ["dmlexecutionprovider", "DmlExecutionProvider"],
  ["openvinoexecutionprovider", "OpenVINOExecutionProvider"],
  ["qnnexecutionprovider", "QNNExecutionProvider"],
  ["rocmexecutionprovider", "ROCMExecutionProvider"],
  ["webgpuexecutionprovider", "WebGpuExecutionProvider"],
  ["cpu", "CPUExecutionProvider"],
  ["cuda", "CUDAExecutionProvider"],
  ["tensorrt", "TensorrtExecutionProvider"],
  ["trt", "TensorrtExecutionProvider"],
  ["nvtensorrtrtx", "NvTensorRTRTXExecutionProvider"],
  ["tensorrtrtx", "NvTensorRTRTXExecutionProvider"],
  ["dml", "DmlExecutionProvider"],
  ["directml", "DmlExecutionProvider"],
  ["openvino", "OpenVINOExecutionProvider"],
  ["qnn", "QNNExecutionProvider"],
  ["rocm", "ROCMExecutionProvider"],
  ["webgpu", "WebGpuExecutionProvider"],
]);

export function isKnownIhvProvider(id: string): id is IHVProvider {
  return KNOWN_SET.has(id);
}

/**
 * Normalize a provider token from recipes / API bodies.
 * Returns null for unknown IDs (callers must reject at API boundary).
 */
export function normalizeIhvProvider(raw: unknown): IHVProvider | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const token = raw.trim();
  if (isKnownIhvProvider(token)) return token;
  return PROVIDER_ALIASES.get(token.toLowerCase()) ?? null;
}

/** Capability keys used for ready-reuse / preflight (subset of RuntimeFamilyStatus). */
export type FamilyCapabilityFlags = {
  cpuUsable: boolean;
  /** Family integrity is healthy enough to be considered prepared. */
  prepared: boolean;
};

export type RuntimeFamilyFlags = Record<VenvFamily, FamilyCapabilityFlags>;

export function emptyFamilyFlags(): RuntimeFamilyFlags {
  return {
    default: { cpuUsable: false, prepared: false },
    cuda: { cpuUsable: false, prepared: false },
    openvino: { cpuUsable: false, prepared: false },
  };
}

/** Mandatory (non-CPU) family for a provider, or null for CPU / browser-only. */
export function mandatoryFamilyForProvider(provider: IHVProvider): VenvFamily | null {
  switch (provider) {
    case "CUDAExecutionProvider":
    case "TensorrtExecutionProvider":
    case "NvTensorRTRTXExecutionProvider":
      return "cuda";
    case "OpenVINOExecutionProvider":
      return "openvino";
    case "DmlExecutionProvider":
    case "QNNExecutionProvider":
    case "ROCMExecutionProvider":
      return "default";
    case "CPUExecutionProvider":
    case "WebGpuExecutionProvider":
      return null;
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}

/**
 * Single-job family resolution with ready-environment reuse for CPU.
 * Deterministic; no lastUsed / process affinity.
 */
export function resolveVenvFamily(
  provider: IHVProvider,
  flags: RuntimeFamilyFlags = emptyFamilyFlags(),
): VenvFamily {
  const mandatory = mandatoryFamilyForProvider(provider);
  if (mandatory) return mandatory;

  if (provider === "WebGpuExecutionProvider") return "default";

  // CPU: prefer default if CPU-usable; else cuda if CPU-usable; else default (will create).
  // Do not place CPU jobs on the openvino family.
  if (flags.default.cpuUsable) return "default";
  if (flags.cuda.cpuUsable) return "cuda";
  return "default";
}

/**
 * Initial queue planner for batch preflight. Does not apply the single-job
 * CPU matrix independently per provider (that over-creates envs).
 * Post-ensure CPU capability verification may still add default later.
 */
export function resolveRequiredFamilies(
  providers: IHVProvider[],
  flags: RuntimeFamilyFlags = emptyFamilyFlags(),
): VenvFamily[] {
  const unique = Array.from(new Set(providers));
  const families = new Set<VenvFamily>();
  let hasCpu = false;

  for (const provider of unique) {
    if (provider === "CPUExecutionProvider") {
      hasCpu = true;
      continue;
    }
    if (provider === "WebGpuExecutionProvider") continue;
    const mandatory = mandatoryFamilyForProvider(provider);
    if (mandatory) families.add(mandatory);
  }

  if (hasCpu) {
    if (flags.default.cpuUsable) {
      families.add("default");
    } else if (flags.cuda.cpuUsable) {
      families.add("cuda");
    } else if (families.size > 0) {
      // Provisionally reuse a family this preflight will create for a non-CPU provider.
      // Prefer cuda if present (CPU+CUDA → cuda only), else any mandatory family.
      if (families.has("cuda")) {
        /* keep cuda only for CPU placement */
      } else {
        families.add("default");
      }
    } else {
      families.add("default");
    }
  }

  const ordered: VenvFamily[] = [];
  if (families.has("default")) ordered.push("default");
  if (families.has("cuda")) ordered.push("cuda");
  if (families.has("openvino")) ordered.push("openvino");
  return ordered;
}

export function humanFamilyLabel(family: VenvFamily): string {
  switch (family) {
    case "cuda":
      return "CUDA runtime";
    case "openvino":
      return "OpenVINO runtime";
    case "default":
      return "default runtime";
    default: {
      const _exhaustive: never = family;
      return _exhaustive;
    }
  }
}

export function humanFamilyRootHint(family: VenvFamily): string {
  switch (family) {
    case "cuda":
      return ".venvs/cuda";
    case "openvino":
      return ".venvs/openvino";
    case "default":
      return ".venv";
    default: {
      const _exhaustive: never = family;
      return _exhaustive;
    }
  }
}
