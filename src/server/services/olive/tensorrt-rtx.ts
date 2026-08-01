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
import { ensureVenv } from "../venv/index.ts";
import { getVenvPython, getVenvPip } from "../venv/paths.ts";
import { tensorrtRtxInstallArgs, tensorrtRtxLabel } from "../../../lib/tensorrtRtxDeps.ts";
import {
  ORT_GPU_PROBE_SCRIPT,
  parseOrtGpuProbe,
  pinnedOrtGpuInstallArgs,
  pinnedOrtGpuLabel,
  PINNED_ORT_GPU_VERSION,
} from "../../../lib/oliveGpuRuntime.ts";

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
  const probeScript = `
import tensorrt_rtx
import onnxruntime as ort
if "NvTensorRTRTXExecutionProvider" not in ort.get_available_providers():
    print("fail:NvTensorRTRTXExecutionProvider missing from onnxruntime-gpu")
else:
    print("ok:" + tensorrt_rtx.__version__)
`.trim();
  try {
    const { stdout } = await execFileAsync(python, ["-c", probeScript]);
    const out = stdout.trim();
    if (/(?:^|\n)ok:/.test(out)) {
      return {
        loadable: true,
        version: out.split("ok:").pop()?.trim() || undefined,
      };
    }
    const failDetail = out.includes("fail:")
      ? out.split("fail:").pop()?.trim()
      : out || "TensorRT RTX load check failed";
    return {
      loadable: false,
      detail: failDetail || "TensorRT RTX load check failed",
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/No module named ['"]tensorrt_rtx['"]/i.test(msg)) {
      return { loadable: false, detail: "tensorrt_rtx is not installed in .venv" };
    }
    if (/No module named ['"]onnxruntime['"]/i.test(msg)) {
      return {
        loadable: false,
        detail: "onnxruntime is not installed in .venv (required for TensorRT RTX detection)",
      };
    }
    // Avoid dumping the full `python -c "..."` command line into the UI (blows out layout).
    const short = msg
      .replace(/^Command failed:[^\n]*/i, "")
      .replace(/\s+/g, " ")
      .trim();
    const detail =
      short.length > 0
        ? short.length > 220
          ? `${short.slice(0, 220)}…`
          : short
        : "TensorRT RTX is not loadable in .venv";
    return { loadable: false, detail };
  }
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
    const { stdout } = await execFileAsync(python, ["-c", ORT_GPU_PROBE_SCRIPT]);
    const probe = parseOrtGpuProbe(stdout);
    if (probe.ok) {
      onLine("[deps] onnxruntime-gpu already installed ✓");
      return;
    }
    if (probe.distVersion || probe.ortVersion) {
      onLine(
        `[deps] onnxruntime-gpu ${probe.distVersion ?? probe.ortVersion} installed — need ${PINNED_ORT_GPU_VERSION}, reinstalling...`,
      );
    }
  } catch {
    /* install below */
  }
  onLine(`[deps] Installing ${pinnedOrtGpuLabel()} (required to detect TensorRT RTX)...`);
  await pipInstall(pip, pinnedOrtGpuInstallArgs(), onLine);
  onLine(`[deps] ${pinnedOrtGpuLabel()} installed ✓`);
}

/** Install TensorRT RTX runtime into the project venv (creates .venv if needed). */
export async function ensureTensorRtRtx(
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

  await pipInstall(pip, tensorrtRtxInstallArgs(), onLine);
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
