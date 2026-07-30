import path from "path";

/** Path to the project's Python virtual environment. */
export const VENV_DIR = path.join(process.cwd(), ".venv");

/** Path to the Olive GPU launcher script. */
export const OLIVE_GPU_LAUNCHER = path.join(process.cwd(), "scripts", "olive_gpu_launcher.py");

/** Returns the path to python inside the venv. */
export function getVenvPython(): string {
  return process.platform === "win32"
    ? path.join(VENV_DIR, "Scripts", "python.exe")
    : path.join(VENV_DIR, "bin", "python");
}

export function getVenvScriptsDir(): string {
  return process.platform === "win32" ? path.join(VENV_DIR, "Scripts") : path.join(VENV_DIR, "bin");
}

export function getVenvPip(): string {
  return process.platform === "win32"
    ? path.join(VENV_DIR, "Scripts", "pip.exe")
    : path.join(VENV_DIR, "bin", "pip");
}

/**
 * olive-ai 0.13+ requires Python >=3.10. Official classifiers: 3.10–3.13.
 * 3.12 is recommended for best torch/CUDA wheel compatibility.
 */
export const PYTHON_MIN = { major: 3, minor: 10 };
export const PYTHON_MAX_RECOMMENDED = { major: 3, minor: 13 };
