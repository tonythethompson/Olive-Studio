/**
 * Olive execution route handlers.
 * Recipe validation, job execution, SSE streaming, GPU metrics.
 */
import type { Router } from "express";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

import type { IHVProvider } from "../../types.ts";
import { validateOliveRecipeStructure } from "../../lib/oliveRecipeSchema.ts";
import { enrichRecipeMemoryOffloadForRun } from "../../lib/memoryOffload.ts";
import { isGpuExecutionProvider } from "../../lib/oliveGpuRuntime.ts";

import { jobRegistry, getRuntimeHfToken } from "../services/olive/state.ts";
import { pushLog, startGpuMetricsTimer, stopGpuMetricsTimer } from "../services/olive/gpu.ts";
import { getVenvPython } from "../services/venv/paths.ts";
import { ensureVenv, buildOliveRunEnvironment, resolveOliveCommand } from "../services/venv/index.ts";
import type { OliveRecipe, OliveJob } from "../types.ts";
import { oliveRunRateLimit } from "../middleware/rateLimit.ts";

export function mountOliveRoutes(router: Router): void {
  // ─── POST /api/olive/run ──────────────────────────────────────────────
  router.post("/olive/run", oliveRunRateLimit, async (req, res) => {
    const { recipeJson, cudaVersion = "auto" } = req.body as { recipeJson?: string; cudaVersion?: string };
    if (!recipeJson) {
      return res.status(400).json({ ok: false, error: "Missing recipeJson" });
    }

    let recipe: OliveRecipe;
    try {
      recipe = JSON.parse(recipeJson);
    } catch {
      return res.status(400).json({ ok: false, error: "Invalid recipe JSON" });
    }

    const validation = validateOliveRecipeStructure(recipe);
    if (!validation.valid) {
      return res.status(400).json({ ok: false, error: validation.errors.join("; ") });
    }

    const jobId = uuidv4();
    const job: OliveJob = {
      id: jobId,
      status: "setting_up",
      exitCode: null,
      logs: [],
      subscribers: [],
      metricSubscribers: [],
      process: null,
      latestMetrics: null,
      metricsTimer: null,
      sampling: false,
    };
    jobRegistry.set(jobId, job);

    const provider = (recipe.systems?.local_system?.config?.accelerators?.[0]?.execution_providers?.[0] ??
      "CPUExecutionProvider") as IHVProvider;

    try {
      const venvResult = await ensureVenv((line) => pushLog(job, line));
      if (!venvResult.ok) {
        job.status = "failed";
        pushLog(job, `[error] ${venvResult.error}`);
        return res.status(500).json({ ok: false, jobId, error: venvResult.error });
      }

      const venvPython = getVenvPython();
      const env = await buildOliveRunEnvironment(venvPython, provider, process.env);

      if (cudaVersion !== "auto") {
        env.CUDA_VERSION = cudaVersion;
      }

      const hfToken = getRuntimeHfToken() ?? process.env.HF_TOKEN;
      if (hfToken) env.HF_TOKEN = hfToken;

      const enrichedRecipe = enrichRecipeMemoryOffloadForRun(recipe, 0, 0);
      const tmpDir = path.join(process.cwd(), ".olive-runs");
      fs.mkdirSync(tmpDir, { recursive: true });
      const configPath = path.join(tmpDir, `recipe-${jobId}.json`);
      fs.writeFileSync(configPath, JSON.stringify(enrichedRecipe, null, 2), "utf-8");

      pushLog(job, "[setup] Starting Olive optimization...");
      job.status = "running";

      const { executable, args } = resolveOliveCommand(provider, configPath, false);
      const proc = spawn(executable, args, { stdio: "pipe", env });
      job.process = proc;

      proc.stdout.on("data", (data: Buffer) => {
        data
          .toString()
          .split(/\r?\n/)
          .filter(Boolean)
          .forEach((line) => pushLog(job, line));
      });
      proc.stderr.on("data", (data: Buffer) => {
        data
          .toString()
          .split(/\r?\n/)
          .filter(Boolean)
          .forEach((line) => pushLog(job, `[stderr] ${line}`));
      });
      proc.on("close", (code) => {
        job.exitCode = code;
        job.status = code === 0 ? "completed" : "failed";
        stopGpuMetricsTimer(job);
        pushLog(job, `[done] Olive exited with code ${code ?? "unknown"}`);
      });
      proc.on("error", (err) => {
        job.status = "failed";
        stopGpuMetricsTimer(job);
        pushLog(job, `[error] Failed to start Olive: ${err.message}`);
      });

      if (isGpuExecutionProvider(provider)) {
        startGpuMetricsTimer(job);
      }

      return res.json({ ok: true, jobId });
    } catch (err: unknown) {
      job.status = "failed";
      const msg = err instanceof Error ? err.message : String(err);
      pushLog(job, `[error] ${msg}`);
      return res.status(500).json({ ok: false, jobId, error: msg });
    }
  });

  // ─── SSE Stream ───────────────────────────────────────────────────────
  router.get("/olive/stream/:jobId", (req, res) => {
    const job = jobRegistry.get(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") res.flushHeaders();

    for (const line of job.logs) {
      res.write(`data: ${JSON.stringify({ line })}\n\n`);
    }

    const sub = (line: string) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify({ line })}\n\n`);
    };
    job.subscribers.push(sub);

    req.on("close", () => {
      const idx = job.subscribers.indexOf(sub);
      if (idx >= 0) job.subscribers.splice(idx, 1);
    });
  });

  // ─── Job Status ───────────────────────────────────────────────────────
  router.get("/olive/status/:jobId", (req, res) => {
    const job = jobRegistry.get(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }
    return res.json({
      id: job.id,
      status: job.status,
      exitCode: job.exitCode,
      logs: job.logs,
      latestMetrics: job.latestMetrics,
    });
  });

  // ─── Cancel ───────────────────────────────────────────────────────────
  router.post("/olive/cancel", (req, res) => {
    const { jobId } = req.body ?? {};
    const job = jobRegistry.get(jobId);
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (job.process) {
      job.process.kill("SIGTERM");
      job.status = "cancelled";
    }
    return res.json({ ok: true });
  });
}
