/**
 * DirectML capability ensure for the default Windows runtime.
 * Ensures `.venv` has onnxruntime-directml with a loadable DmlExecutionProvider.
 */
import fs from "fs";
import { execFileAsync } from "../shared/exec.ts";
import { pipInstallForFamily } from "../shared/pipInstall.ts";
import { ensureVenvFamily } from "../venv/familyEnsure.ts";
import { envForFamily } from "../venv/pathIsolation.ts";
import { getVenvPython } from "../venv/paths.ts";
import { assertFamilyOrtConstraints } from "../venv/packageConstraints.ts";
import { getFamilySpec } from "../venv/spec.ts";
import { invalidateRuntimeStatusCache } from "../venv/status.ts";

const DML_PROBE = `
import json
out = {"providers": [], "dists": []}
try:
    import importlib.metadata as m
    for n in ["onnxruntime", "onnxruntime-directml", "onnxruntime-gpu", "onnxruntime-openvino"]:
        try:
            m.distribution(n)
            out["dists"].append(n)
        except Exception:
            pass
except Exception:
    pass
try:
    import onnxruntime as ort
    out["providers"] = list(ort.get_available_providers())
except Exception as exc:
    out["error"] = str(exc)
print(json.dumps(out))
`.trim();

async function probeDirectMl(python: string): Promise<{
  hasEp: boolean;
  hasWheel: boolean;
  detail?: string;
}> {
  try {
    const { stdout } = await execFileAsync(python, ["-c", DML_PROBE], {
      env: envForFamily("default"),
      timeout: 45_000,
    });
    const parsed = JSON.parse(stdout.trim()) as {
      providers?: string[];
      dists?: string[];
      error?: string;
    };
    return {
      hasEp: Boolean(parsed.providers?.includes("DmlExecutionProvider")),
      hasWheel: Boolean(parsed.dists?.includes("onnxruntime-directml")),
      detail: parsed.error,
    };
  } catch (err: unknown) {
    return {
      hasEp: false,
      hasWheel: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Ensures the default family can load DirectML on Windows.
 */
export async function ensureDirectMl(
  onLine: (line: string) => void,
): Promise<{ ok: boolean; error?: string }> {
  if (process.platform !== "win32") {
    return { ok: false, error: "DirectML requires Windows" };
  }

  const venvResult = await ensureVenvFamily("default", onLine);
  if (!venvResult.ok) {
    return {
      ok: false,
      error: venvResult.error ?? "Failed to create or prepare the default runtime",
    };
  }

  const venvPython = getVenvPython("default");
  if (!fs.existsSync(venvPython)) {
    return {
      ok: false,
      error: "Default runtime is incomplete (missing python). Use Setup runtime, then retry.",
    };
  }

  const probe = await probeDirectMl(venvPython);
  if (probe.hasEp) {
    onLine("[deps] DirectML EP already registered ✓");
    return { ok: true };
  }

  const ortArgs = getFamilySpec("default").ortInstallArgs;
  onLine(
    probe.hasWheel
      ? "[deps] onnxruntime-directml present but DmlExecutionProvider missing — reinstalling..."
      : `[deps] Installing ${ortArgs.join(" ")} into the default runtime...`,
  );

  try {
    await pipInstallForFamily(
      "default",
      venvPython,
      ["--upgrade", "--force-reinstall", ...ortArgs],
      onLine,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }

  const ortError = await assertFamilyOrtConstraints("default", venvPython);
  if (ortError) return { ok: false, error: ortError };

  invalidateRuntimeStatusCache();
  const retry = await probeDirectMl(venvPython);
  if (retry.hasEp) {
    onLine("[deps] DirectML EP verified after install ✓");
    return { ok: true };
  }
  return {
    ok: false,
    error:
      retry.detail ??
      "DmlExecutionProvider not registered after installing onnxruntime-directml",
  };
}
