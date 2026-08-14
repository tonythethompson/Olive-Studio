/**
 * TensorRT RTX (consumer GeForce) probe and install helpers.
 *
 * probeTensorRtRtxLoadable and ensureTensorRtRtx cover the RTX path for
 * consumer GPUs that use NvTensorRTRTXExecutionProvider.
 *
 * Two packages must be present in the venv for the EP to be detectable:
 *
 *   1. `tensorrt-rtx` (PyPI) — must match the runtime ABI indirectly, but
 *      by itself does NOT register the EP with ONNX Runtime.
 *   2. `onnxruntime-ep-nv-tensorrt-rtx-cu13` 0.3.0 (NVIDIA PyPI index) —
 *      ships the ORT op-library DLL that exports `CreateEpFactories` and
 *      `tensorrt_rtx_*` runtime libs. Calling
 *      `onnxruntime.register_execution_provider_library` against this
 *      DLL is what causes `NvTensorRTRTXExecutionProvider` to appear in
 *      `onnxruntime.get_available_providers()`.
 *
 * For classic TensorRT (datacenter), see `tensorrt.ts`.
 */
import fs from "fs";

import { execFileAsync } from "../shared/exec.ts";
import { pipInstallForFamily } from "../shared/pipInstall.ts";
import { ensureVenvFamily } from "../venv/familyEnsure.ts";
import { envForFamily } from "../venv/pathIsolation.ts";
import { getVenvPython } from "../venv/paths.ts";
import { invalidateRuntimeStatusCache } from "../venv/status.ts";
import {
  tensorrtRtxEpAbiInstallArgs,
  tensorrtRtxEpAbiInstallCommand,
  tensorrtRtxEpAbiLabel,
  tensorrtRtxInstallArgs,
  tensorrtRtxLabel,
} from "../../../lib/tensorrtRtxDeps.ts";
import { ensureOnnxRuntimeGpu } from "./cuda.ts";

/**
 * Retrieves the installed TensorRT RTX package version.
 *
 * @param python - Path to the Python executable used to query the package
 * @returns The installed TensorRT RTX version, or `null` if it cannot be retrieved
 */
export async function getInstalledTensorRtRtxVersion(python: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(python, [
      "-c",
      "import tensorrt_rtx; print(tensorrt_rtx.__version__)",
    ], { timeout: 30_000 });
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
    ], { timeout: 30_000 });
    const dir = stdout.trim();
    return dir && fs.existsSync(dir) ? dir : null;
  } catch {
    return null;
  }
}

/**
 * Checks whether TensorRT RTX loads successfully and provides the required ONNX Runtime execution provider.
 *
 * Steps: import the NVIDIA EP-ABI plugin package (if installed), register
 * `NvTensorRTRTXExecutionProvider` against the bundled op-library DLL, then
 * check `onnxruntime.get_available_providers()`. If either the ABI package
 * is missing or the registration fails, the probe falls through to a
 * descriptive failure detail so the install path can act.
 *
 * @param python - Path to the Python interpreter to probe
 * @param env - Environment passed to the probe subprocess
 * @returns The load status, with the detected version when successful or an error detail when unsuccessful
 */
export async function probeTensorRtRtxLoadable(
  python: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ loadable: boolean; detail?: string; version?: string }> {
  // Self-diagnostics: every failure case ends in `fail:<detail>` so the
  // outer catch can keep treating missing modules uniformly. We deliberately
  // check ABI-plugin presence BEFORE importing onnxruntime so a missing
  // plugin reports a clean "plugin not installed" message instead of a
  // ForeignFunction failure deep in ORT's symbol-resolution path.
  const probeScript = `
import os, sys
try:
    import tensorrt_rtx
except Exception as exc:
    print("fail:tensorrt_rtx is not installed in .venv")
    sys.exit(0)
try:
    import onnxruntime as ort
except Exception as exc:
    print("fail:onnxruntime is not installed in .venv (required for TensorRT RTX detection)")
    sys.exit(0)

def _register_rtx_ep():
    try:
        import onnxruntime_ep_nv_tensorrt_rtx as _plug
    except Exception as exc:
        return None
    pkg_dir = os.path.dirname(_plug.__file__)
    # Pick the platform-appropriate extension: .dll on Windows, .so on
    # Linux, .dylib on macOS. A hardcoded ".dll" hides the real reason
    # an import fails on Linux/macOS.
    import sys
    if sys.platform == "win32":
        _ext = ".dll"
        _libname = "onnxruntime_providers_nv_tensorrt_rtx" + _ext
    elif sys.platform == "darwin":
        _libname = "libonnxruntime_providers_nv_tensorrt_rtx.dylib"
    else:
        _libname = "libonnxruntime_providers_nv_tensorrt_rtx.so"
    dll = os.path.join(pkg_dir, _libname)
    if not os.path.isfile(dll):
        return None
    try:
        ort.register_execution_provider_library("NvTensorRTRTXExecutionProvider", dll)
        return dll
    except Exception as exc:
        return exc

_dll_or_err = _register_rtx_ep()
if _dll_or_err is None:
    print("fail:onnxruntime-ep-nv-tensorrt-rtx-cu13 is not installed in .venv (NvTensorRTRTXExecutionProvider requires its ORT op-library)")
    sys.exit(0)
if isinstance(_dll_or_err, Exception):
    print("fail:TensorRT RTX op-library failed to register with onnxruntime: " + str(_dll_or_err).split(chr(10))[0][:200])
    sys.exit(0)

if "NvTensorRTRTXExecutionProvider" not in ort.get_available_providers():
    print("fail:NvTensorRTRTXExecutionProvider not exposed by onnxruntime after plugin registration")
    sys.exit(0)

print("ok:" + tensorrt_rtx.__version__)
`.trim();
  try {
    const { stdout } = await execFileAsync(python, ["-c", probeScript], { env, timeout: 60_000 });
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

async function ensureTensorRtRtxEpAbi(
  python: string,
  onLine: (line: string) => void,
): Promise<void> {
  onLine(`[deps] Installing ${tensorrtRtxEpAbiLabel()} (NVIDIA EP-ABI plugin)...`);
  await pipInstallForFamily("cuda", python, tensorrtRtxEpAbiInstallArgs(), onLine);
  onLine(`[deps] ${tensorrtRtxEpAbiLabel()} installed ✓`);
}

/**
 * Ensures the CUDA-family virtual environment contains a loadable TensorRT RTX runtime.
 */
export async function ensureTensorRtRtx(
  onLine: (line: string) => void,
): Promise<{ ok: boolean; error?: string; libsDir?: string | null }> {
  const venvResult = await ensureVenvFamily("cuda", onLine);
  if (!venvResult.ok) {
    return {
      ok: false,
      error: venvResult.error ?? "Failed to create or prepare the CUDA runtime",
    };
  }

  const venvPython = getVenvPython("cuda");
  if (!fs.existsSync(venvPython)) {
    return {
      ok: false,
      error: "CUDA runtime is incomplete (missing python). Use Setup runtime, then retry.",
    };
  }

  const env = envForFamily("cuda");
  const ortGpu = await ensureOnnxRuntimeGpu(onLine);
  if (!ortGpu.ok) {
    return { ok: false, error: ortGpu.error };
  }

  const probe = await probeTensorRtRtxLoadable(venvPython, env);
  if (probe.loadable) {
    onLine(`[deps] TensorRT RTX runtime verified (${probe.version ?? "installed"}) ✓`);
    return {
      ok: true,
      libsDir: await getTensorRtRtxLibsDir(venvPython),
    };
  }

  const installed = await getInstalledTensorRtRtxVersion(venvPython);
  if (!installed) {
    onLine(`[deps] Installing ${tensorrtRtxLabel()} for TensorRT RTX runtime (may take a few minutes)...`);
    try {
      await pipInstallForFamily("cuda", venvPython, tensorrtRtxInstallArgs(), onLine);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
    onLine(`[deps] ${tensorrtRtxLabel()} installed ✓`);
  } else {
    onLine(
      `[deps] ${tensorrtRtxLabel()} present but EP not loaded by onnxruntime — installing NVIDIA EP-ABI plugin...`,
    );
  }

  try {
    await ensureTensorRtRtxEpAbi(venvPython, onLine);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error:
        `${tensorrtRtxEpAbiLabel()} install failed: ${msg}. ` +
        `Install it manually with: ${tensorrtRtxEpAbiInstallCommand()}`,
    };
  }

  invalidateRuntimeStatusCache();
  const retry = await probeTensorRtRtxLoadable(venvPython, env);
  if (retry.loadable) {
    onLine(`[deps] TensorRT RTX runtime verified after install (${retry.version ?? "installed"}) ✓`);
    return {
      ok: true,
      libsDir: await getTensorRtRtxLibsDir(venvPython),
    };
  }

  return {
    ok: false,
    error:
      retry.detail ??
      `TensorRT RTX not loadable after installing ${tensorrtRtxLabel()} + ${tensorrtRtxEpAbiLabel()}`,
  };
}
