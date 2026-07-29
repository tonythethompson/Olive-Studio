/**
 * TensorRT classic probe, install, and dependency helpers.
 *
 * probeTensorRtLoadable and ensureTensorRt cover the classic (datacenter) path.
 * ensureDeps handles batch install of all inferred packages.
 *
 * For TensorRT RTX (consumer GeForce), see `routes/tensorrt.ts`.
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

import { execFileAsync } from "../shared/exec.ts";
import { getVenvPython, getVenvPip } from "../venv/paths.ts";
import { envWithPrependedPaths } from "../../../lib/tensorrtDeps.ts";
import {
  isCompatibleTensorRtVersion,
  pinnedTensorRtInstallArgs,
  pinnedTensorRtLabel,
  PINNED_TENSORRT_VERSION,
} from "../../../lib/tensorrtDeps.ts";
import { pinnedOrtGpuInstallArgs } from "../../../lib/oliveGpuRuntime.ts";
import { getNativeGpuLibPaths } from "../venv/gpu.ts";

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
    print("fail:" + msg)
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
    print("ok")
except Exception as exc:
    fail(str(exc).replace(chr(10), " ")[:500])
`.trim();

  try {
    const { stdout, stderr } = await execFileAsync(python, ["-c", script], {
      env: probeEnv,
    });
    const out = `${stdout}\n${stderr}`.trim();
    if (out.includes("ok")) {
      return { loadable: true };
    }
    const detail = out.replace(/^fail:/, "").trim() || "TensorRT provider library failed to load";
    return { loadable: false, detail };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const detail = message.includes("fail:") ? message.split("fail:").pop()?.trim() : message;
    return {
      loadable: false,
      detail: detail || "TensorRT provider library failed to load",
    };
  }
}

// ─── TensorRT install / repair ────────────────────────────────────────────

export async function ensureTensorRt(
  onLine: (line: string) => void,
): Promise<{ ok: boolean; error?: string; libsDir?: string | null }> {
  const venvPython = getVenvPython();
  const pip = getVenvPip();

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

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(pip, ["install", ...pinnedTensorRtInstallArgs()], {
      stdio: "pipe",
    });
    proc.stdout.on("data", (d: Buffer) => onLine("[deps] " + d.toString().trim()));
    proc.stderr.on("data", (d: Buffer) => onLine("[deps] " + d.toString().trim()));
    proc.on("close", (code: number | null) =>
      code === 0
        ? resolve()
        : reject(new Error(`pip install ${pinnedTensorRtLabel()} failed (exit ${code})`)),
    );
  });
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

import { probeTensorRtRtxLoadable } from "./tensorrt-rtx.ts";
import type { PkgDef } from "./recipe.ts";

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
      proc.on("close", (code: number | null) =>
        code === 0 ? resolve() : reject(new Error(`pip install ${pkg.label} failed (exit ${code})`)),
      );
    });
    onLine(`[deps] ${pkg.label} installed ✓`);
  }

  return { ok: true };
}
