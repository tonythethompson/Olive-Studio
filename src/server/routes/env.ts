/**
 * Environment / venv route handlers.
 * Python path, HuggingFace token, venv management.
 */
import type { Request, Response, Router } from "express";

import {
  getRuntimeEnvStatus,
  ensureVenv,
  getPythonVersion,
  isSupportedOlivePython,
} from "../services/venv/index.ts";
import { writeStudioConfig, addVenvToUserPath } from "../services/venv/config.ts";
import { setRuntimeHfToken, getRuntimeHfToken } from "../services/olive/state.ts";
import { ensureTensorRtRtx, ensureTensorRt } from "./tensorrt.ts";
import { ensureOpenVino } from "./openvino.ts";
import { fsWriteRateLimit, heavyCommandRateLimit } from "../middleware/rateLimit.ts";
import { resolveAllowedPythonFile } from "../services/venv/pythonGuard.ts";

/** Serialize all stack installs that mutate the shared venv via pip. */
let venvPipInstallChain: Promise<unknown> = Promise.resolve();

/** Serialize stack installation operations so that only one shared-venv pip run occurs at a time. */
function withVenvPipInstallMutex<T>(fn: () => Promise<T>): Promise<T> {
  const run = venvPipInstallChain.then(fn, fn);
  venvPipInstallChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Streams installation log messages and a final result as newline-delimited JSON.
 *
 * @param res - The response used to send progress and completion records.
 * @param run - The installation operation that receives a callback for progress lines.
 */
function streamNdjsonInstall<T extends { ok: boolean; error?: string }>(
  res: Response,
  run: (onLine: (line: string) => void) => Promise<T>,
) {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const onLine = (line: string) => {
    if (!res.writableEnded) res.write(`${JSON.stringify({ type: "log", message: line })}\n`);
  };

  return run(onLine)
    .then((result) => {
      if (!res.writableEnded) {
        res.write(`${JSON.stringify({ type: "done", ...result })}\n`);
        res.end();
      }
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (!res.writableEnded) {
        res.write(`${JSON.stringify({ type: "done", ok: false, error: msg })}\n`);
        res.end();
      }
    });
}

/**
 * Registers environment and virtual-environment management routes on an Express router.
 *
 * The routes manage Hugging Face tokens, Python configuration, runtime status, virtual-environment installation, TensorRT installation, and PATH updates.
 *
 * @param router - Express router on which to register the routes
 */
export function mountEnvRoutes(router: Router): void {
  // ─── HuggingFace Token Management ──────────────────────────────────────
  router.get("/env/hf-token-status", (_req, res) => {
    if (process.env.HF_TOKEN) return res.json({ source: "environment" });
    if (getRuntimeHfToken()) return res.json({ source: "runtime" });
    return res.json({ source: "none" });
  });

  router.post("/env/hf-token", (req, res) => {
    const { token } = req.body ?? {};
    if (!token || typeof token !== "string") {
      return res.status(400).json({ error: "Missing token" });
    }
    setRuntimeHfToken(token);
    return res.json({ ok: true });
  });

  router.delete("/env/hf-token", (_req, res) => {
    setRuntimeHfToken(null);
    return res.json({ ok: true });
  });

  // ─── TensorRT installs (NDJSON stream; creates .venv if needed) ────────
  router.post("/env/install-tensorrt-rtx", heavyCommandRateLimit, async (_req, res) => {
    await withVenvPipInstallMutex(() => streamNdjsonInstall(res, ensureTensorRtRtx));
  });

  router.post("/env/install-tensorrt", heavyCommandRateLimit, async (_req, res) => {
    await withVenvPipInstallMutex(() => streamNdjsonInstall(res, ensureTensorRt));
  });

  router.post("/env/install-openvino", heavyCommandRateLimit, async (_req, res) => {
    await withVenvPipInstallMutex(() => streamNdjsonInstall(res, ensureOpenVino));
  });

  // ─── Runtime Status ───────────────────────────────────────────────────
  router.get("/env/runtime", async (_req, res) => {
    try {
      return res.json(await getRuntimeEnvStatus());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: msg });
    }
  });

  // ─── Python Path ──────────────────────────────────────────────────────
  router.post("/env/python-path", fsWriteRateLimit, async (req, res) => {
    const { pythonPath } = req.body ?? {};
    const safe = resolveAllowedPythonFile(pythonPath);
    if (!safe.ok) {
      return res.status(400).json({ ok: false, error: safe.error });
    }
    const resolved = safe.path;
    const pyVer = await getPythonVersion(resolved);
    if (!pyVer) {
      return res.status(400).json({
        ok: false,
        error: "That file did not run as Python (`python --version` failed).",
      });
    }
    if (!isSupportedOlivePython(pyVer)) {
      return res.status(400).json({
        ok: false,
        error: `Python ${pyVer.major}.${pyVer.minor} is not supported. olive-ai needs 3.10–3.13 (3.12 recommended). Got: ${pyVer.text}`,
      });
    }
    writeStudioConfig({ systemPython: resolved });
    process.env.OLIVE_STUDIO_PYTHON = resolved;
    return res.json({ ok: true, ...(await getRuntimeEnvStatus()) });
  });

  router.delete("/env/python-path", async (_req, res) => {
    writeStudioConfig({ systemPython: undefined });
    delete process.env.OLIVE_STUDIO_PYTHON;
    return res.json({ ok: true, ...(await getRuntimeEnvStatus()) });
  });

  // ─── Venv Install ─────────────────────────────────────────────────────
  router.post("/env/venv-install", async (_req, res) => {
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") res.flushHeaders();

    const onLine = (line: string) => {
      if (!res.writableEnded) res.write(`${JSON.stringify({ type: "log", message: line })}\n`);
    };

    try {
      const result = await ensureVenv(onLine);
      res.write(`${JSON.stringify({ type: "done", ...result })}\n`);
      res.end();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.write(`${JSON.stringify({ type: "done", ok: false, error: msg })}\n`);
      res.end();
    }
  });

  // JSON alias used by RuntimeEnvControls "Install Olive venv"
  router.post("/env/ensure-venv", async (_req, res) => {
    const lines: string[] = [];
    try {
      const result = await ensureVenv((line) => lines.push(line));
      if (!result.ok) {
        return res
          .status(500)
          .json({ ok: false, error: result.error, lines, ...(await getRuntimeEnvStatus()) });
      }
      return res.json({
        ok: true,
        message: "Olive venv ready.",
        lines,
        ...(await getRuntimeEnvStatus()),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ ok: false, error: msg, lines });
    }
  });

  // ─── Add Venv to PATH ─────────────────────────────────────────────────
  const handleAddVenvToPath = async (_req: Request, res: Response) => {
    try {
      return res.json(await addVenvToUserPath());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ ok: false, error: msg });
    }
  };
  router.post("/env/venv-path", handleAddVenvToPath);
  // Alias matching RuntimeEnvControls
  router.post("/env/add-venv-to-path", handleAddVenvToPath);
}
