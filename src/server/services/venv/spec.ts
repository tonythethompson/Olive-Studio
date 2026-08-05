/**
 * Server-only venv family specifications: roots, ORT distribution, package pins.
 * Client-safe routing policy lives in `src/lib/venvFamily.ts`.
 */
import path from "path";
import type { VenvFamily } from "../../../lib/venvFamily.ts";
import { PINNED_ORT_GPU_VERSION, pinnedOrtGpuInstallArgs } from "../../../lib/oliveGpuRuntime.ts";

export type OrtDistributionName = "onnxruntime" | "onnxruntime-directml" | "onnxruntime-gpu";

export type VenvFamilySpec = {
  family: VenvFamily;
  root: string;
  buildingRoot: string;
  ortDistribution: OrtDistributionName;
  ortVersionSpec?: string;
  /** Pip install args for the canonical ORT wheel (no conflicting flavors). */
  ortInstallArgs: string[];
  /** Pip install args for olive-ai (+ requests) into a fresh family tree. */
  oliveInstallArgs: string[];
  packageConstraints: string[];
  specVersion: number;
};

/** Bump when pins / layout change so ensure triggers an isolated rebuild. */
export const VENV_SPEC_VERSION = 2;

/** Pinned olive-ai range for family builds (avoid floating major). */
export const PINNED_OLIVE_AI_INSTALL = "olive-ai>=0.9.0,<1";

const OLIVE_INSTALL_ARGS = [PINNED_OLIVE_AI_INSTALL, "requests"] as const;

/** Manifest filename written inside each family root. */
export const VENV_MANIFEST_NAME = ".olive-studio-venv.json";

/** Journal path resolved against current cwd (safe under tests that chdir). */
export function getMigrationJournalPath(): string {
  return path.join(process.cwd(), ".olive-studio", "runtime-migration.json");
}

export const ALL_ORT_DISTRIBUTIONS: readonly OrtDistributionName[] = [
  "onnxruntime",
  "onnxruntime-directml",
  "onnxruntime-gpu",
] as const;

function defaultOrtDistribution(): OrtDistributionName {
  return process.platform === "win32" ? "onnxruntime-directml" : "onnxruntime";
}

function defaultOrtInstallArgs(): string[] {
  return [defaultOrtDistribution()];
}

export function getFamilyRoot(family: VenvFamily): string {
  return family === "cuda"
    ? path.join(process.cwd(), ".venvs", "cuda")
    : path.join(process.cwd(), ".venv");
}

export function getFamilyBuildingRoot(family: VenvFamily): string {
  return family === "cuda"
    ? path.join(process.cwd(), ".venvs", "cuda.building")
    : path.join(process.cwd(), ".venv.building");
}

export function getFamilyBackupRoot(family: VenvFamily, stamp = Date.now()): string {
  return family === "cuda"
    ? path.join(process.cwd(), ".venvs", `cuda.backup-${stamp}`)
    : path.join(process.cwd(), `.venv.backup-${stamp}`);
}

export function getLegacyGpuBackupRoot(): string {
  return path.join(process.cwd(), ".venv.legacy-gpu");
}

export function getFamilySpec(family: VenvFamily): VenvFamilySpec {
  if (family === "cuda") {
    return {
      family: "cuda",
      root: getFamilyRoot("cuda"),
      buildingRoot: getFamilyBuildingRoot("cuda"),
      ortDistribution: "onnxruntime-gpu",
      ortVersionSpec: PINNED_ORT_GPU_VERSION,
      ortInstallArgs: pinnedOrtGpuInstallArgs(),
      oliveInstallArgs: [...OLIVE_INSTALL_ARGS],
      packageConstraints: [`onnxruntime-gpu==${PINNED_ORT_GPU_VERSION}`],
      specVersion: VENV_SPEC_VERSION,
    };
  }
  const ort = defaultOrtDistribution();
  return {
    family: "default",
    root: getFamilyRoot("default"),
    buildingRoot: getFamilyBuildingRoot("default"),
    ortDistribution: ort,
    ortInstallArgs: defaultOrtInstallArgs(),
    oliveInstallArgs: [...OLIVE_INSTALL_ARGS],
    packageConstraints: [defaultOrtDistribution()],
    specVersion: VENV_SPEC_VERSION,
  };
}

export type VenvManifest = {
  family: VenvFamily;
  specVersion: number;
  ortDistribution: OrtDistributionName;
  ortVersionSpec?: string;
  createdAt: string;
};

export function conflictingOrtDistributions(canonical: OrtDistributionName): OrtDistributionName[] {
  return ALL_ORT_DISTRIBUTIONS.filter((d) => d !== canonical);
}
