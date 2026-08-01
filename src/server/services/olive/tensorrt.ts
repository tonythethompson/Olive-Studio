/**
 * Classic TensorRT (full SDK) probe, install, and dependency helpers.
 *
 * Full TensorRT SDK works on GeForce Turing+ as well as datacenter GPUs;
 * install-on-demand via ensureTensorRt matches the TensorRT RTX flow.
 * RTX-specific path is in tensorrt-rtx.ts.
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

import { execFileAsync } from "../shared/exec.ts";
import { ensureVenv } from "../venv/index.ts";
import { getVenvPython, getVenvPip } from "../venv/paths.ts";
import { getNativeGpuLibPaths } from "../venv/gpu.ts";
import {
  envWithPrependedPaths,
  isCompatibleTensorRtVersion,
  pinnedTensorRtInstallArgs,
  pinnedTensorRtLabel,
  PINNED_TENSORRT_VERSION,
} from "../../../lib/tensorrtDeps.ts";
import { pinnedOrtGpuInstallArgs, pinnedOrtGpuLabel } from "../../../lib/oliveGpuRuntime.ts";
import { probeTensorRtRtxLoadable } from "./tensorrt-rtx.ts";
import type { PkgDef } from "./recipe.ts";

const TRT_FAIL_MARK = "OLIVE_TRT_FAIL:";

// ─── Version / directory queries ─────────────────────────────────────────

export async function getInstalledTensorRtVersion(python: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(python, ["-c", "import tensorrt; print(tensorrt.__version__)"]);
    const version = stdout.trim();
    return version || null;
  } catch {
    return null;
  }
}

export async function getTensorRtLibsDir(python: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(python, [
      "-c",
      "import os, tensorrt_libs; print(os.path.dirname(tensorrt_libs.__file__))",
    ]);
    const dir = stdout.trim();
    return dir && fs.existsSync(dir) ? dir : null;
  } catch {
    return null;
  }
}

function extractTrtFailDetail(text: string): string | undefined {
  const idx = text.indexOf(TRT_FAIL_MARK);
  if (idx < 0) return undefined;
  return text.slice(idx + TRT_FAIL_MARK.length).trim() || undefined;
}

async function pipInstall(pip: string, args: string[], onLine: (line: string) => void): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(pip, ["install", ...args], { stdio: "pipe" });
    proc.stdout.on("data", (d: Buffer) => onLine("[deps] " + d.toString().trim()));
    proc.stderr.on("data", (d: Buffer) => onLine("[deps] " + d.toString().trim()));
    proc.on("error", (err: Error) =>
      reject(
        new Error(
          `Failed to launch ${pip}: ${err.message}. Create the project .venv via Setup runtime first.`,
        ),
      ),
    );
    proc.on("close", (code: number | null) =>
      code === 0 ? resolve() : reject(new Error(`pip install ${args.join(" ")} failed (exit ${code})`)),
    );
  });
}

async function ensureOnnxRuntimeGpu(
  python: string,
  pip: string,
  onLine: (line: string) => void,
): Promise<void> {
  try {
    await execFileAsync(python, ["-c", "import onnxruntime"]);
    onLine("[deps] onnxruntime already installed ✓");
    return;
  } catch {
    /* install below */
  }
  onLine(`[deps] Installing ${pinnedOrtGpuLabel()} (required for TensorRT EP)...`);
  await pipInstall(pip, pinnedOrtGpuInstallArgs(), onLine);
  onLine(`[deps] ${pinnedOrtGpuLabel()} installed ✓`);
}

// ─── TensorRT load probe ──────────────────────────────────────────────────

/**
 * Verify that TensorRT 10.x (nvinfer_10) is loadable inside the venv Python.
 *
 * Tests: tensorrt import → version check → DLL load → ORT provider availability.
 * The `env` parameter allows injecting PATH modifications for GPU library dirs.
 */
export async function probeTensorRtLoadable(
  python: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ loadable: boolean; detail?: string }> {
  const libPaths = await getNativeGpuLibPaths(python);
  const probeEnv = envWithPrependedPaths(env, libPaths);
  const script = `
import ctypes
import os
import sys

def fail(msg):
    # Split marker so it never appears contiguous in this -c source dump.
    print("OLIVE" + "_TRT_FAIL:" + msg)
    sys.exit(1)

try:
    import tensorrt
    ver = tensorrt.__version__
    if not ver.startswith("10."):
        fail("TensorRT " + ver + " installed; stable onnxruntime-gpu needs TensorRT 10.x (nvinfer_10)")
    import tensorrt_libs
    libs = os.path.dirname(tensorrt_libs.__file__)
    os.environ["PATH"] = libs + os.pathsep + os.environ.get("PATH", "")
    if sys.platform == "win32":
        ctypes.CDLL(os.path.join(libs, "nvinfer_10.dll"))
    else:
        ctypes.CDLL(os.path.join(libs, "libnvinfer.so.10"))
    import onnxruntime as ort
    if "TensorrtExecutionProvider" not in ort.get_available_providers():
        fail("TensorrtExecutionProvider missing from onnxruntime")
    print("olive_trt_ok")
except Exception as exc:
    fail(str(exc).replace(chr(10), " ")[:500])
`.trim();

  try {
    const { stdout, stderr } = await execFileAsync(python, ["-c", script], {
      env: probeEnv,
    });
    const out = `${stdout}\n${stderr}`.trim();
    if (/(?:^|\n)olive_trt_ok(?:\n|$)/.test(out)) {
      return { loadable: true };
    }
    const detail = extractTrtFailDetail(out) || out.trim() || "TensorRT provider library failed to load";
    return { loadable: false, detail };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const stdout =
      err && typeof err === "object" && "stdout" in err
        ? String((err as { stdout?: unknown }).stdout ?? "")
        : "";
    const stderr =
      err && typeof err === "object" && "stderr" in err
        ? String((err as { stderr?: unknown }).stderr ?? "")
        : "";
    // Prefer real probe streams; never scan the Command-failed -c dump for the marker
    // (the dump can contain fragments of this script).
    const marked = extractTrtFailDetail(`${stdout}\n${stderr}`);
    if (marked) {
      if (/No module named ['"]tensorrt['"]/i.test(marked)) {
        return { loadable: false, detail: "tensorrt is not installed in .venv" };
      }
      if (/No module named ['"]onnxruntime['"]/i.test(marked)) {
        return {
          loadable: false,
          detail: "onnxruntime is not installed in .venv (required for TensorRT EP detection)",
        };
      }
      return { loadable: false, detail: marked };
    }

    const combined = `${stdout}\n${stderr}\n${message}`;
    if (/No module named ['"]tensorrt['"]/i.test(combined)) {
      return { loadable: false, detail: "tensorrt is not installed in .venv" };
    }
    if (/No module named ['"]onnxruntime['"]/i.test(combined)) {
      return {
        loadable: false,
        detail: "onnxruntime is not installed in .venv (required for TensorRT EP detection)",
      };
    }
    const lines = message.split(/\r?\n/).filter(Boolean);
    const short = lines[lines.length - 1] ?? message;
    return {
      loadable: false,
      detail: short.length > 400 ? `${short.slice(0, 400)}…` : short,
    };
  }
}

// ─── TensorRT install / repair ────────────────────────────────────────────

export async function ensureTensorRt(
  onLine: (line: string) => void,
): Promise<{ ok: boolean; error?: string; libsDir?: string | null }> {
  const venvResult = await ensureVenv(onLine);
  if (!venvResult.ok) {
    return {
      ok: false,
      error: venvResult.error ?? "Failed to create or prepare the project .venv",
    };
  }

  const venvPython = getVenvPython();
  const pip = getVenvPip();
  if (!fs.existsSync(venvPython) || !fs.existsSync(pip)) {
    return {
      ok: false,
      error: `Project .venv is incomplete (missing ${!fs.existsSync(pip) ? "pip" : "python"}). Use Setup runtime, then retry.`,
    };
  }

  await ensureOnnxRuntimeGpu(venvPython, pip, onLine);

  const probe = await probeTensorRtLoadable(venvPython);
  if (probe.loadable) {
    onLine("[deps] TensorRT execution provider load verified ✓");
    return {
      ok: true,
      libsDir: (await getNativeGpuLibPaths(venvPython)).join(path.delimiter) || null,
    };
  }

  const installed = await getInstalledTensorRtVersion(venvPython);
  if (installed && !isCompatibleTensorRtVersion(installed)) {
    onLine(
      `[deps] TensorRT ${installed} is incompatible with stable onnxruntime-gpu (needs ${PINNED_TENSORRT_VERSION} / nvinfer_10) — reinstalling...`,
    );
  } else if (!installed) {
    onLine(
      `[deps] Installing ${pinnedTensorRtLabel()} for TensorRT EP (large download, may take several minutes)...`,
    );
  } else {
    onLine(`[deps] TensorRT ${installed} present but EP not loadable — reinstalling pinned runtime...`);
  }

  await pipInstall(pip, pinnedTensorRtInstallArgs(), onLine);
  onLine(`[deps] ${pinnedTensorRtLabel()} installed ✓`);

  const retry = await probeTensorRtLoadable(venvPython);
  if (retry.loadable) {
    onLine("[deps] TensorRT execution provider load verified after install ✓");
    return {
      ok: true,
      libsDir: (await getNativeGpuLibPaths(venvPython)).join(path.delimiter) || null,
    };
  }

  return {
    ok: false,
    error: retry.detail ?? "TensorRT SDK not loadable after install (nvinfer_10.dll missing)",
  };
}

// ─── Batch dependency installer ───────────────────────────────────────────

/**
 * Install all required packages into the project venv.
 * Handles version checks, CUDA mismatches, and pinned package validation
 * for each package before installing.
 */
export async function ensureDeps(
  pkgs: PkgDef[],
  onLine: (line: string) => void,
): Promise<{ ok: boolean; error?: string }> {
  const venvPython = getVenvPython();
  const pip = getVenvPip();

  for (const pkg of pkgs) {
    // Torch: check installed CUDA version matches what we need (GPU vs CPU)
    if (pkg.importName === "torch") {
      try {
        const { stdout } = await execFileAsync(venvPython, [
          "-c",
          "import torch; print(torch.version.cuda or 'NONE')",
        ]);
        const installedCuda = stdout.trim();
        const needsGpu = !pkg.installArgs.some(
          (arg) => typeof arg === "string" && (arg.includes("whl/cpu") || /(?:^|\/)cpu\/?$/.test(arg)),
        );
        const hasGpu = installedCuda !== "NONE" && installedCuda !== "";
        if (needsGpu === hasGpu) {
          onLine(`[deps] torch already installed (CUDA: ${hasGpu ? installedCuda : "none/CPU"}) ✓`);
          continue;
        }
        onLine(
          `[deps] torch CUDA mismatch (have ${hasGpu ? installedCuda : "CPU"}, need ${needsGpu ? "GPU" : "CPU"}) — reinstalling...`,
        );
      } catch {
        /* not installed, fall through */
      }
    } else if (pkg.importName === "tensorrt") {
      const installed = await getInstalledTensorRtVersion(venvPython);
      if (installed && isCompatibleTensorRtVersion(installed)) {
        const probe = await probeTensorRtLoadable(venvPython);
        if (probe.loadable) {
          onLine(`[deps] ${pkg.label} already installed (${installed}) ✓`);
          continue;
        }
        onLine(`[deps] ${pkg.label} installed but TensorRT EP not loadable — reinstalling...`);
      } else if (installed) {
        onLine(
          `[deps] ${pkg.label} version ${installed} incompatible — installing ${PINNED_TENSORRT_VERSION}...`,
        );
      }
    } else if (pkg.importName === "tensorrt_rtx") {
      const probe = await probeTensorRtRtxLoadable(venvPython);
      if (probe.loadable) {
        onLine(`[deps] ${pkg.label} already installed (${probe.version ?? "ok"}) ✓`);
        continue;
      }
    } else if (pkg.importName.startsWith("nvidia.")) {
      try {
        await execFileAsync(venvPython, [
          "-c",
          `import importlib; importlib.import_module(${JSON.stringify(pkg.importName)})`,
        ]);
        onLine(`[deps] ${pkg.label} already installed ✓`);
        continue;
      } catch {
        /* not installed */
      }
    } else if (pkg.importName === "onnxruntime") {
      try {
        const { stdout } = await execFileAsync(venvPython, [
          "-c",
          "import onnxruntime as ort; print(ort.__version__)",
        ]);
        const installed = stdout.trim();
        const expected = pinnedOrtGpuInstallArgs()[0]?.split("==")[1];
        if (installed && expected && installed === expected) {
          onLine(`[deps] ${pkg.label} already installed ✓`);
          continue;
        }
        if (installed) {
          onLine(
            `[deps] onnxruntime-gpu ${installed} installed — need ${expected ?? "pinned build"}, reinstalling...`,
          );
        }
      } catch {
        /* not installed */
      }
    } else {
      try {
        await execFileAsync(venvPython, ["-c", `import ${pkg.importName}`]);
        onLine(`[deps] ${pkg.label} already installed ✓`);
        continue;
      } catch {
        /* not installed */
      }
    }

    onLine(`[deps] Installing ${pkg.label}...`);
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(pip, ["install", ...pkg.installArgs], {
        stdio: "pipe",
      });
      proc.stdout.on("data", (d: Buffer) => onLine("[deps] " + d.toString().trim()));
      proc.stderr.on("data", (d: Buffer) => onLine("[deps] " + d.toString().trim()));
      proc.on("error", (err: Error) => reject(new Error(`Failed to launch ${pip}: ${err.message}`)));
      proc.on("close", (code: number | null) =>
        code === 0 ? resolve() : reject(new Error(`pip install ${pkg.label} failed (exit ${code})`)),
      );
    });
    onLine(`[deps] ${pkg.label} installed ✓`);
  }

  return { ok: true };
}
