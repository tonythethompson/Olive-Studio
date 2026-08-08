/**
 * Shared Olive job start path for UI /olive/run and MCP /olive/jobs/submit.
 */
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

import { enrichRecipeMemoryOffloadForRun } from "../../../lib/memoryOffload.ts";
import { isGpuExecutionProvider } from "../../../lib/oliveGpuRuntime.ts";
import { resolveQnnHostMode } from "../../../lib/qnnDeps.ts";
import { assessQnnRecipeReadiness } from "../../../lib/qnnReadiness.ts";
import { DEFAULT_PASSES } from "../../../lib/defaultPasses.ts";
import type { HardwareProbeResult } from "../../../lib/hardwareProbe.ts";
import type { OliveJob, OliveRecipe } from "../../types.ts";
import {
  jobRegistry,
  getRuntimeHfToken,
  cleanupJobArtifacts,
  finalizeJob,
} from "./state.ts";
import { pushLog, startGpuMetricsTimer, stopGpuMetricsTimer } from "./gpu.ts";
import { probeQnn } from "./qnn.ts";
import { getVenvPython } from "../venv/paths.ts";
import {
  ensureProviderCapability,
  buildOliveRunEnvironment,
  resolveOliveCommand,
} from "../venv/index.ts";
import { preflightOliveRecipe } from "./jobPreflight.ts";
import { findJobByIdempotency, rememberIdempotencyKeys } from "./jobIdempotency.ts";

export type StartOliveJobOpts = {
  recipe: OliveRecipe;
  cudaVersion?: string;
  /** If omitted, derived from preflight. */
  fingerprint?: string;
  idempotencyKey?: string;
  source?: "ui" | "mcp";
  /** When false, skip preflight (caller already validated). Default true. */
  runPreflight?: boolean;
};

export type StartOliveJobResult =
  | { ok: true; jobId: string; reused: boolean; fingerprint: string; status: OliveJob["status"] }
  | { ok: false; error: string; httpStatus: number; fingerprint?: string; errors?: string[] };

/**
 * Create a job, run provider/env setup, and spawn Olive (async).
 * Returns immediately after spawn (or reuse) with jobId.
 */
export async function startOliveJob(opts: StartOliveJobOpts): Promise<StartOliveJobResult> {
  const cudaVersion = opts.cudaVersion ?? "auto";
  const runPreflight = opts.runPreflight !== false;

  let recipe = opts.recipe;
  let fingerprint = opts.fingerprint;
  let provider: string;

  if (runPreflight) {
    const pre = preflightOliveRecipe(recipe, cudaVersion);
    fingerprint = pre.fingerprint;
    if (!pre.valid || !pre.provider) {
      return {
        ok: false,
        error: pre.errors.join("; ") || "Recipe preflight failed",
        httpStatus: 400,
        fingerprint: pre.fingerprint,
        errors: pre.errors,
      };
    }
    recipe = pre.recipe;
    provider = pre.provider;
  } else {
    const pre = preflightOliveRecipe(recipe, cudaVersion);
    fingerprint = fingerprint ?? pre.fingerprint;
    if (!pre.provider) {
      return { ok: false, error: "Unknown execution provider", httpStatus: 400, fingerprint };
    }
    recipe = pre.recipe;
    provider = pre.provider;
    if (!pre.valid) {
      return {
        ok: false,
        error: pre.errors.join("; "),
        httpStatus: 400,
        fingerprint,
        errors: pre.errors,
      };
    }
  }

  const existing = findJobByIdempotency({
    idempotencyKey: opts.idempotencyKey,
    fingerprint,
  });
  if (existing) {
    return {
      ok: true,
      jobId: existing.id,
      reused: true,
      fingerprint: fingerprint ?? existing.fingerprint ?? "",
      status: existing.status,
    };
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
    fingerprint,
    idempotencyKey: opts.idempotencyKey,
    source: opts.source ?? "ui",
  };
  jobRegistry.set(jobId, job);
  rememberIdempotencyKeys(job);

  const bailIfCancelled = (): boolean => job.status === "cancelled";

  try {
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
    job.venvListener = undefined;
    if (bailIfCancelled()) {
      cleanupJobArtifacts(job);
      finalizeJob(job);
      return { ok: true, jobId, reused: false, fingerprint: fingerprint!, status: "cancelled" };
    }
    if (!capResult.ok) {
      job.status = "failed";
      pushLog(job, `[error] ${capResult.error}`);
      cleanupJobArtifacts(job);
      finalizeJob(job);
      return { ok: false, error: capResult.error, httpStatus: 500, jobId, fingerprint };
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
          return { ok: false, error, httpStatus: 400, jobId, fingerprint };
        }
      }
    }

    const env = await buildOliveRunEnvironment(venvPython, provider, process.env, capResult.family);
    if (bailIfCancelled()) {
      cleanupJobArtifacts(job);
      finalizeJob(job);
      return { ok: true, jobId, reused: false, fingerprint: fingerprint!, status: "cancelled" };
    }

    if (cudaVersion !== "auto") {
      env.CUDA_VERSION = cudaVersion;
    }

    const hfToken = getRuntimeHfToken() ?? process.env.HF_TOKEN;
    if (hfToken) env.HF_TOKEN = hfToken;

    const enrichedRecipe = enrichRecipeMemoryOffloadForRun(recipe, 0, 0);
    const tmpDir = path.join(process.cwd(), ".olive-runs");
    fs.mkdirSync(tmpDir, { recursive: true });
    const configPath = path.join(tmpDir, `recipe-${jobId}.json`);
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
      if (job.status !== "cancelled") {
        job.status = code === 0 ? "completed" : "failed";
      }
      stopGpuMetricsTimer(job);
      cleanupJobArtifacts(job);
      pushLog(job, `[done] Olive exited with code ${code ?? "unknown"}`);
      job.process = null;
      finalizeJob(job);
    });
    proc.on("error", (err) => {
      if (job.status !== "cancelled") {
        job.status = "failed";
      }
      pushLog(job, `[error] Failed to start Olive: ${err.message}`);
    });

    if (isGpuExecutionProvider(provider)) {
      startGpuMetricsTimer(job);
    }

    return { ok: true, jobId, reused: false, fingerprint: fingerprint!, status: job.status };
  } catch (err: unknown) {
    if (job.status !== "cancelled") {
      job.status = "failed";
    }
    cleanupJobArtifacts(job);
    const msg = err instanceof Error ? err.message : String(err);
    pushLog(job, `[error] ${msg}`);
    finalizeJob(job);
    return { ok: false, error: msg, httpStatus: 500, jobId, fingerprint };
  }
}
