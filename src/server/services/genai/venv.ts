/**
 * GenAI sidecar venv management.
 *
 * Manages a dedicated Python virtual environment for the ONNX Runtime GenAI
 * inference sidecar. Separate from the Olive venv families to avoid dependency
 * conflicts (GenAI has its own ORT build bundled).
 *
 * Venv location: .venvs/genai/ under the project root in dev, or under the
 * per-user writable root in packaged apps (the installed resource directory
 * is read-only).
 */

import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { isPackagedApp, writableRoot } from "../shared/runtimePaths.ts";

const execFileAsync = promisify(execFile);

// ─── Paths ────────────────────────────────────────────────────────────────────

/** Resolved lazily so env-based packaged-app detection is always current. */
function genaiVenvDir(): string {
  const root = isPackagedApp() ? writableRoot() : process.cwd();
  return path.join(root, ".venvs", "genai");
}

/** Python executable inside the GenAI venv. */
export function genaiPythonPath(): string {
  return process.platform === "win32"
    ? path.join(genaiVenvDir(), "Scripts", "python.exe")
    : path.join(genaiVenvDir(), "bin", "python");
}

/** Whether the GenAI venv exists and has python. */
export function isGenaiVenvReady(): boolean {
  return fs.existsSync(genaiPythonPath());
}

/** Path to the inference sidecar script. */
export function sidecarScriptPath(): string {
  const bundled = fileURLToPath(new URL("./inference_sidecar.py", import.meta.url));
  if (fs.existsSync(bundled)) return bundled;
  // Packaged builds: the Tauri shell exports OLIVE_DIST_DIR pointing at the
  // resource dist directory, where copy-genai-sidecar places the script.
  const distDir = process.env.OLIVE_DIST_DIR;
  if (distDir) {
    const resource = path.join(distDir, "inference_sidecar.py");
    if (fs.existsSync(resource)) return resource;
  }
  return bundled;
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
      ? [
          ["py", ["-3", "--version"]],
          ["python", ["--version"]],
        ]
      : [
          ["python3", ["--version"]],
          ["python", ["--version"]],
        ];

  for (const [cmd, args] of candidates) {
    try {
      const { stdout, stderr } = await execFileAsync(cmd, args, { timeout: 10_000 });
      const versionText = (stdout || stderr).trim();
      const match = versionText.match(/Python (\d+)\.(\d+)/);
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
export async function ensureGenaiVenv(onLine: SetupListener): Promise<{ ok: boolean; error?: string }> {
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
    const venvDir = genaiVenvDir();
    fs.mkdirSync(path.dirname(venvDir), { recursive: true });

    const venvArgs =
      process.platform === "win32" && systemPython === "py"
        ? ["-3", "-m", "venv", venvDir]
        : ["-m", "venv", venvDir];

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
      // pip progress output can exceed execFile's 1 MiB default buffer, which
      // would fail the call even when the install itself succeeded.
      { timeout: 300_000, maxBuffer: 16 * 1024 * 1024 }, // 5 minutes for large wheels
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
  onResponse: (handler: (data: Record<string, unknown>) => void) => () => void;
  /**
   * Register a settler that rejects an in-flight request if the process dies
   * or is replaced before responding. Returns an unregister function.
   */
  onTerminate: (settle: () => void) => () => void;
  /** Settle all in-flight requests immediately (replacement/shutdown). */
  settlePending: () => void;
  /** Kill the sidecar process. */
  kill: () => void;
  /** Whether the process is still alive. */
  alive: () => boolean;
  /** Resolves with the exit code once the child process has exited. */
  exitPromise: Promise<number | null>;
}

let activeSidecar: SidecarProcess | null = null;
// Track which model/EP the active sidecar was started for. A request for a
// different model or EP must restart the sidecar instead of reusing it.
let activeSidecarKey: string | null = null;

/**
 * Spawns the GenAI inference sidecar as a long-running child process.
 * Reuses the existing process if it's still alive AND matches the requested
 * model and execution provider.
 *
 * @param modelPath - Absolute path to the ONNX model directory.
 * @param ep - Execution provider: "cpu", "cuda", or "dml".
 */
export function spawnSidecar(modelPath: string, ep: string = "cpu"): SidecarProcess {
  const key = `${modelPath}\u0000${ep}`;
  if (activeSidecar?.alive() && activeSidecarKey === key) return activeSidecar;
  // Stale sidecar for a different model/EP — settle its in-flight requests
  // (they would otherwise wait for their timeout) before replacing it.
  if (activeSidecar?.alive()) {
    activeSidecar.settlePending();
    activeSidecar.kill();
  }
  activeSidecar = null;
  activeSidecarKey = null;

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

  // Lets shutdownSidecar await actual process exit instead of racing it.
  const exitPromise = new Promise<number | null>((resolve) => {
    child.once("exit", (code) => resolve(code));
  });

  const responseHandlers: Array<(data: Record<string, unknown>) => void> = [];
  // Settlers for requests that are waiting on this process. Invoked when the
  // process dies or is replaced so callers reject instead of timing out.
  const pendingSettlers = new Set<() => void>();
  const settlePending = (): void => {
    const settlers = [...pendingSettlers];
    pendingSettlers.clear();
    for (const settle of settlers) {
      try {
        settle();
      } catch {
        /* a failing settler must not block teardown */
      }
    }
  };
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

  // spawn emits 'error' (not 'exit') when the executable is missing, e.g. the
  // venv python was deleted after isGenaiVenvReady() passed. Without a handler
  // that would crash the whole server.
  child.on("error", (err) => {
    console.warn("[genai-sidecar] spawn error:", err.message);
    settlePending();
    if (activeSidecar === sidecar) {
      activeSidecar = null;
      activeSidecarKey = null;
    }
  });

  child.on("exit", (code) => {
    settlePending();
    if (activeSidecar === sidecar) {
      activeSidecar = null;
      activeSidecarKey = null;
    }
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
      return () => {
        const index = responseHandlers.indexOf(handler);
        if (index >= 0) responseHandlers.splice(index, 1);
      };
    },
    onTerminate: (settle) => {
      pendingSettlers.add(settle);
      return () => {
        pendingSettlers.delete(settle);
      };
    },
    settlePending,
    kill: () => {
      settlePending();
      try {
        sidecar.send({ command: "shutdown" });
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGTERM");
      }, 2000);
    },
    alive: () => child.exitCode === null && !child.killed,
    exitPromise,
  };

  activeSidecar = sidecar;
  activeSidecarKey = key;
  return sidecar;
}

/**
 * Get the active sidecar if it's running.
 * When modelPath/ep are provided, only returns it when it was started for
 * that exact model and execution provider — otherwise the caller would send
 * requests to a process loaded with a different model.
 */
export function getActiveSidecar(modelPath?: string, ep?: string): SidecarProcess | null {
  if (activeSidecar?.alive()) {
    if (modelPath === undefined || ep === undefined) return activeSidecar;
    if (activeSidecarKey === `${modelPath}\u0000${ep}`) return activeSidecar;
    return null;
  }
  activeSidecar = null;
  activeSidecarKey = null;
  return null;
}

/**
 * Shutdown the active sidecar cleanly. Waits (bounded) for the child to exit
 * so server shutdown does not orphan the inference process with its loaded
 * model still holding CPU/GPU memory.
 */
export async function shutdownSidecar(): Promise<void> {
  const sidecar = activeSidecar;
  activeSidecar = null;
  activeSidecarKey = null;
  if (!sidecar?.alive()) return;
  sidecar.kill();
  // kill() sends the shutdown command now and SIGTERM after 2s; cap the wait
  // so a wedged sidecar can never hang server shutdown.
  await Promise.race([sidecar.exitPromise, new Promise<void>((resolve) => setTimeout(resolve, 5000))]);
}
