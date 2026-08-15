/**
 * GenAI sidecar venv management.
 *
 * Manages a dedicated Python virtual environment for the ONNX Runtime GenAI
 * inference sidecar. Separate from the Olive venv families to avoid dependency
 * conflicts (GenAI has its own ORT build bundled).
 *
 * Venv location: .venvs/genai/ (relative to project root)
 */

import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ─── Paths ────────────────────────────────────────────────────────────────────

const GENAI_VENV_DIR = path.join(process.cwd(), ".venvs", "genai");

/** Python executable inside the GenAI venv. */
export function genaiPythonPath(): string {
  return process.platform === "win32"
    ? path.join(GENAI_VENV_DIR, "Scripts", "python.exe")
    : path.join(GENAI_VENV_DIR, "bin", "python");
}

/** Whether the GenAI venv exists and has python. */
export function isGenaiVenvReady(): boolean {
  return fs.existsSync(genaiPythonPath());
}

/** Path to the inference sidecar script. */
export function sidecarScriptPath(): string {
  return path.join(__dirname, "inference_sidecar.py");
}

// ─── Venv Setup ───────────────────────────────────────────────────────────────

export type SetupListener = (line: string) => void;

/**
 * Finds a suitable system Python (>=3.10) for creating the venv.
 * Checks python3, python, py -3 in that order.
 */
async function findSystemPython(): Promise<string | null> {
  const candidates: Array<[string, string[]]> =
    process.platform === "win32"
      ? [["py", ["-3", "--version"]], ["python", ["--version"]]]
      : [["python3", ["--version"]], ["python", ["--version"]]];

  for (const [cmd, args] of candidates) {
    try {
      const { stdout } = await execFileAsync(cmd, args, { timeout: 10_000 });
      const match = stdout.match(/Python (\d+)\.(\d+)/);
      if (match) {
        const major = parseInt(match[1], 10);
        const minor = parseInt(match[2], 10);
        if (major === 3 && minor >= 10) {
          return process.platform === "win32" && cmd === "py" ? "py" : cmd;
        }
      }
    } catch {
      // Not found or wrong version
    }
  }
  return null;
}

/**
 * Ensures the GenAI venv is set up with onnxruntime-genai installed.
 * Idempotent — skips if already ready.
 *
 * @param onLine - Progress callback for UI streaming.
 * @returns Success/failure result.
 */
export async function ensureGenaiVenv(
  onLine: SetupListener,
): Promise<{ ok: boolean; error?: string }> {
  if (isGenaiVenvReady()) {
    // Quick check: is onnxruntime-genai importable?
    try {
      await execFileAsync(genaiPythonPath(), ["-c", "import onnxruntime_genai"], { timeout: 15_000 });
      onLine("[genai] Venv ready, onnxruntime-genai available.");
      return { ok: true };
    } catch {
      onLine("[genai] Venv exists but onnxruntime-genai missing. Reinstalling...");
    }
  }

  // Find system Python
  onLine("[genai] Locating Python >=3.10...");
  const systemPython = await findSystemPython();
  if (!systemPython) {
    return { ok: false, error: "Python >=3.10 not found. Install Python 3.10+ and ensure it's on PATH." };
  }
  onLine(`[genai] Found: ${systemPython}`);

  // Create venv
  onLine("[genai] Creating virtual environment...");
  try {
    fs.mkdirSync(path.dirname(GENAI_VENV_DIR), { recursive: true });

    const venvArgs =
      process.platform === "win32" && systemPython === "py"
        ? ["-3", "-m", "venv", GENAI_VENV_DIR]
        : ["-m", "venv", GENAI_VENV_DIR];

    await execFileAsync(systemPython, venvArgs, { timeout: 60_000 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to create venv: ${msg}` };
  }

  if (!fs.existsSync(genaiPythonPath())) {
    return { ok: false, error: "Venv creation succeeded but python not found at expected path." };
  }
  onLine("[genai] Venv created.");

  // Install onnxruntime-genai
  onLine("[genai] Installing onnxruntime-genai (this may take a minute)...");
  try {
    const installResult = await execFileAsync(
      genaiPythonPath(),
      ["-m", "pip", "install", "--no-cache-dir", "onnxruntime-genai"],
      { timeout: 300_000 }, // 5 minutes for large wheels
    );
    if (installResult.stderr && installResult.stderr.includes("ERROR")) {
      onLine(`[genai] pip warnings: ${installResult.stderr.slice(0, 200)}`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to install onnxruntime-genai: ${msg}` };
  }

  // Verify import
  try {
    await execFileAsync(genaiPythonPath(), ["-c", "import onnxruntime_genai; print('ok')"], {
      timeout: 15_000,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `onnxruntime-genai installed but import failed: ${msg}` };
  }

  onLine("[genai] Setup complete. onnxruntime-genai ready.");
  return { ok: true };
}

// ─── Sidecar Process Management ──────────────────────────────────────────────

export interface SidecarProcess {
  /** Send a JSON request to the sidecar. */
  send: (request: Record<string, unknown>) => void;
  /** Register a handler for NDJSON responses. */
  onResponse: (handler: (data: Record<string, unknown>) => void) => void;
  /** Kill the sidecar process. */
  kill: () => void;
  /** Whether the process is still alive. */
  alive: () => boolean;
}

let activeSidecar: SidecarProcess | null = null;

/**
 * Spawns the GenAI inference sidecar as a long-running child process.
 * Reuses the existing process if it's still alive.
 *
 * @param modelPath - Absolute path to the ONNX model directory.
 * @param ep - Execution provider: "cpu", "cuda", or "dml".
 */
export function spawnSidecar(modelPath: string, ep: string = "cpu"): SidecarProcess {
  if (activeSidecar?.alive()) return activeSidecar;

  const pythonExe = genaiPythonPath();
  const scriptPath = sidecarScriptPath();

  const child = spawn(pythonExe, [scriptPath], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      GENAI_MODEL_PATH: modelPath,
      GENAI_EXECUTION_PROVIDER: ep,
    },
  });

  const responseHandlers: Array<(data: Record<string, unknown>) => void> = [];
  let buffer = "";

  child.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line) as Record<string, unknown>;
        for (const handler of responseHandlers) handler(data);
      } catch {
        // Non-JSON output (shouldn't happen, but don't crash)
        console.warn("[genai-sidecar] Non-JSON stdout:", line.slice(0, 100));
      }
    }
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) console.warn("[genai-sidecar] stderr:", text.slice(0, 300));
  });

  child.on("exit", (code) => {
    if (activeSidecar === sidecar) activeSidecar = null;
    if (code !== 0 && code !== null) {
      console.warn(`[genai-sidecar] Process exited with code ${code}`);
    }
  });

  const sidecar: SidecarProcess = {
    send: (request) => {
      if (child.stdin?.writable) {
        child.stdin.write(JSON.stringify(request) + "\n");
      }
    },
    onResponse: (handler) => {
      responseHandlers.push(handler);
    },
    kill: () => {
      try {
        sidecar.send({ command: "shutdown" });
      } catch { /* ignore */ }
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGTERM");
      }, 2000);
    },
    alive: () => child.exitCode === null && !child.killed,
  };

  activeSidecar = sidecar;
  return sidecar;
}

/** Get the active sidecar if it's running. */
export function getActiveSidecar(): SidecarProcess | null {
  if (activeSidecar?.alive()) return activeSidecar;
  activeSidecar = null;
  return null;
}

/** Shutdown the active sidecar cleanly. */
export function shutdownSidecar(): void {
  activeSidecar?.kill();
  activeSidecar = null;
}
