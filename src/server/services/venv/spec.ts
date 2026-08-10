/**
 * Server-only venv family specifications: roots, ORT distribution, package pins.
 * Client-safe routing policy lives in `src/lib/venvFamily.ts`.
 */
import path from "path";
import type { VenvFamily } from "../../../lib/venvFamily.ts";
import { PINNED_ORT_GPU_VERSION, pinnedOrtGpuInstallArgs } from "../../../lib/oliveGpuRuntime.ts";
import {
  ONNXRUNTIME_OPENVINO_PIP_PACKAGE,
  PINNED_ONNXRUNTIME_OPENVINO_VERSION,
  openvinoOrtInstallArgs,
  openvinoPackageConstraints,
} from "../../../lib/openvinoDeps.ts";
import {
  ONNXRUNTIME_QNN_FAMILY_ORT_PACKAGE,
  PINNED_ONNXRUNTIME_QNN_FAMILY_ORT_VERSION,
  PINNED_ONNXRUNTIME_QNN_PLUGIN_VERSION,
  qnnOrtInstallArgs,
  qnnPackageConstraints,
  qnnSupplementalConstraints,
  qnnSupplementalInstallArgs,
} from "../../../lib/qnnDeps.ts";

export type OrtDistributionName =
  | "onnxruntime"
  | "onnxruntime-directml"
  | "onnxruntime-gpu"
  | "onnxruntime-openvino";

/**
 * Plugin / support packages that live beside canonical ORT and must not be
 * treated as mutually exclusive ORT distributions (e.g. onnxruntime-qnn 2.x).
 */
export const ORT_PLUGIN_PACKAGE_NAMES = ["onnxruntime-qnn"] as const;

export type VenvFamilySpec = {
  family: VenvFamily;
  root: string;
  buildingRoot: string;
  ortDistribution: OrtDistributionName;
  ortVersionSpec?: string;
  /** Pip install args for the canonical ORT wheel (no conflicting flavors). */
  ortInstallArgs: string[];
  /**
   * Additional family-owned packages installed after canonical ORT
   * (plugins, bridges, pinned NumPy, etc.).
   */
  supplementalInstallArgs?: string[];
  /** Extra pip constraint lines for supplemental packages (merged into constraints). */
  supplementalConstraints?: string[];
  /** Pip install args for olive-ai (+ requests) into a fresh family tree. */
  oliveInstallArgs: string[];
  packageConstraints: string[];
  specVersion: number;
};

/** Bump when pins / layout change so ensure triggers an isolated rebuild. */
export const VENV_SPEC_VERSION = 5;

/** Pinned olive-ai range for family builds (avoid floating major). */
export const PINNED_OLIVE_AI_INSTALL = "olive-ai==0.13.0";

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
  "onnxruntime-openvino",
] as const;

function defaultOrtDistribution(): OrtDistributionName {
  return process.platform === "win32" ? "onnxruntime-directml" : "onnxruntime";
}

function defaultOrtInstallArgs(): string[] {
  return [defaultOrtDistribution()];
}

export function getFamilyRoot(family: VenvFamily): string {
  switch (family) {
    case "cuda":
      return path.join(process.cwd(), ".venvs", "cuda");
    case "openvino":
      return path.join(process.cwd(), ".venvs", "openvino");
    case "qnn":
      return path.join(process.cwd(), ".venvs", "qnn");
    case "default":
      return path.join(process.cwd(), ".venv");
    default: {
      const _exhaustive: never = family;
      return _exhaustive;
    }
  }
}

export function getFamilyBuildingRoot(family: VenvFamily): string {
  switch (family) {
    case "cuda":
      return path.join(process.cwd(), ".venvs", "cuda.building");
    case "openvino":
      return path.join(process.cwd(), ".venvs", "openvino.building");
    case "qnn":
      return path.join(process.cwd(), ".venvs", "qnn.building");
    case "default":
      return path.join(process.cwd(), ".venv.building");
    default: {
      const _exhaustive: never = family;
      return _exhaustive;
    }
  }
}

export function getFamilyBackupRoot(family: VenvFamily, stamp = Date.now()): string {
  switch (family) {
    case "cuda":
      return path.join(process.cwd(), ".venvs", `cuda.backup-${stamp}`);
    case "openvino":
      return path.join(process.cwd(), ".venvs", `openvino.backup-${stamp}`);
    case "qnn":
      return path.join(process.cwd(), ".venvs", `qnn.backup-${stamp}`);
    case "default":
      return path.join(process.cwd(), `.venv.backup-${stamp}`);
    default: {
      const _exhaustive: never = family;
      return _exhaustive;
    }
  }
}

export function getLegacyGpuBackupRoot(): string {
  return path.join(process.cwd(), ".venv.legacy-gpu");
}

export function getFamilySpec(family: VenvFamily): VenvFamilySpec {
  switch (family) {
    case "cuda":
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
    case "openvino":
      return {
        family: "openvino",
        root: getFamilyRoot("openvino"),
        buildingRoot: getFamilyBuildingRoot("openvino"),
        ortDistribution: ONNXRUNTIME_OPENVINO_PIP_PACKAGE,
        ortVersionSpec: PINNED_ONNXRUNTIME_OPENVINO_VERSION,
        ortInstallArgs: openvinoOrtInstallArgs(),
        oliveInstallArgs: [...OLIVE_INSTALL_ARGS],
        packageConstraints: openvinoPackageConstraints(),
        specVersion: VENV_SPEC_VERSION,
      };
    case "qnn":
      return {
        family: "qnn",
        root: getFamilyRoot("qnn"),
        buildingRoot: getFamilyBuildingRoot("qnn"),
        ortDistribution: ONNXRUNTIME_QNN_FAMILY_ORT_PACKAGE,
        ortVersionSpec: PINNED_ONNXRUNTIME_QNN_FAMILY_ORT_VERSION,
        ortInstallArgs: qnnOrtInstallArgs(),
        supplementalInstallArgs: qnnSupplementalInstallArgs(),
        supplementalConstraints: qnnSupplementalConstraints(),
        oliveInstallArgs: [...OLIVE_INSTALL_ARGS],
        packageConstraints: qnnPackageConstraints(),
        specVersion: VENV_SPEC_VERSION,
      };
    case "default": {
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
    default: {
      const _exhaustive: never = family;
      return _exhaustive;
    }
  }
}

export type VenvManifest = {
  family: VenvFamily;
  specVersion: number;
  ortDistribution: OrtDistributionName;
  ortVersionSpec?: string;
  createdAt: string;
  packages?: {
    onnxruntime?: string;
    onnxruntimeQnn?: string;
    numpy?: string;
  };
};

/** Exported for tests / ensure logs. */
export const QNN_FAMILY_PLUGIN_VERSION = PINNED_ONNXRUNTIME_QNN_PLUGIN_VERSION;

export function conflictingOrtDistributions(canonical: OrtDistributionName): OrtDistributionName[] {
  return ALL_ORT_DISTRIBUTIONS.filter((d) => d !== canonical);
}
