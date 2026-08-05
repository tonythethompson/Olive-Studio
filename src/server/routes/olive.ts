/**
 * Olive execution route handlers.
 * Recipe validation, job execution, SSE streaming, GPU metrics.
 */
import type { Router } from "express";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

import type { GpuMetrics } from "../../lib/gpuMetrics.ts";
import { validateOliveRecipeStructure } from "../../lib/oliveRecipeSchema.ts";
import { enrichRecipeMemoryOffloadForRun } from "../../lib/memoryOffload.ts";
import { isGpuExecutionProvider } from "../../lib/oliveGpuRuntime.ts";
import { normalizeIhvProvider } from "../../lib/venvFamily.ts";
import { resolveQnnHostMode } from "../../lib/qnnDeps.ts";
import { assessQnnRecipeReadiness } from "../../lib/qnnReadiness.ts";
import { DEFAULT_PASSES } from "../../lib/defaultPasses.ts";

import {
  jobRegistry,
  getRuntimeHfToken,
  cleanupJobArtifacts,
  startJobRegistrySweeper,
  finalizeJob,
} from "../services/olive/state.ts";
import { pushLog, startGpuMetricsTimer, stopGpuMetricsTimer } from "../services/olive/gpu.ts";
import { probeQnn } from "../services/olive/qnn.ts";
import { getVenvPython } from "../services/venv/paths.ts";
import {
  ensureProviderCapability,
  buildOliveRunEnvironment,
  resolveOliveCommand,
  detachVenvListener,
} from "../services/venv/index.ts";
import type { OliveRecipe, OliveJob } from "../types.ts";
import { oliveRunRateLimit } from "../middleware/rateLimit.ts";
import type { HardwareProbeResult } from "../../lib/hardwareProbe.ts";

/** Grace period after SIGTERM before escalating cancel to SIGKILL. */
export const CANCEL_SIGKILL_GRACE_MS = 10_000;

/** Write a named Server-Sent Event (`event:` + JSON `data:`). */
export function writeNamedSse(
  res: { writableEnded?: boolean; write: (chunk: string) => unknown },
  event: string,
  data: unknown,
): void {
  if (res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

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

    const providerRaw =
      recipe.systems?.local_system?.config?.accelerators?.[0]?.execution_providers?.[0] ??
      "CPUExecutionProvider";
    const provider = normalizeIhvProvider(providerRaw);
    if (!provider) {
      return res.status(400).json({
        ok: false,
        error: `Unknown execution provider: ${String(providerRaw)}`,
      });
    }

    if (provider === "QNNExecutionProvider") {
      const inputModel = recipe.input_model as { io_config?: unknown } | undefined;
      const hostMode = resolveQnnHostMode({ platform: process.platform, arch: process.arch });
      const hardFailures = assessQnnRecipeReadiness({
        state: { ihvProvider: provider, passes: DEFAULT_PASSES },
        ioConfig: inputModel?.io_config,
        hostMode,
        platform: { platform: process.platform, arch: process.arch },
      }).filter((issue) => issue.severity === "error");
      if (hardFailures.length > 0) {
        return res.status(400).json({
          ok: false,
          error: hardFailures.map((issue) => issue.message).join("; "),
        });
      }
    }

    // Canonicalize EP token before enrich/serialize so Olive never sees aliases (e.g. trt).
    const accel = recipe.systems?.local_system?.config?.accelerators?.[0];
    if (accel && Array.isArray(accel.execution_providers) && accel.execution_providers.length > 0) {
      accel.execution_providers[0] = provider;
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

    // Cancellation can arrive during the long setup awaits below, before a
    // process exists. Bail out (and respond) instead of spawning Olive anyway.
    const bailIfCancelled = (): boolean => {
      if (job.status !== "cancelled") return false;
      pushLog(job, "[cancel] Cancelled during environment setup.");
      cleanupJobArtifacts(job);
      finalizeJob(job);
      res.json({ ok: false, jobId, status: "cancelled" });
      return true;
    };

    try {
      // Retain the listener so /olive/cancel can detach it if setup is pending.
      const venvListener = (line: string) => pushLog(job, line);
      job.venvListener = venvListener;
      const capResult = await ensureProviderCapability(
        provider,
        venvListener,
        provider === "QNNExecutionProvider"
          ? {
              usage:
                resolveQnnHostMode({ platform: process.platform, arch: process.arch }) ===
                "local-inference"
                  ? "inference"
                  : "preparation",
            }
          : undefined,
      );
      // Setup finished for this caller — the listener is no longer registered.
      job.venvListener = undefined;
      if (bailIfCancelled()) return;
      if (!capResult.ok) {
        job.status = "failed";
        pushLog(job, `[error] ${capResult.error}`);
        cleanupJobArtifacts(job);
        finalizeJob(job);
        return res.status(500).json({ ok: false, jobId, error: capResult.error });
      }

      const venvPython = capResult.python ?? getVenvPython(capResult.family);

      if (provider === "QNNExecutionProvider" && venvPython) {
        const hostMode = resolveQnnHostMode({ platform: process.platform, arch: process.arch });
        if (hostMode === "local-inference") {
          const qnn = await probeQnn(venvPython);
          const inputModel = recipe.input_model as { io_config?: unknown } | undefined;
          const probe: HardwareProbeResult = {
            probedAt: new Date().toISOString(),
            platform: {
              os: process.platform,
              arch: process.arch,
              cpuModel: "",
              cpuCores: 0,
            },
            detectedProviders: ["QNNExecutionProvider"],
            recommendedProvider: "QNNExecutionProvider",
            notes: [],
            qnn,
          };
          const hardFailures = assessQnnRecipeReadiness({
            state: { ihvProvider: provider, passes: DEFAULT_PASSES },
            ioConfig: inputModel?.io_config,
            hostMode,
            probe,
          }).filter((issue) => issue.severity === "error");
          if (hardFailures.length > 0) {
            const error = hardFailures.map((issue) => issue.message).join("; ");
            job.status = "failed";
            pushLog(job, `[error] ${error}`);
            cleanupJobArtifacts(job);
            finalizeJob(job);
            return res.status(400).json({ ok: false, jobId, error });
          }
        }
      }

      const env = await buildOliveRunEnvironment(venvPython, provider, process.env, capResult.family);
      if (bailIfCancelled()) return;

      if (cudaVersion !== "auto") {
        env.CUDA_VERSION = cudaVersion;
      }

      const hfToken = getRuntimeHfToken() ?? process.env.HF_TOKEN;
      if (hfToken) env.HF_TOKEN = hfToken;

      const enrichedRecipe = enrichRecipeMemoryOffloadForRun(recipe, 0, 0);
      const tmpDir = path.join(process.cwd(), ".olive-runs");
      fs.mkdirSync(tmpDir, { recursive: true });
      const configPath = path.join(tmpDir, `recipe-${jobId}.json`);
      // Record the path before writing so a failed/partial write is still
      // reclaimable by cleanupJobArtifacts (rmSync force:true tolerates a
      // never-created file).
      job.tempRecipePath = configPath;
      fs.writeFileSync(configPath, JSON.stringify(enrichedRecipe, null, 2), "utf-8");

      pushLog(job, "[setup] Starting Olive optimization...");
      job.status = "running";

      const { executable, args } = resolveOliveCommand(provider, configPath, false, capResult.family);
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
        // Process has exited — clear the handle so the sweeper may reclaim it.
        job.process = null;
        finalizeJob(job);
      });
      proc.on("error", (err) => {
        if (job.status !== "cancelled") {
          job.status = "failed";
        }
        pushLog(job, `[error] Failed to start Olive: ${err.message}`);
        // Terminal cleanup (stop metrics, remove artifacts, clear the handle,
        // finalize) is handled by the "close" listener, which fires after "error"
        // for spawn failures. A post-spawn error (e.g. a failed kill) must not drop
        // the process handle while the child may still be alive.
      });

      if (isGpuExecutionProvider(provider)) {
        startGpuMetricsTimer(job);
      }

      return res.json({ ok: true, jobId });
    } catch (err: unknown) {
      // Preserve intentional cancellation — e.g. ensureProviderCapability /
      // buildOliveRunEnvironment rejecting after /olive/cancel already stamped "cancelled".
      if (job.status !== "cancelled") {
        job.status = "failed";
      }
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
      writeNamedSse(res, "log", { line });
    }
    if (job.latestMetrics) {
      writeNamedSse(res, "metrics", job.latestMetrics);
    }

    const isTerminal = () =>
      job.status === "completed" || job.status === "failed" || job.status === "cancelled";

    // If the job already finished, flush a terminal event and close immediately.
    if (isTerminal()) {
      writeNamedSse(res, "done", { done: true, status: job.status, exitCode: job.exitCode });
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
      const metricIdx = job.metricSubscribers.indexOf(metricSub);
      if (metricIdx >= 0) job.metricSubscribers.splice(metricIdx, 1);
      const doneIdx = job.doneSubscribers.indexOf(onDone);
      if (doneIdx >= 0) job.doneSubscribers.splice(doneIdx, 1);
    };

    const sub = (line: string) => {
      writeNamedSse(res, "log", { line });
    };
    job.subscribers.push(sub);

    const metricSub = (metrics: GpuMetrics) => {
      writeNamedSse(res, "metrics", metrics);
    };
    job.metricSubscribers.push(metricSub);

    // Fired the instant the job reaches a terminal state — closes the stream
    // immediately rather than waiting up to one heartbeat interval.
    const onDone = () => {
      if (res.writableEnded) return;
      writeNamedSse(res, "done", { done: true, status: job.status, exitCode: job.exitCode });
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

    // Already terminal — nothing to cancel.
    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
      return res.json({ ok: true, status: job.status });
    }

    // Mark cancelled even during "setting_up" (no process yet). The /olive/run
    // setup loop checks this status after each await and aborts before spawning.
    job.status = "cancelled";
    pushLog(job, "[cancel] Cancellation requested.");
    // Detach from shared venv setup so the cancelled job stops receiving install
    // output while setup (which may serve other jobs) keeps running.
    if (job.venvListener) {
      detachVenvListener(job.venvListener);
      job.venvListener = undefined;
    }
    if (job.process) {
      const proc = job.process;
      proc.kill("SIGTERM");
      // SIGTERM is best-effort; escalate so a stuck Olive child cannot outlive cancel.
      const killTimer = setTimeout(() => {
        if (proc.exitCode === null && proc.signalCode === null) {
          proc.kill("SIGKILL");
          pushLog(job, "[cancel] Process did not exit after SIGTERM; sent SIGKILL.");
        }
      }, CANCEL_SIGKILL_GRACE_MS);
      if (typeof killTimer.unref === "function") killTimer.unref();
      proc.once("close", () => clearTimeout(killTimer));
      stopGpuMetricsTimer(job);
    }
    // Finalize so open SSE streams close now; the "close" handler (if a process
    // is running) is idempotent — finishedAt is only stamped once.
    finalizeJob(job);
    return res.json({ ok: true, status: job.status });
  });
}
