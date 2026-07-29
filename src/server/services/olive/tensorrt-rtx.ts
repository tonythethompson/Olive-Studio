/**
 * TensorRT RTX (consumer GeForce) probe and install helpers.
 *
 * probeTensorRtRtxLoadable and ensureTensorRtRtx cover the RTX path for
 * consumer GPUs that use NvTensorRTRTXExecutionProvider.
 *
 * For classic TensorRT (datacenter), see `tensorrt.ts`.
 */
import { spawn } from "child_process";
import fs from "fs";

import { execFileAsync } from "../shared/exec.ts";
import { getVenvPython, getVenvPip } from "../venv/paths.ts";
import { tensorrtRtxInstallArgs, tensorrtRtxLabel } from "../../../lib/tensorrtRtxDeps.ts";

export async function getInstalledTensorRtRtxVersion(python: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(python, [
      "-c",
      "import tensorrt_rtx; print(tensorrt_rtx.__version__)",
    ]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function getTensorRtRtxLibsDir(python: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(python, [
      "-c",
      "import os, tensorrt_rtx_libs; print(os.path.dirname(tensorrt_rtx_libs.__file__))",
    ]);
    const dir = stdout.trim();
    return dir && fs.existsSync(dir) ? dir : null;
  } catch {
    return null;
  }
}

/**
 * Verify that TensorRT RTX (tensorrt_rtx) is importable and a
 * runtime DLL/SO can be loaded in the target Python environment.
 */
export async function probeTensorRtRtxLoadable(
  python: string,
): Promise<{ loadable: boolean; detail?: string; version?: string }> {
  try {
    const { stdout } = await execFileAsync(python, [
      "-c",
      "import tensorrt_rtx; import onnxruntime; print('ok:' + tensorrt_rtx.__version__)",
    ]);
    const out = stdout.trim();
    if (out.includes("ok:")) {
      return {
        loadable: true,
        version: out.split("ok:").pop()?.trim() || undefined,
      };
    }
    return {
      loadable: false,
      detail: out || "TensorRT RTX load check failed",
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { loadable: false, detail: msg };
  }
}

/** Install TensorRT RTX runtime into the project venv. */
export async function ensureTensorRtRtx(
  onLine: (line: string) => void,
): Promise<{ ok: boolean; error?: string; libsDir?: string | null }> {
  const venvPython = getVenvPython();
  const pip = getVenvPip();

  const probe = await probeTensorRtRtxLoadable(venvPython);
  if (probe.loadable) {
    onLine(`[deps] TensorRT RTX runtime verified (${probe.version ?? "installed"}) ✓`);
    return {
      ok: true,
      libsDir: await getTensorRtRtxLibsDir(venvPython),
    };
  }

  const installed = await getInstalledTensorRtRtxVersion(venvPython);
  if (!installed) {
    onLine(`[deps] Installing ${tensorrtRtxLabel()} for TensorRT RTX EP (may take a few minutes)...`);
  } else {
    onLine(`[deps] ${tensorrtRtxLabel()} present but runtime not loadable — reinstalling...`);
  }

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(pip, ["install", ...tensorrtRtxInstallArgs()], {
      stdio: "pipe",
    });
    proc.stdout.on("data", (d: Buffer) => onLine("[deps] " + d.toString().trim()));
    proc.stderr.on("data", (d: Buffer) => onLine("[deps] " + d.toString().trim()));
    proc.on("close", (code: number | null) =>
      code === 0 ? resolve() : reject(new Error(`pip install ${tensorrtRtxLabel()} failed (exit ${code})`)),
    );
  });
  onLine(`[deps] ${tensorrtRtxLabel()} installed ✓`);

  const retry = await probeTensorRtRtxLoadable(venvPython);
  if (retry.loadable) {
    onLine(`[deps] TensorRT RTX runtime verified after install (${retry.version ?? "installed"}) ✓`);
    return {
      ok: true,
      libsDir: await getTensorRtRtxLibsDir(venvPython),
    };
  }

  return {
    ok: false,
    error: retry.detail ?? "TensorRT RTX not loadable after install",
  };
}
