/**
 * Environment / venv route handlers.
 * Python path, HuggingFace token, venv management.
 */
import type { Router } from "express";
import path from "path";
import fs from "fs";

import {
  getRuntimeEnvStatus,
  ensureVenv,
  getPythonVersion,
  isSupportedOlivePython,
} from "../services/venv/index.ts";
import { writeStudioConfig, addVenvToUserPath } from "../services/venv/config.ts";
import { setRuntimeHfToken, getRuntimeHfToken } from "../services/olive/state.ts";
import { ensureTensorRtRtx } from "./tensorrt.ts";
import { fsWriteRateLimit } from "../middleware/rateLimit.ts";

/** Validate a user-supplied Python interpreter path before any fs/exec use. */
function resolveSafePythonPath(
  pythonPath: string,
): { ok: true; path: string } | { ok: false; error: string } {
  if (typeof pythonPath !== "string" || !pythonPath.trim()) {
    return { ok: false, error: "Missing pythonPath" };
  }
  if (pythonPath.includes("\0")) {
    return { ok: false, error: "Invalid pythonPath" };
  }
  const resolved = path.resolve(pythonPath.trim());
  if (!path.isAbsolute(resolved)) {
    return { ok: false, error: "pythonPath must be an absolute path" };
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return { ok: false, error: `File not found: ${resolved}` };
  }
  if (!stat.isFile()) {
    return { ok: false, error: `Not a file: ${resolved}` };
  }
  const base = path.basename(resolved).toLowerCase();
  if (!/^python(\d+(\.\d+)*)?(\.exe)?$/.test(base)) {
    return {
      ok: false,
      error: "pythonPath basename must look like a Python interpreter (python, python3, python.exe, …)",
    };
  }
  return { ok: true, path: resolved };
}

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

  // ─── TensorRT RTX Install ─────────────────────────────────────────────
  router.post("/env/install-tensorrt-rtx", async (_req, res) => {
    const lines: string[] = [];
    const onLine = (line: string) => lines.push(line);
    try {
      const result = await ensureTensorRtRtx(onLine);
      return res.json({ ...result, lines });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ ok: false, error: msg, lines });
    }
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
    const safe = resolveSafePythonPath(pythonPath);
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

  // ─── Add Venv to PATH ─────────────────────────────────────────────────
  router.post("/env/venv-path", async (_req, res) => {
    try {
      return res.json(await addVenvToUserPath());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ ok: false, error: msg });
    }
  });
}
