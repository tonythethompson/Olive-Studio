/**
 * Client-safe venv family policy: provider → family routing and queue planning.
 * Filesystem roots, package pins, and validation live in server-only
 * `src/server/services/venv/spec.ts`.
 */
import type { IHVProvider } from "@/types";

export type VenvFamily = "default" | "cuda";

export const VENV_FAMILIES: readonly VenvFamily[] = ["default", "cuda"] as const;

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
  const lower = token.toLowerCase();
  if (lower.includes("nvtensorrtrtx") || lower.includes("tensorrtrtx")) {
    return "NvTensorRTRTXExecutionProvider";
  }
  if (lower.includes("tensorrt") || lower === "trt") return "TensorrtExecutionProvider";
  if (lower.includes("directml") || lower === "dml" || lower.includes("dmlexecution")) {
    return "DmlExecutionProvider";
  }
  if (lower.includes("cuda")) return "CUDAExecutionProvider";
  if (lower.includes("openvino")) return "OpenVINOExecutionProvider";
  if (lower.includes("qnn")) return "QNNExecutionProvider";
  if (lower.includes("rocm")) return "ROCMExecutionProvider";
  if (lower.includes("webgpu")) return "WebGpuExecutionProvider";
  if (lower.includes("cpu")) return "CPUExecutionProvider";
  return null;
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
  };
}

/** Mandatory (non-CPU) family for a provider, or null for CPU / browser-only. */
export function mandatoryFamilyForProvider(provider: IHVProvider): VenvFamily | null {
  switch (provider) {
    case "CUDAExecutionProvider":
    case "TensorrtExecutionProvider":
    case "NvTensorRTRTXExecutionProvider":
      return "cuda";
    case "DmlExecutionProvider":
    case "OpenVINOExecutionProvider":
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
  return ordered;
}

export function humanFamilyLabel(family: VenvFamily): string {
  return family === "cuda" ? "CUDA runtime" : "default runtime";
}

export function humanFamilyRootHint(family: VenvFamily): string {
  return family === "cuda" ? ".venvs/cuda" : ".venv";
}
