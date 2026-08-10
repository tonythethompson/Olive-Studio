/**
 * QNN 2.x plugin EP probe / ensure for the isolated `.venvs/qnn` family.
 *
 * Production registration uses Olive's native EP library + OrtEpDevice path
 * (import onnxruntime_qnn / Olive maybe_register_ep_libraries). sitecustomize
 * and InferenceSession monkeypatches are spike-only and must not ship here.
 */
import fs from "fs";
import os from "os";
import path from "path";

import {
  ONNXRUNTIME_QNN_PLUGIN_PACKAGE,
  PINNED_ONNXRUNTIME_QNN_PLUGIN_VERSION,
  isQnnSnapdragonReleaseGatePassed,
  qnnStackLabel,
  resolveQnnHostMode,
  type QnnHostMode,
} from "../../../lib/qnnDeps.ts";
import type { QnnProbeResult } from "../../../lib/hardwareProbe.ts";
import { execFileAsync } from "../shared/exec.ts";
import { ensureVenvFamily } from "../venv/familyEnsure.ts";
import { envForFamily } from "../venv/pathIsolation.ts";
import { getVenvPython } from "../venv/paths.ts";
import { invalidateRuntimeStatusCache } from "../venv/status.ts";

const QNN_MARK = "OLIVE_QNN:";

/** ORT execution provider names for the QNN plugin and QNN ABI stacks. */
const QNN_ORT_EP_NAMES = ["QNNExecutionProvider", "QnnAbiExecutionProvider"] as const;
const QNN_ORT_EP_NAMES_PY = JSON.stringify([...QNN_ORT_EP_NAMES]);

/** Cached HTP diagnostic under .olive-studio (never on every status refresh). */
export function getQnnHtpDiagnosticPath(): string {
  return path.join(process.cwd(), ".olive-studio", "qnn-htp-diagnostic.json");
}

export type QnnHtpDiagnosticCache = {
  status: "not_run" | "passed" | "failed";
  detail?: string;
  at?: string;
};

export function readQnnHtpDiagnosticCache(): QnnHtpDiagnosticCache {
  try {
    const raw = fs.readFileSync(getQnnHtpDiagnosticPath(), "utf-8");
    const parsed = JSON.parse(raw) as QnnHtpDiagnosticCache;
    if (parsed?.status === "passed" || parsed?.status === "failed" || parsed?.status === "not_run") {
      return parsed;
    }
  } catch {
    /* absent / corrupt → not_run */
  }
  return { status: "not_run" };
}

export function writeQnnHtpDiagnosticCache(cache: QnnHtpDiagnosticCache): void {
  const dir = path.dirname(getQnnHtpDiagnosticPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    getQnnHtpDiagnosticPath(),
    JSON.stringify({ ...cache, at: cache.at ?? new Date().toISOString() }, null, 2),
    "utf-8",
  );
}

function buildProbeScript(): string {
  return `
import json
import importlib.metadata as m

def emit(key, value):
    print(${JSON.stringify(QNN_MARK)} + key + "=" + str(value).replace(chr(10), " "))

plugin_version = None
try:
    plugin_version = m.distribution(${JSON.stringify(ONNXRUNTIME_QNN_PLUGIN_PACKAGE)}).version
    emit("plugin_version", plugin_version)
except Exception as exc:
    emit("plugin_error", str(exc).replace(chr(10), " "))

try:
    import onnxruntime_qnn  # noqa: F401 — side-effect registration for QNN 2.x
    emit("plugin_import", "1")
except Exception as exc:
    emit("plugin_import_error", str(exc).replace(chr(10), " "))

any_qnn = False
npu = False
providers = []
try:
    import onnxruntime as ort
    providers = list(ort.get_available_providers())
    emit("ort_providers", ",".join(providers))
    qnn_eps = ${QNN_ORT_EP_NAMES_PY}
    emit("qnn_ep_listed", "1" if any(ep in providers for ep in qnn_eps) else "0")
    try:
        from olive.common.ort_inference import maybe_register_ep_libraries
        maybe_register_ep_libraries()
        emit("olive_register", "1")
    except Exception as exc:
        emit("olive_register_error", str(exc).replace(chr(10), " "))
    for device in ort.get_ep_devices():
        if getattr(device, "ep_name", None) not in qnn_eps:
            continue
        any_qnn = True
        dtype = getattr(getattr(device, "device", None), "type", None)
        is_npu = dtype == ort.OrtHardwareDeviceType.NPU
        if is_npu:
            npu = True
        emit("device", ("NPU" if is_npu else getattr(dtype, "name", str(dtype))))
except Exception as exc:
    emit("ort_error", str(exc).replace(chr(10), " "))

emit("qnn_ep_any", "1" if any_qnn else "0")
emit("qnn_ep_npu", "1" if npu else "0")
`.trim();
}

interface ProbeAccumulator {
  pluginVersion?: string;
  pluginImport?: boolean;
  providers?: string[];
  qnnEpListed?: boolean;
  anyQnnDevice?: boolean;
  npuDevice?: boolean;
  deviceTypes?: string[];
  detail?: string;
  oliveRegister?: boolean;
}

function parseProbeOutput(out: string): ProbeAccumulator {
  const acc: ProbeAccumulator = { deviceTypes: [] };
  const handlers: Record<string, (value: string) => void> = {
    plugin_version: (value) => {
      if (value) acc.pluginVersion = value;
    },
    plugin_error: (value) => {
      if (!acc.detail) acc.detail = value || "onnxruntime-qnn not installed";
    },
    plugin_import: () => {
      acc.pluginImport = true;
    },
    plugin_import_error: (value) => {
      acc.pluginImport = false;
      if (!acc.detail) acc.detail = value || "onnxruntime_qnn import failed";
    },
    ort_providers: (value) => {
      acc.providers = value ? value.split(",").filter(Boolean) : [];
    },
    qnn_ep_listed: (value) => {
      acc.qnnEpListed = value === "1";
    },
    olive_register: () => {
      acc.oliveRegister = true;
    },
    olive_register_error: () => {
      acc.oliveRegister = false;
    },
    device: (value) => {
      if (value) acc.deviceTypes?.push(value);
    },
    qnn_ep_any: (value) => {
      acc.anyQnnDevice = value === "1";
    },
    qnn_ep_npu: (value) => {
      acc.npuDevice = value === "1";
    },
    ort_error: (value) => {
      if (!acc.detail) acc.detail = value || "onnxruntime QNN probe failed";
    },
  };

  for (const line of out.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(QNN_MARK)) continue;
    const payload = trimmed.slice(QNN_MARK.length);
    const idx = payload.indexOf("=");
    if (idx < 0) continue;
    handlers[payload.slice(0, idx)]?.(payload.slice(idx + 1).trim());
  }
  return acc;
}

function hostMode(): QnnHostMode {
  return resolveQnnHostMode({ platform: process.platform, arch: os.arch() });
}

/**
 * Probe the qnn-family Python for plugin install, EpDevice registration, and NPU filter.
 */
export async function probeQnn(python: string): Promise<QnnProbeResult> {
  const mode = hostMode();
  const htp = readQnnHtpDiagnosticCache();
  try {
    const { stdout, stderr } = await execFileAsync(python, ["-c", buildProbeScript()], {
      env: envForFamily("qnn"),
      timeout: 60_000,
    });
    const acc = parseProbeOutput(`${stdout}\n${stderr}`);
    const pluginInstalled = Boolean(acc.pluginVersion || acc.pluginImport);
    const preparation =
      mode !== "out-of-scope" &&
      pluginInstalled &&
      (acc.anyQnnDevice === true || acc.qnnEpListed === true);
    const potentialInference = mode === "local-inference" && acc.npuDevice === true;
    const verifiedInference =
      potentialInference && htp.status === "passed" && isQnnSnapdragonReleaseGatePassed();

    let detail: string | undefined;
    if (!pluginInstalled) {
      detail = acc.detail ?? "onnxruntime-qnn plugin not installed in .venvs/qnn";
    } else if (mode === "out-of-scope") {
      detail =
        "QNN plugin install/UX is Windows-first in this release (Win ARM64 inference / Win x64 preparation).";
    } else if (!preparation) {
      detail =
        acc.detail ??
        "QNN plugin present but no QNN EpDevice registered (QNNExecutionProvider or QnnAbiExecutionProvider; Olive native registration path).";
    } else if (mode === "preparation") {
      detail =
        "QNN preparation / plugin AOT ready on Windows x64. Local HTP inference is not claimed on this host.";
    } else if (potentialInference && !verifiedInference) {
      detail = isQnnSnapdragonReleaseGatePassed()
        ? htp.status === "failed"
          ? `QNN NPU device found but HTP diagnostic failed${htp.detail ? `: ${htp.detail}` : ""}`
          : "QNN NPU device found. Run Test QNN NPU (cached HTP diagnostic) before verified inference."
        : "QNN runtime installed with NPU device. Verified “QNN NPU ready” waits on the Snapdragon release gate.";
    }

    return {
      available: preparation,
      loadable: preparation,
      pluginVersion: acc.pluginVersion,
      pluginRegistered: preparation,
      preparation,
      npuDevice: acc.npuDevice === true,
      potentialInference,
      verifiedInference,
      htpSmoke: htp,
      hostMode: mode,
      providers: acc.providers,
      deviceTypes: acc.deviceTypes,
      detail,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      available: false,
      loadable: false,
      preparation: false,
      npuDevice: false,
      potentialInference: false,
      verifiedInference: false,
      htpSmoke: htp,
      hostMode: mode,
      detail: message,
    };
  }
}

/**
 * Ensure `.venvs/qnn` exists with the pinned ORT + plugin stack, then re-probe.
 */
export async function ensureQnn(
  onLine: (line: string) => void,
): Promise<{ ok: boolean; error?: string; probe?: QnnProbeResult }> {
  const mode = hostMode();
  if (mode === "out-of-scope") {
    return {
      ok: false,
      error:
        "QNN runtime install is Windows-first (Win ARM64 local inference / Win x64 plugin preparation). This host is out of release scope.",
    };
  }

  onLine(`[deps] Ensuring QNN family (${qnnStackLabel()}) for ${mode}...`);
  const venvResult = await ensureVenvFamily("qnn", onLine);
  if (!venvResult.ok) {
    return {
      ok: false,
      error: venvResult.error ?? "Failed to create or prepare the QNN runtime",
    };
  }

  const venvPython = getVenvPython("qnn");
  if (!fs.existsSync(venvPython)) {
    return {
      ok: false,
      error: "QNN runtime is incomplete (missing python). Use Setup runtime, then retry.",
    };
  }

  invalidateRuntimeStatusCache();
  const probe = await probeQnn(venvPython);
  if (probe.preparation) {
    onLine(
      `[deps] QNN plugin verified${probe.pluginVersion ? ` (${probe.pluginVersion})` : ""} ✓` +
        (probe.npuDevice ? " [NPU EpDevice]" : " [preparation EpDevice]"),
    );
    if (mode === "preparation") {
      onLine(
        "[deps] Windows x64: preparation / plugin AOT only. Local HTP inference is not claimed.",
      );
    }
    return { ok: true, probe };
  }

  return {
    ok: false,
    error:
      probe.detail ??
      `QNN stack not loadable after install (expected ${ONNXRUNTIME_QNN_PLUGIN_PACKAGE}==${PINNED_ONNXRUNTIME_QNN_PLUGIN_VERSION})`,
    probe,
  };
}

/**
 * Optional ARM64 HTP fail-closed session diagnostic (cached; never on every refresh).
 * Creates a tiny static graph and InferenceSession with CPU fallback disabled.
 */
export async function runQnnHtpDiagnostic(
  onLine: (line: string) => void,
): Promise<{ ok: boolean; error?: string; probe?: QnnProbeResult }> {
  const mode = hostMode();
  if (mode !== "local-inference") {
    return {
      ok: false,
      error: "HTP diagnostic is only available on Windows ARM64 (local inference host mode).",
    };
  }
  const ensure = await ensureQnn(onLine);
  if (!ensure.ok) return ensure;
  const python = getVenvPython("qnn");
  const script = `
import tempfile, os
import numpy as np
import onnx
from onnx import helper, TensorProto
import onnxruntime as ort
try:
    import onnxruntime_qnn  # noqa: F401
except Exception:
    pass
try:
    from olive.common.ort_inference import maybe_register_ep_libraries
    maybe_register_ep_libraries()
except Exception:
    pass

npu_devices = [
    d for d in ort.get_ep_devices()
    if d.ep_name in ${QNN_ORT_EP_NAMES_PY}
    and d.device.type == ort.OrtHardwareDeviceType.NPU
]
if not npu_devices:
    raise SystemExit("No QNN NPU OrtEpDevice (OrtHardwareDeviceType.NPU)")
provider_name = npu_devices[0].ep_name

X = helper.make_tensor_value_info("X", TensorProto.FLOAT, [1, 2])
Y = helper.make_tensor_value_info("Y", TensorProto.FLOAT, [1, 2])
node = helper.make_node("Identity", ["X"], ["Y"])
graph = helper.make_graph([node], "qnn_htp_smoke", [X], [Y])
model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
fd, model_path = tempfile.mkstemp(suffix=".onnx")
os.close(fd)
onnx.save(model, model_path)
so = ort.SessionOptions()
# Fail-closed: no silent CPU fallback for validation sessions.
providers = [(provider_name, {"disable_cpu_ep_fallback": "1", "backend_type": "htp"})]
try:
    sess = ort.InferenceSession(model_path, sess_options=so, providers=providers)
    out = sess.run(None, {"X": np.ones((1, 2), dtype=np.float32)})
    assert out and out[0] is not None
    print(${JSON.stringify(QNN_MARK)} + "htp=passed")
finally:
    try:
        os.remove(model_path)
    except Exception:
        pass
`.trim();

  try {
    onLine("[deps] Running fail-closed QNN HTP session diagnostic...");
    const { stdout, stderr } = await execFileAsync(python, ["-c", script], {
      env: envForFamily("qnn"),
      timeout: 120_000,
    });
    const combined = `${stdout}\n${stderr}`;
    if (combined.includes(`${QNN_MARK}htp=passed`)) {
      writeQnnHtpDiagnosticCache({ status: "passed", detail: "Fail-closed HTP session + inference ok" });
      onLine("[deps] QNN HTP diagnostic passed ✓");
      invalidateRuntimeStatusCache();
      return { ok: true, probe: await probeQnn(python) };
    }
    const detail = combined.trim().split(/\r?\n/).slice(-3).join(" ") || "HTP diagnostic failed";
    writeQnnHtpDiagnosticCache({ status: "failed", detail });
    invalidateRuntimeStatusCache();
    return { ok: false, error: detail, probe: await probeQnn(python) };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    writeQnnHtpDiagnosticCache({ status: "failed", detail: msg });
    invalidateRuntimeStatusCache();
    return { ok: false, error: msg, probe: await probeQnn(python) };
  }
}
