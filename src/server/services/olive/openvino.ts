/**
 * OpenVINO probe, install, and dependency helpers.
 *
 * Mirrors the TensorRT / TensorRT RTX flow: ensure .venv, probe the OpenVINO
 * runtime + Optimum-Intel bridge, pip install the stack if missing, then re-probe.
 */
import { spawn } from "child_process";
import fs from "fs";

import { execFileAsync } from "../shared/exec.ts";
import { ensureVenv } from "../venv/index.ts";
import { getVenvPython, getVenvPip } from "../venv/paths.ts";
import {
  openvinoStackInstallArgs,
  openvinoStackLabel,
} from "../../../lib/openvinoDeps.ts";
import type { OpenVinoProbeResult } from "../../../lib/hardwareProbe.ts";

const OV_MARK = "OLIVE_OV:";

/**
 * Build the one-shot Python script used to interrogate a Python interpreter
 * for the OpenVINO runtime and the Optimum-Intel bridge.
 */
function buildProbeScript(): string {
  return `
import sys

def emit(key, value):
    print(${JSON.stringify(OV_MARK)} + key + "=" + str(value).replace(chr(10), " "))

try:
    import openvino
    emit("version", openvino.__version__)
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
      acc.optimumIntel = { available: true, ...(acc.optimumIntel?.version ? { version: acc.optimumIntel.version } : {}) };
    },
    optimum_intel_version: (value) => {
      acc.optimumIntel = {
        ...(acc.optimumIntel ?? { available: false }),
        available: acc.optimumIntel?.available ?? false,
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
 * Probes a Python environment for the OpenVINO runtime, available devices, and
 * the Optimum-Intel bridge.
 *
 * @param python - Path to the Python interpreter to probe
 * @returns Availability, version, device list, and Optimum-Intel status
 */
export async function probeOpenVino(python: string): Promise<OpenVinoProbeResult> {
  try {
    const { stdout, stderr } = await execFileAsync(python, ["-c", buildProbeScript()]);
    const acc = parseProbeOutput(`${stdout}\n${stderr}`);
    const available = Boolean(acc.version) && acc.devices !== undefined && Boolean(acc.optimumIntel?.available);
    return {
      available,
      version: acc.version,
      devices: acc.devices,
      optimumIntel: acc.optimumIntel,
      detail: available ? undefined : (acc.detail ?? "OpenVINO stack not available"),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (/No module named ['"]openvino['"]/i.test(message)) {
      return { available: false, detail: "openvino is not installed in .venv" };
    }
    return { available: false, detail: message };
  }
}

async function pipInstall(pip: string, args: string[], onLine: (line: string) => void): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(pip, ["install", ...args], { stdio: "pipe" });
    proc.stdout.on("data", (d: Buffer) => onLine("[deps] " + d.toString().trim()));
    proc.stderr.on("data", (d: Buffer) => onLine("[deps] " + d.toString().trim()));
    proc.on("error", (err: Error) =>
      reject(new Error(`Failed to launch ${pip}: ${err.message}. Create the project .venv via Setup runtime first.`)),
    );
    proc.on("close", (code: number | null) =>
      code === 0 ? resolve() : reject(new Error(`pip install ${args.join(" ")} failed (exit ${code})`)),
    );
  });
}

/**
 * Ensures the project virtual environment contains a loadable OpenVINO stack
 * (openvino + optimum-intel[openvino]) and reports available devices.
 *
 * @param onLine - Receives progress messages during environment preparation and installation.
 * @returns Success flag and the probe result when available.
 */
export async function ensureOpenVino(
  onLine: (line: string) => void,
): Promise<{ ok: boolean; error?: string; probe?: OpenVinoProbeResult }> {
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
    const missing = !fs.existsSync(pip) ? "pip" : "python";
    return {
      ok: false,
      error: `Project .venv is incomplete (missing ${missing}). Use Setup runtime, then retry.`,
    };
  }

  const probe = await probeOpenVino(venvPython);
  if (probe.available) {
    const deviceMsg = probe.devices?.length ? ` [${probe.devices.join(", ")}]` : "";
    onLine(`[deps] OpenVINO stack verified${probe.version ? ` (${probe.version})` : ""}${deviceMsg} ✓`);
    return { ok: true, probe };
  }

  if (!probe.version) {
    onLine(`[deps] Installing ${openvinoStackLabel()} for OpenVINO EP (may take a few minutes)...`);
  } else if (!probe.optimumIntel?.available) {
    onLine(`[deps] OpenVINO present but Optimum-Intel bridge missing — installing ${openvinoStackLabel()}...`);
  } else {
    onLine(`[deps] OpenVINO stack present but not loadable — reinstalling ${openvinoStackLabel()}...`);
  }

  await pipInstall(pip, openvinoStackInstallArgs(), onLine);
  onLine(`[deps] ${openvinoStackLabel()} installed ✓`);

  const retry = await probeOpenVino(venvPython);
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
