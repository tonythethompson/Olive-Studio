import path from "path";
import type { VenvFamily } from "../../../lib/venvFamily.ts";
import { getFamilyRoot } from "./spec.ts";

/** @deprecated Prefer getFamilyRoot("default") — kept for gradual migration. */
export const VENV_DIR = path.join(process.cwd(), ".venv");

/** Path to the Olive GPU launcher script. */
export const OLIVE_GPU_LAUNCHER = path.join(process.cwd(), "scripts", "olive_gpu_launcher.py");

export function getVenvScriptsDir(family: VenvFamily = "default"): string {
  const root = getFamilyRoot(family);
  return process.platform === "win32" ? path.join(root, "Scripts") : path.join(root, "bin");
}

/** Absolute path to python inside a venv root directory. */
export function pythonPathForRoot(root: string): string {
  return process.platform === "win32"
    ? path.join(root, "Scripts", "python.exe")
    : path.join(root, "bin", "python");
}

/** Absolute path to python inside the family venv. */
export function getVenvPython(family: VenvFamily = "default"): string {
  return pythonPathForRoot(getFamilyRoot(family));
}

/**
 * @deprecated Prefer `<python> -m pip`. Kept for transitional call sites.
 */
export function getVenvPip(family: VenvFamily = "default"): string {
  return process.platform === "win32"
    ? path.join(getVenvScriptsDir(family), "pip.exe")
    : path.join(getVenvScriptsDir(family), "pip");
}

/**
 * olive-ai 0.13+ requires Python >=3.10. Official classifiers: 3.10–3.13.
 * 3.12 is recommended for best torch/CUDA wheel compatibility.
 */
export const PYTHON_MIN = { major: 3, minor: 10 };
export const PYTHON_MAX_RECOMMENDED = { major: 3, minor: 13 };
