/**
 * OpenVINO probe, install, and dependency helpers.
 *
 * Targets the isolated openvino venv family (.venvs/openvino): olive-ai +
 * onnxruntime-openvino (OpenVINOExecutionProvider) + openvino + optimum-intel.
 */
import fs from "fs";

import { execFileAsync } from "../shared/exec.ts";
import { pipInstallForFamily } from "../shared/pipInstall.ts";
import { ensureVenvFamily } from "../venv/familyEnsure.ts";
import { envForFamily } from "../venv/pathIsolation.ts";
import { getVenvPython } from "../venv/paths.ts";
import { invalidateRuntimeStatusCache } from "../venv/status.ts";
import { assertFamilyOrtConstraints } from "../venv/packageConstraints.ts";
import { getFamilySpec } from "../venv/spec.ts";
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

try:
    import onnxruntime as ort
    providers = list(ort.get_available_providers())
    emit("ort_providers", ",".join(providers))
    emit("openvino_ep", "1" if "OpenVINOExecutionProvider" in providers else "0")
except Exception as exc:
    emit("ort_error", str(exc).replace(chr(10), " "))
`.trim();
}

interface ProbeAccumulator {
  version?: string;
  devices?: string[];
  optimumIntel?: OpenVinoProbeResult["optimumIntel"];
  openvinoExecutionProvider?: boolean;
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
    openvino_ep: (value) => {
      acc.openvinoExecutionProvider = value === "1";
    },
    ort_error: (value) => {
      if (!acc.detail) acc.detail = value || "onnxruntime probe failed";
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

function stackReady(acc: ProbeAccumulator): boolean {
  return Boolean(
    acc.openvinoExecutionProvider &&
      acc.version &&
      acc.devices !== undefined &&
      acc.optimumIntel?.available,
  );
}

/**
 * Probes a Python environment for the OpenVINO runtime stack and ORT EP.
 */
export async function probeOpenVino(
  python: string,
  family: "openvino" | "default" = "openvino",
): Promise<OpenVinoProbeResult> {
  try {
    const { stdout, stderr } = await execFileAsync(python, ["-c", buildProbeScript()], {
      env: envForFamily(family),
      timeout: 45_000,
    });
    const acc = parseProbeOutput(`${stdout}\n${stderr}`);
    const available = stackReady(acc);
    return {
      available,
      version: acc.version,
      devices: acc.devices,
      optimumIntel: acc.optimumIntel,
      openvinoExecutionProvider: acc.openvinoExecutionProvider,
      detail: available
        ? undefined
        : (acc.detail ??
          (!acc.openvinoExecutionProvider
            ? "OpenVINOExecutionProvider not registered in ORT"
            : !acc.version
              ? "openvino Python package not loadable"
              : !acc.optimumIntel?.available
                ? "optimum-intel bridge missing"
                : "OpenVINO stack not ready")),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (/No module named ['"]openvino['"]/i.test(message)) {
      return { available: false, detail: "openvino is not installed in this Python environment" };
    }
    return { available: false, detail: message };
  }
}

/**
 * Ensures the openvino family has onnxruntime-openvino + openvino + optimum-intel.
 */
export async function ensureOpenVino(
  onLine: (line: string) => void,
): Promise<{ ok: boolean; error?: string; probe?: OpenVinoProbeResult }> {
  const venvResult = await ensureVenvFamily("openvino", onLine);
  if (!venvResult.ok) {
    return {
      ok: false,
      error: venvResult.error ?? "Failed to create or prepare the OpenVINO runtime",
    };
  }

  const venvPython = getVenvPython("openvino");
  if (!fs.existsSync(venvPython)) {
    return {
      ok: false,
      error: "OpenVINO runtime is incomplete (missing python). Use Setup runtime, then retry.",
    };
  }

  const probe = await probeOpenVino(venvPython, "openvino");
  if (probe.available) {
    const deviceMsg = probe.devices?.length ? ` [${probe.devices.join(", ")}]` : "";
    onLine(`[deps] OpenVINO stack verified${probe.version ? ` (${probe.version})` : ""}${deviceMsg} ✓`);
    return { ok: true, probe };
  }

  const stackArgs = openvinoStackInstallArgs();
  // Missing EP means the family ORT wheel is absent or broken — force-reinstall
  // the pinned onnxruntime-openvino args together with the Python stack (mirrors
  // DirectML missing-EP recovery).
  const installArgs = !probe.openvinoExecutionProvider
    ? [
        "--upgrade",
        "--force-reinstall",
        ...getFamilySpec("openvino").ortInstallArgs,
        ...stackArgs,
      ]
    : stackArgs;

  if (!probe.openvinoExecutionProvider) {
    onLine("[deps] OpenVINOExecutionProvider missing — installing openvino family ORT + stack...");
  } else if (!probe.version) {
    onLine(`[deps] Installing ${openvinoStackLabel()} (may take a few minutes)...`);
  } else if (!probe.optimumIntel?.available) {
    onLine(`[deps] OpenVINO present but Optimum-Intel bridge missing — installing ${openvinoStackLabel()}...`);
  } else {
    onLine(`[deps] OpenVINO stack present but not loadable — reinstalling ${openvinoStackLabel()}...`);
  }

  try {
    await pipInstallForFamily("openvino", venvPython, installArgs, onLine);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
  onLine(`[deps] ${openvinoStackLabel()} installed ✓`);

  const ortError = await assertFamilyOrtConstraints("openvino", venvPython);
  if (ortError) {
    return { ok: false, error: ortError };
  }

  invalidateRuntimeStatusCache();
  const retry = await probeOpenVino(venvPython, "openvino");
  if (retry.available) {
    const deviceMsg = retry.devices?.length ? ` [${retry.devices.join(", ")}]` : "";
    onLine(`[deps] OpenVINO stack verified after install${retry.version ? ` (${retry.version})` : ""}${deviceMsg} ✓`);
    return { ok: true, probe: retry };
  }

  return {
    ok: false,
    error: retry.detail ?? "OpenVINO stack not loadable after install",
  };
}
