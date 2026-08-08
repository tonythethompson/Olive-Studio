/**
 * Olive execution route handlers.
 * Recipe validation, job execution, SSE streaming, GPU metrics.
 */
import type { Router } from "express";

import type { GpuMetrics } from "../../lib/gpuMetrics.ts";

import {
  jobRegistry,
  startJobRegistrySweeper,
  finalizeJob,
} from "../services/olive/state.ts";
import { pushLog, stopGpuMetricsTimer, MAX_JOB_LOG_LINES } from "../services/olive/gpu.ts";
import { detachVenvListener } from "../services/venv/index.ts";
import type { OliveRecipe, AgentAccessPolicy } from "../types.ts";
import { oliveRunRateLimit } from "../middleware/rateLimit.ts";
import { isParseBodyError, parseBody } from "../middleware/bodyGuard.ts";
import { studioLocalOnly } from "../middleware/localOnly.ts";
import { preflightOliveRecipe } from "../services/olive/jobPreflight.ts";
import { startOliveJob } from "../services/olive/jobRunner.ts";
import { denyUnless, getAgentAccessPublic, updateAgentAccess } from "../services/olive/agentAccess.ts";

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
    const body = parseBody<{ recipeJson: string; cudaVersion?: string }>(req.body, {
      recipeJson: { type: "string", message: "Missing recipeJson" },
      cudaVersion: { type: "string", required: false },
    });
    if (isParseBodyError(body)) return res.status(400).json({ ok: false, error: body.error });
    const { recipeJson, cudaVersion = "auto" } = body.parsed;

    let recipe: OliveRecipe;
    try {
      recipe = JSON.parse(recipeJson);
    } catch {
      return res.status(400).json({ ok: false, error: "Invalid recipe JSON" });
    }

    const result = await startOliveJob({ recipe, cudaVersion, source: "ui" });
    if (!result.ok) {
      return res.status(result.httpStatus).json({
        ok: false,
        error: result.error,
        jobId: "jobId" in result ? result.jobId : undefined,
      });
    }
    if (result.status === "cancelled") {
      return res.json({ ok: false, jobId: result.jobId, status: "cancelled" });
    }
    return res.json({ ok: true, jobId: result.jobId, reused: result.reused });
  });

  // ─── Agent access policy (Studio-owned; loopback-only) ────────────────
  router.get("/olive/agent-access", studioLocalOnly, (_req, res) => {
    return res.json({ ok: true, policy: getAgentAccessPublic() });
  });

  router.put("/olive/agent-access", studioLocalOnly, oliveRunRateLimit, (req, res) => {
    // parseBody requires Record<string, unknown>; AgentAccessPolicy has no index signature.
    // Trust boundary: studioLocalOnly (loopback) — same as other Studio-owned agent routes.
    type AgentAccessBody = AgentAccessPolicy & Record<string, unknown>;
    const body = parseBody<AgentAccessBody>(req.body ?? {}, {
      mcpAccess: { type: "boolean", required: false },
      allowJobInspection: { type: "boolean", required: false },
      allowRecipeChanges: { type: "boolean", required: false },
      allowJobSubmission: { type: "boolean", required: false },
      allowJobCancellation: { type: "boolean", required: false },
    });
    if (isParseBodyError(body)) return res.status(400).json({ ok: false, error: body.error });
    const policy = updateAgentAccess(body.parsed);
    return res.json({ ok: true, policy });
  });

  // ─── POST /api/olive/jobs/validate (no Olive spawn; loopback + policy) ─
  router.post("/olive/jobs/validate", studioLocalOnly, oliveRunRateLimit, (req, res) => {
    const gate = denyUnless((p) => p.allowJobInspection || p.allowJobSubmission, "Job validation not allowed");
    if (!gate.ok) {
      return res.status(403).json({
        ok: false,
        error: gate.error,
        reason: gate.reason,
        ...("required" in gate && gate.required ? { required: gate.required } : {}),
      });
    }

    const body = parseBody<{ recipeJson?: string; recipe?: unknown; cudaVersion?: string }>(
      req.body ?? {},
      {
        recipeJson: { type: "string", required: false },
        recipe: { type: "object", required: false },
        cudaVersion: { type: "string", required: false },
      },
    );
    if (isParseBodyError(body)) return res.status(400).json({ ok: false, error: body.error });

    let recipe: OliveRecipe;
    try {
      if (typeof body.parsed.recipeJson === "string") {
        recipe = JSON.parse(body.parsed.recipeJson) as OliveRecipe;
      } else if (body.parsed.recipe && typeof body.parsed.recipe === "object") {
        recipe = body.parsed.recipe as OliveRecipe;
      } else {
        return res.status(400).json({ ok: false, error: "Missing recipe or recipeJson" });
      }
    } catch {
      return res.status(400).json({ ok: false, error: "Invalid recipe JSON" });
    }

    const pre = preflightOliveRecipe(recipe, body.parsed.cudaVersion ?? "auto");
    return res.json({
      ok: true,
      valid: pre.valid,
      fingerprint: pre.fingerprint,
      provider: pre.provider,
      errors: pre.errors,
      warnings: pre.warnings,
      cudaVersion: pre.cudaVersion,
      // Omit full recipe by default to keep payloads small; include when valid for submit.
      recipe_summary: {
        has_input_model: Boolean(pre.recipe.input_model),
        pass_count: pre.recipe.passes ? Object.keys(pre.recipe.passes).length : 0,
      },
    });
  });

  // ─── POST /api/olive/jobs/submit (MCP / agents; loopback + policy) ────
  router.post("/olive/jobs/submit", studioLocalOnly, oliveRunRateLimit, async (req, res) => {
    const gate = denyUnless((p) => p.allowJobSubmission, "Job submission is disabled in Studio agent access settings");
    if (!gate.ok) {
      return res.status(403).json({
        ok: false,
        error: gate.error,
        reason: gate.reason,
        ...("required" in gate && gate.required ? { required: gate.required } : {}),
      });
    }

    const body = parseBody<{
      recipeJson?: string;
      recipe?: unknown;
      cudaVersion?: string;
      fingerprint?: string;
      idempotencyKey?: string;
    }>(req.body ?? {}, {
      recipeJson: { type: "string", required: false },
      recipe: { type: "object", required: false },
      cudaVersion: { type: "string", required: false },
      fingerprint: { type: "string", required: false },
      idempotencyKey: { type: "string", required: false },
    });
    if (isParseBodyError(body)) return res.status(400).json({ ok: false, error: body.error });

    let recipe: OliveRecipe;
    try {
      if (typeof body.parsed.recipeJson === "string") {
        recipe = JSON.parse(body.parsed.recipeJson) as OliveRecipe;
      } else if (body.parsed.recipe && typeof body.parsed.recipe === "object") {
        recipe = body.parsed.recipe as OliveRecipe;
      } else {
        return res.status(400).json({ ok: false, error: "Missing recipe or recipeJson" });
      }
    } catch {
      return res.status(400).json({ ok: false, error: "Invalid recipe JSON" });
    }

    const result = await startOliveJob({
      recipe,
      cudaVersion: body.parsed.cudaVersion ?? "auto",
      fingerprint: body.parsed.fingerprint,
      idempotencyKey: body.parsed.idempotencyKey,
      source: "mcp",
    });

    if (!result.ok) {
      return res.status(result.httpStatus).json({
        ok: false,
        error: result.error,
        jobId: result.jobId,
        fingerprint: result.fingerprint,
        errors: result.errors,
      });
    }

    return res.json({
      ok: true,
      job_id: result.jobId,
      jobId: result.jobId,
      state: result.status,
      status: result.status,
      fingerprint: result.fingerprint,
      reused: result.reused,
      submitted_at: new Date().toISOString(),
    });
  });

  // ─── SSE Stream (loopback; MCP agents need inspection policy) ─────────
  router.get("/olive/stream/:jobId", studioLocalOnly, (req, res) => {
    // Agents must not opt out of policy by omitting the MCP header: when the
    // header is present, require inspection. UI (no header) is loopback-only.
    if (req.get("x-olive-mcp-agent") === "1") {
      const gate = denyUnless(
        (p) => p.allowJobInspection,
        "Job inspection is disabled in Studio agent access settings",
      );
      if (!gate.ok) {
        return res.status(403).json({
        ok: false,
        error: gate.error,
        reason: gate.reason,
        ...("required" in gate && gate.required ? { required: gate.required } : {}),
      });
      }
    }
    const jobIdParam = req.params.jobId;
    const jobId = Array.isArray(jobIdParam) ? jobIdParam[0] : jobIdParam;
    const job = jobId ? jobRegistry.get(jobId) : undefined;
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") res.flushHeaders();

    if (job.logsTruncated) {
      writeNamedSse(res, "log", {
        line: `[info] Earlier log lines were trimmed to bound memory (retaining last ${MAX_JOB_LOG_LINES}).`,
      });
    }
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

  // ─── Job Status (loopback; MCP agents need inspection policy) ─────────
  router.get("/olive/status/:jobId", studioLocalOnly, (req, res) => {
    // Same pattern as stream: remote blocked by loopback; MCP header ⇒ policy.
    // Omitting the header is not a remote bypass (studioLocalOnly already ran).
    if (req.get("x-olive-mcp-agent") === "1") {
      const gate = denyUnless(
        (p) => p.allowJobInspection,
        "Job inspection is disabled in Studio agent access settings",
      );
      if (!gate.ok) {
        return res.status(403).json({
        ok: false,
        error: gate.error,
        reason: gate.reason,
        ...("required" in gate && gate.required ? { required: gate.required } : {}),
      });
      }
    }
    const jobIdParam = req.params.jobId;
    const jobId = Array.isArray(jobIdParam) ? jobIdParam[0] : jobIdParam;
    const job = jobId ? jobRegistry.get(jobId) : undefined;
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }
    return res.json({
      id: job.id,
      status: job.status,
      exitCode: job.exitCode,
      logs: job.logs,
      logsTruncated: Boolean(job.logsTruncated),
      latestMetrics: job.latestMetrics,
      finishedAt: job.finishedAt,
    });
  });

  // ─── Job list (in-memory registry; loopback + policy for MCP) ─────────
  router.get("/olive/jobs", studioLocalOnly, (_req, res) => {
    const gate = denyUnless((p) => p.allowJobInspection, "Job inspection is disabled in Studio agent access settings");
    if (!gate.ok) {
      return res.status(403).json({
        ok: false,
        error: gate.error,
        reason: gate.reason,
        ...("required" in gate && gate.required ? { required: gate.required } : {}),
      });
    }
    const jobs = Array.from(jobRegistry.values())
      .map((job) => ({
        id: job.id,
        status: job.status,
        exitCode: job.exitCode,
        finishedAt: job.finishedAt,
        logsTruncated: Boolean(job.logsTruncated),
        logCount: job.logs.length,
        hasMetrics: job.latestMetrics != null,
        fingerprint: job.fingerprint ?? null,
        source: job.source ?? "ui",
      }))
      // Map insertion order is start order; reverse so newest jobs appear first.
      .reverse();
    return res.json({ ok: true, count: jobs.length, jobs });
  });

  // ─── Cancel (loopback; MCP agents need cancellation policy) ───────────
  router.post("/olive/cancel", studioLocalOnly, (req, res) => {
    // express.json() leaves body undefined when the client sends no payload;
    // optional jobId means an empty object preserves the 404 "Job not found" contract.
    // Preserve null so parseBody can reject an explicit JSON null body.
    const body = parseBody<{ jobId?: string; client?: string }>(req.body === undefined ? {} : req.body, {
      jobId: { type: "string", required: false },
      client: { type: "string", required: false },
    });
    if (isParseBodyError(body)) return res.status(400).json({ error: body.error });
    const { jobId } = body.parsed;

    // Loopback blocks remote cancel. MCP agents (header set by Studio proxy /
    // studio_request) still need allowJobCancellation — header cannot be used
    // to *skip* policy; it only selects the stricter agent path. Body `client`
    // is not authorization.
    if (req.get("x-olive-mcp-agent") === "1") {
      const gate = denyUnless(
        (p) => p.allowJobCancellation,
        "Job cancellation is disabled in Studio agent access settings",
      );
      if (!gate.ok) {
        return res.status(403).json({
        ok: false,
        error: gate.error,
        reason: gate.reason,
        ...("required" in gate && gate.required ? { required: gate.required } : {}),
      });
      }
    }

    const job = jobId ? jobRegistry.get(jobId) : undefined;
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
