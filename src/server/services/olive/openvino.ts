/**
 * OpenVINO probe, install, and dependency helpers.
 *
 * Installs openvino + optimum-intel[openvino] into the default family without
 * swapping ORT wheels (no onnxruntime-openvino).
 */
import fs from "fs";

import { execFileAsync } from "../shared/exec.ts";
import { pipInstallForFamily } from "../shared/pipInstall.ts";
import { ensureVenvFamily } from "../venv/familyEnsure.ts";
import { getVenvPython } from "../venv/paths.ts";
import { listInstalledOrtDistributions, invalidateRuntimeStatusCache } from "../venv/status.ts";
import { assertFamilyOrtConstraints } from "../venv/packageConstraints.ts";
import { openvinoStackInstallArgs, openvinoStackLabel } from "../../../lib/openvinoDeps.ts";
import type { OpenVinoProbeResult } from "../../../lib/hardwareProbe.ts";

const OV_MARK = "OLIVE_OV:";

function buildProbeScript(): string {
  return `
import sys

def emit(key, value):
    print(${JSON.stringify(OV_MARK)} + key + "=" + str(value).replace(chr(10), " "))

try:
    import openvino
    emit("version", openvino.__version__)
    try:
        import openvino.utils as ov_utils
        if hasattr(ov_utils, "add_openvino_libs_to_path"):
            ov_utils.add_openvino_libs_to_path()
    except Exception:
        pass
    from openvino import Core
    devices = Core().available_devices
    emit("devices", ",".join(devices))
except Exception as exc:
    emit("error", str(exc).replace(chr(10), " "))

try:
    import optimum.intel
    emit("optimum_intel_available", "1")
    emit("optimum_intel_version", getattr(optimum.intel, "__version__", "unknown"))
except Exception as exc:
    emit("optimum_intel_error", str(exc).replace(chr(10), " "))
`.trim();
}

interface ProbeAccumulator {
  version?: string;
  devices?: string[];
  optimumIntel?: OpenVinoProbeResult["optimumIntel"];
  detail?: string;
}

function parseProbeOutput(out: string): ProbeAccumulator {
  const acc: ProbeAccumulator = {};

  const handlers: Record<string, (value: string) => void> = {
    version: (value) => {
      if (value) acc.version = value;
    },
    devices: (value) => {
      acc.devices = value ? value.split(",").filter(Boolean) : [];
    },
    optimum_intel_available: () => {
      acc.optimumIntel = {
        available: true,
        ...(acc.optimumIntel?.version ? { version: acc.optimumIntel.version } : {}),
      };
    },
    optimum_intel_version: (value) => {
      acc.optimumIntel = {
        ...(acc.optimumIntel ?? { available: false }),
        available: true,
        version: value || undefined,
      };
    },
    optimum_intel_error: (value) => {
      acc.optimumIntel = { available: false, detail: value || "optimum.intel import failed" };
      if (!acc.detail) acc.detail = value || "optimum.intel import failed";
    },
    error: (value) => {
      acc.detail = value || "OpenVINO probe failed";
    },
  };

  for (const line of out.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(OV_MARK)) continue;
    const payload = trimmed.slice(OV_MARK.length);
    const idx = payload.indexOf("=");
    if (idx < 0) continue;
    const key = payload.slice(0, idx);
    const value = payload.slice(idx + 1).trim();
    handlers[key]?.(value);
  }

  return acc;
}

/**
 * Probes a Python environment for the OpenVINO runtime and Optimum-Intel.
 * Availability is based on the Python `openvino` package (not ORT EP).
 */
export async function probeOpenVino(python: string): Promise<OpenVinoProbeResult> {
  try {
    const { stdout, stderr } = await execFileAsync(python, ["-c", buildProbeScript()]);
    const acc = parseProbeOutput(`${stdout}\n${stderr}`);
    const openvinoRuntimeOk = Boolean(acc.version) && acc.devices !== undefined;
    const available = openvinoRuntimeOk;
    return {
      available,
      version: acc.version,
      devices: acc.devices,
      optimumIntel: acc.optimumIntel,
      openvinoExecutionProvider: undefined,
      detail: available ? undefined : (acc.detail ?? "OpenVINO runtime not available"),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (/No module named ['"]openvino['"]/i.test(message)) {
      return { available: false, detail: "openvino is not installed in this Python environment" };
    }
    return { available: false, detail: message };
  }
}

async function assertDefaultOrtPreserved(python: string): Promise<string | null> {
  // Keep an explicit onnxruntime-openvino check for clearer install errors, then
  // fall through to shared family packageConstraints assertion.
  const dists = await listInstalledOrtDistributions(python);
  if (dists.includes("onnxruntime-openvino")) {
    return "onnxruntime-openvino must not be installed in the default runtime (conflicts with DirectML/CPU ORT)";
  }
  return assertFamilyOrtConstraints("default", python);
}

/**
 * Ensures the default family has a loadable OpenVINO Python stack without
 * replacing the family's canonical ORT wheel.
 */
export async function ensureOpenVino(
  onLine: (line: string) => void,
): Promise<{ ok: boolean; error?: string; probe?: OpenVinoProbeResult }> {
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

  const probe = await probeOpenVino(venvPython);
  if (probe.available && probe.optimumIntel?.available) {
    const deviceMsg = probe.devices?.length ? ` [${probe.devices.join(", ")}]` : "";
    onLine(`[deps] OpenVINO stack verified${probe.version ? ` (${probe.version})` : ""}${deviceMsg} ✓`);
    return { ok: true, probe };
  }

  if (!probe.version) {
    onLine(`[deps] Installing ${openvinoStackLabel()} (may take a few minutes)...`);
  } else if (!probe.optimumIntel?.available) {
    onLine(`[deps] OpenVINO present but Optimum-Intel bridge missing — installing ${openvinoStackLabel()}...`);
  } else {
    onLine(`[deps] OpenVINO stack present but not loadable — reinstalling ${openvinoStackLabel()}...`);
  }

  onLine("[deps] Installing OpenVINO Python packages without swapping ORT wheels.");

  try {
    await pipInstallForFamily("default", venvPython, openvinoStackInstallArgs(), onLine);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
  onLine(`[deps] ${openvinoStackLabel()} installed ✓`);

  const ortError = await assertDefaultOrtPreserved(venvPython);
  if (ortError) {
    return { ok: false, error: ortError };
  }

  invalidateRuntimeStatusCache();
  const retry = await probeOpenVino(venvPython);
  if (retry.available && retry.optimumIntel?.available) {
    const deviceMsg = retry.devices?.length ? ` [${retry.devices.join(", ")}]` : "";
    onLine(`[deps] OpenVINO stack verified after install${retry.version ? ` (${retry.version})` : ""}${deviceMsg} ✓`);
    return { ok: true, probe: retry };
  }

  if (!retry.available) {
    return {
      ok: false,
      error: retry.detail ?? "OpenVINO Python package not loadable after install",
    };
  }
  return {
    ok: false,
    error:
      retry.optimumIntel?.detail ??
      "Optimum-Intel bridge not loadable after OpenVINO install",
  };
}
