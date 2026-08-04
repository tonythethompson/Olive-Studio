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
 * Probes a Python environment for the OpenVINO runtime, available devices, and
 * the Optimum-Intel bridge.
 *
 * @param python - Path to the Python interpreter to probe
 * @returns Availability, version, device list, and Optimum-Intel status
 */
export async function probeOpenVino(python: string): Promise<OpenVinoProbeResult> {
  const script = `
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

  let version: string | undefined;
  let devices: string[] | undefined;
  let optimumIntel: OpenVinoProbeResult["optimumIntel"] | undefined;
  let detail: string | undefined;

  try {
    const { stdout, stderr } = await execFileAsync(python, ["-c", script]);
    const out = `${stdout}\n${stderr}`;
    for (const line of out.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed.startsWith(OV_MARK)) continue;
      const payload = trimmed.slice(OV_MARK.length);
      const idx = payload.indexOf("=");
      if (idx < 0) continue;
      const key = payload.slice(0, idx);
      const value = payload.slice(idx + 1).trim();
      switch (key) {
        case "version":
          version = value || undefined;
          break;
        case "devices":
          devices = value ? value.split(",").filter(Boolean) : [];
          break;
        case "optimum_intel_available":
          optimumIntel = { available: true, ...(optimumIntel?.version ? { version: optimumIntel.version } : {}) };
          break;
        case "optimum_intel_version":
          optimumIntel = { ...(optimumIntel ?? { available: false }), available: optimumIntel?.available ?? false, version: value || undefined };
          break;
        case "optimum_intel_error":
          optimumIntel = { available: false, detail: value || "optimum.intel import failed" };
          break;
        case "error":
          detail = value || "OpenVINO probe failed";
          break;
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (/No module named ['"]openvino['"]/i.test(message)) {
      return { available: false, detail: "openvino is not installed in .venv" };
    }
    detail = message;
  }

  const available = Boolean(version) && Boolean(optimumIntel?.available);
  return {
    available,
    version,
    devices,
    optimumIntel,
    detail: available ? undefined : (detail ?? "OpenVINO stack not available"),
  };
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
    return {
      ok: false,
      error: `Project .venv is incomplete (missing ${!fs.existsSync(pip) ? "pip" : "python"}). Use Setup runtime, then retry.`,
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
