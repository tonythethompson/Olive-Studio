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
import type { IHVProvider } from "../../../types.ts";

export type StartOliveJobOpts = {
  recipe: OliveRecipe;
  cudaVersion?: string;
  /**
   * Optional client-supplied fingerprint (e.g. from prior validate).
   * When set, must match the server-computed preflight fingerprint or start fails with 409.
   */
  fingerprint?: string;
  idempotencyKey?: string;
  source?: "ui" | "mcp";
};

export type StartOliveJobResult =
  | {
      ok: true;
      jobId: string;
      reused: boolean;
      fingerprint: string;
      status: OliveJob["status"];
      /** Epoch ms when the job was first registered (stable on idempotent replay). */
      submittedAt: number;
    }
  | {
      ok: false;
      error: string;
      httpStatus: number;
      fingerprint?: string;
      errors?: string[];
      jobId?: string;
    };

/** Per-key promise tails that serialize MCP submit critical sections. */
const mcpSubmitLockTails = new Map<string, Promise<void>>();

/** Test helper: number of live MCP submit-lock tails (should be 0 when idle). */
export function mcpSubmitLockTailCount(): number {
  return mcpSubmitLockTails.size;
}

/**
 * Acquire exclusive tails for the given lock keys (sorted to avoid deadlocks).
 * Callers with overlapping fingerprint/key sets cannot both pass lookup-and-register.
 */
async function withMcpSubmitLocks<T>(keys: string[], fn: () => Promise<T>): Promise<T> {
  const sorted = [...new Set(keys)].sort();
  const releases: Array<() => void> = [];
  /** Tails we installed; delete only if still ours (a newer waiter may have replaced them). */
  const installed: Array<{ key: string; tail: Promise<void> }> = [];
  try {
    for (const key of sorted) {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const prev = mcpSubmitLockTails.get(key) ?? Promise.resolve();
      // Chain: next waiter awaits prev, then our held promise until we release.
      const tail = prev.then(
        () => held,
        () => held,
      );
      mcpSubmitLockTails.set(key, tail);
      installed.push({ key, tail });
      await prev;
      releases.push(release);
    }
    return await fn();
  } finally {
    while (releases.length > 0) {
      releases.pop()!();
    }
    // Evict only our installed tails. If a newer waiter replaced the map entry,
    // leave theirs in place so cleanup never drops an active chain link.
    for (const { key, tail } of installed) {
      if (mcpSubmitLockTails.get(key) === tail) {
        mcpSubmitLockTails.delete(key);
      }
    }
  }
}

/**
 * Validates a recipe, prepares its execution environment, and starts an Olive job or reuses an idempotent MCP submission.
 *
 * @param opts - Recipe, provider, client fingerprint, idempotency, and submission-source options
 * @returns The job identifier and status, or details of the validation, setup, or execution failure
 */
export async function startOliveJob(opts: StartOliveJobOpts): Promise<StartOliveJobResult> {
  const cudaVersion = opts.cudaVersion ?? "auto";
  const clientFingerprint = opts.fingerprint;

  const pre = preflightOliveRecipe(opts.recipe, cudaVersion);
  if (!pre.valid || !pre.provider) {
    return {
      ok: false,
      error: pre.errors.join("; ") || "Recipe preflight failed",
      httpStatus: 400,
      fingerprint: pre.fingerprint,
      errors: pre.errors,
    };
  }
  // Client fingerprint is a precondition: never let start overwrite a mismatch.
  if (clientFingerprint && clientFingerprint !== pre.fingerprint) {
    return {
      ok: false,
      error: "Recipe fingerprint mismatch",
      httpStatus: 409,
      fingerprint: pre.fingerprint,
    };
  }

  const recipe = pre.recipe;
  const fingerprint = pre.fingerprint;
  const provider = pre.provider;

  // Idempotency is for MCP/agent submit only — UI re-runs should always spawn.
  if (opts.source === "mcp") {
    // Always lock the recipe fingerprint so key-bearing and fingerprint-only
    // callers cannot both observe a miss and spawn duplicate jobs. Also lock
    // the idempotency key when present so same-key conflict checks serialize.
    const lockKeys = [`fp:${fingerprint}`];
    if (opts.idempotencyKey) lockKeys.push(`key:${opts.idempotencyKey}`);
    return withMcpSubmitLocks(lockKeys, () =>
      startMcpOliveJobLocked({
        recipe,
        provider,
        cudaVersion,
        fingerprint,
        idempotencyKey: opts.idempotencyKey,
      }),
    );
  }

  return registerAndStartOliveJob({
    recipe,
    provider,
    cudaVersion,
    fingerprint,
    idempotencyKey: opts.idempotencyKey,
    source: opts.source ?? "ui",
  });
}

async function startMcpOliveJobLocked(opts: {
  recipe: OliveRecipe;
  provider: IHVProvider;
  cudaVersion: string;
  fingerprint: string;
  idempotencyKey?: string;
}): Promise<StartOliveJobResult> {
  const lookup = findJobByIdempotency({
    idempotencyKey: opts.idempotencyKey,
    fingerprint: opts.fingerprint,
  });
  if (lookup.kind === "conflict") {
    return {
      ok: false,
      error: lookup.reason,
      httpStatus: 409,
      jobId: lookup.job.id,
      fingerprint: lookup.job.fingerprint ?? opts.fingerprint,
    };
  }
  if (lookup.kind === "hit") {
    // Attach the arriving key onto a fingerprint-only job so later same-key
    // replays hit the key index directly.
    if (opts.idempotencyKey && !lookup.job.idempotencyKey) {
      lookup.job.idempotencyKey = opts.idempotencyKey;
      rememberIdempotencyKeys(lookup.job);
    }
    const submittedAt = lookup.job.submittedAt ?? Date.now();
    if (lookup.job.submittedAt == null) lookup.job.submittedAt = submittedAt;
    return {
      ok: true,
      jobId: lookup.job.id,
      reused: true,
      fingerprint: lookup.job.fingerprint ?? opts.fingerprint,
      status: lookup.job.status,
      submittedAt,
    };
  }

  return registerAndStartOliveJob({
    recipe: opts.recipe,
    provider: opts.provider,
    cudaVersion: opts.cudaVersion,
    fingerprint: opts.fingerprint,
    idempotencyKey: opts.idempotencyKey,
    source: "mcp",
  });
}

async function registerAndStartOliveJob(opts: {
  recipe: OliveRecipe;
  provider: IHVProvider;
  cudaVersion: string;
  fingerprint: string;
  idempotencyKey?: string;
  source: "ui" | "mcp";
}): Promise<StartOliveJobResult> {
  const { recipe, provider, cudaVersion, fingerprint } = opts;
  const jobId = uuidv4();
  const submittedAt = Date.now();
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
    submittedAt,
    doneSubscribers: [],
    fingerprint,
    idempotencyKey: opts.idempotencyKey,
    source: opts.source,
  };
  jobRegistry.set(jobId, job);
  // Index only MCP submissions so agent idempotency cannot absorb UI runs.
  if (opts.source === "mcp") {
    rememberIdempotencyKeys(job);
  }

  // MCP submit must return a queued job id quickly (agent contract / MCP timeouts).
  // UI /olive/run keeps awaiting setup so the first response reflects spawn readiness.
  if (opts.source === "mcp") {
    void continueOliveJobSetup(job, {
      recipe,
      provider,
      cudaVersion,
      fingerprint,
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (job.status === "cancelled") return;
      job.status = "failed";
      pushLog(job, `[error] ${msg}`);
      cleanupJobArtifacts(job);
      finalizeJob(job);
    });
    return {
      ok: true,
      jobId,
      reused: false,
      fingerprint,
      status: "setting_up",
      submittedAt,
    };
  }

  return continueOliveJobSetup(job, {
    recipe,
    provider,
    cudaVersion,
    fingerprint,
  });
}

async function continueOliveJobSetup(
  job: OliveJob,
  opts: {
    recipe: OliveRecipe;
    provider: IHVProvider;
    cudaVersion: string;
    fingerprint: string;
  },
): Promise<StartOliveJobResult> {
  const { recipe, provider, cudaVersion, fingerprint } = opts;
  const jobId = job.id;
  const submittedAt = job.submittedAt ?? Date.now();
  const bailIfCancelled = (): boolean => job.status === "cancelled";

  // Smoke/CI: park in setting_up without venv/model downloads or `olive run`.
  // Cancel (or external finalize) ends the wait. See scripts/mcp-agent-smoke.mjs.
  const stubSetup = ["1", "true", "yes", "on"].includes(
    (process.env.OLIVE_JOB_SETUP_STUB ?? "").trim().toLowerCase(),
  );
  if (stubSetup) {
    pushLog(job, "[stub] Olive job setup stubbed; waiting for cancel.");
    const rawTimeout = Number(process.env.OLIVE_JOB_SETUP_STUB_TIMEOUT_MS);
    const stubTimeoutMs =
      Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 120_000;
    const deadline = Date.now() + stubTimeoutMs;
    let timedOut = false;
    // Exit when cancelled, externally finalized, or the stub wait times out.
    while (job.status === "setting_up" && job.finishedAt == null) {
      if (Date.now() >= deadline) {
        timedOut = true;
        job.status = "failed";
        pushLog(
          job,
          `[stub] Setup stub timed out after ${stubTimeoutMs}ms waiting for cancel/finalize.`,
        );
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    cleanupJobArtifacts(job);
    if (job.finishedAt == null) finalizeJob(job);
    if (timedOut) {
      return {
        ok: false,
        error: `Setup stub timed out after ${stubTimeoutMs}ms waiting for cancel/finalize.`,
        httpStatus: 504,
        jobId,
        fingerprint,
      };
    }
    return {
      ok: true,
      jobId,
      reused: false,
      fingerprint,
      status: job.status,
      submittedAt,
    };
  }

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
      return { ok: true, jobId, reused: false, fingerprint, status: "cancelled", submittedAt };
    }
    if (!capResult.ok) {
      const error = capResult.error ?? "Provider capability setup failed";
      job.status = "failed";
      pushLog(job, `[error] ${error}`);
      cleanupJobArtifacts(job);
      finalizeJob(job);
      return { ok: false, error, httpStatus: 500, jobId, fingerprint };
    }

    const venvPython = capResult.python ?? getVenvPython(capResult.family);

    if (provider === "QNNExecutionProvider" && venvPython) {
      const hostMode = resolveQnnHostMode({ platform: process.platform, arch: process.arch });
      if (hostMode === "local-inference") {
        const qnn = await probeQnn(venvPython);
        // Cancel may land during the awaited probe — do not mark failed after cancel.
        if (bailIfCancelled()) {
          cleanupJobArtifacts(job);
          finalizeJob(job);
          return { ok: true, jobId, reused: false, fingerprint, status: "cancelled", submittedAt };
        }
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
      return { ok: true, jobId, reused: false, fingerprint, status: "cancelled", submittedAt };
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

    return { ok: true, jobId, reused: false, fingerprint, status: job.status, submittedAt };
  } catch (err: unknown) {
    cleanupJobArtifacts(job);
    // Prefer cancelled outcome over a setup failure if cancel won the race.
    if (job.status === "cancelled" || bailIfCancelled()) {
      job.status = "cancelled";
      finalizeJob(job);
      return { ok: true, jobId, reused: false, fingerprint, status: "cancelled", submittedAt };
    }
    job.status = "failed";
    const msg = err instanceof Error ? err.message : String(err);
    pushLog(job, `[error] ${msg}`);
    finalizeJob(job);
    return { ok: false, error: msg, httpStatus: 500, jobId, fingerprint };
  }
}
