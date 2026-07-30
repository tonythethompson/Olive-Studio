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

import {
  jobRegistry,
  getRuntimeHfToken,
  cleanupJobArtifacts,
  startJobRegistrySweeper,
  finalizeJob,
} from "../services/olive/state.ts";
import { pushLog, startGpuMetricsTimer, stopGpuMetricsTimer } from "../services/olive/gpu.ts";
import { getVenvPython } from "../services/venv/paths.ts";
import { ensureVenv, buildOliveRunEnvironment, resolveOliveCommand } from "../services/venv/index.ts";
import type { OliveRecipe, OliveJob } from "../types.ts";
import { oliveRunRateLimit } from "../middleware/rateLimit.ts";

export function mountOliveRoutes(router: Router): void {
  // Reclaim finished jobs + their temp recipe files on a timer.
  startJobRegistrySweeper();

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
      tempRecipePath: null,
      finishedAt: null,
      doneSubscribers: [],
    };
    jobRegistry.set(jobId, job);

    const provider = (recipe.systems?.local_system?.config?.accelerators?.[0]?.execution_providers?.[0] ??
      "CPUExecutionProvider") as IHVProvider;

    try {
      const venvResult = await ensureVenv((line) => pushLog(job, line));
      if (!venvResult.ok) {
        job.status = "failed";
        finalizeJob(job);
        cleanupJobArtifacts(job);
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
      job.tempRecipePath = configPath;

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
        // Preserve intentional cancellation — do not overwrite with failed/completed.
        if (job.status !== "cancelled") {
          job.status = code === 0 ? "completed" : "failed";
        }
        stopGpuMetricsTimer(job);
        cleanupJobArtifacts(job);
        pushLog(job, `[done] Olive exited with code ${code ?? "unknown"}`);
        finalizeJob(job);
      });
      proc.on("error", (err) => {
        if (job.status !== "cancelled") {
          job.status = "failed";
        }
        stopGpuMetricsTimer(job);
        cleanupJobArtifacts(job);
        pushLog(job, `[error] Failed to start Olive: ${err.message}`);
        finalizeJob(job);
      });

      if (isGpuExecutionProvider(provider)) {
        startGpuMetricsTimer(job);
      }

      return res.json({ ok: true, jobId });
    } catch (err: unknown) {
      job.status = "failed";
      cleanupJobArtifacts(job);
      const msg = err instanceof Error ? err.message : String(err);
      pushLog(job, `[error] ${msg}`);
      finalizeJob(job);
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

    const isTerminal = () =>
      job.status === "completed" || job.status === "failed" || job.status === "cancelled";

    // If the job already finished, flush a terminal event and close immediately.
    if (isTerminal()) {
      res.write(`data: ${JSON.stringify({ done: true, status: job.status, exitCode: job.exitCode })}\n\n`);
      return res.end();
    }

    let heartbeat: ReturnType<typeof setInterval> | null = null;
    const cleanup = () => {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      const subIdx = job.subscribers.indexOf(sub);
      if (subIdx >= 0) job.subscribers.splice(subIdx, 1);
      const doneIdx = job.doneSubscribers.indexOf(onDone);
      if (doneIdx >= 0) job.doneSubscribers.splice(doneIdx, 1);
    };

    const sub = (line: string) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify({ line })}\n\n`);
    };
    job.subscribers.push(sub);

    // Fired the instant the job reaches a terminal state — closes the stream
    // immediately rather than waiting up to one heartbeat interval.
    const onDone = () => {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify({ done: true, status: job.status, exitCode: job.exitCode })}\n\n`);
      cleanup();
      res.end();
    };
    job.doneSubscribers.push(onDone);

    // Heartbeat keeps proxies from buffering/closing an idle stream, and acts as
    // a fallback terminator if the done event was somehow missed.
    heartbeat = setInterval(() => {
      if (res.writableEnded) {
        cleanup();
        return;
      }
      if (isTerminal()) {
        onDone();
        return;
      }
      res.write(`: ping\n\n`);
    }, 15_000);

    req.on("close", cleanup);
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
      job.status = "cancelled";
      job.process.kill("SIGTERM");
      stopGpuMetricsTimer(job);
      // Fallback finalize in case the process never emits "close"; the close
      // handler is idempotent (finishedAt is only stamped once).
      finalizeJob(job);
    }
    return res.json({ ok: true });
  });
}
