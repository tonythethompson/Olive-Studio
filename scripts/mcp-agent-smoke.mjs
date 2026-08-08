/**
 * Pinned mcporter canary smoke for Olive MCP (Phase 0 + job-control path).
 * Non-blocking by default (exit 0 on failure). Set MCP_SMOKE_STRICT=1 to fail the job.
 *
 * Covers:
 *   - list --status, get_olive_passes, get_mcp_capabilities (against live Studio env)
 *   - policy-gated submit / status / cancel / idempotent reuse via MCP → Studio
 *   - one allowed job (reuse + terminal cancel) and one denied submit
 *
 * Studio is started with OLIVE_JOB_SETUP_STUB=1 so submits never download models
 * or run Olive (AGENTS.md: no real Olive execute in CI/VM).
 *
 * Usage (repo root):
 *   node scripts/mcp-agent-smoke.mjs
 *   pnpm mcp:agent-smoke
 */
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readStudioConfigFileContents,
  restoreStudioConfigFile,
  snapshotStudioConfigFile,
} from "./studioConfigSnapshot.mjs";
import {
  acquireStudioConfigSmokeLock,
  tryRemoveEmptyStudioConfigDir,
} from "./studioConfigSmokeLock.mjs";
import { stopStudioThenAlways } from "./stopStudioThenAlways.mjs";
import { resolvePython } from "./resolvePython.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const MCPORTER = "mcporter@0.13.0";
const STUDIO_CONFIG_PATH = path.join(root, ".olive-studio", "config.json");
const STUDIO_CONFIG_SMOKE_LOCK = path.join(
  root,
  ".olive-studio",
  "mcp-agent-smoke.lock",
);
const STRICT = process.env.MCP_SMOKE_STRICT === "1";

/** Minimal CPU recipe accepted by Studio preflight (no real Olive execute required). */
const SMOKE_RECIPE = {
  input_model: { type: "PyTorchModel", config: {} },
  systems: {
    local_system: {
      type: "LocalSystem",
      config: {
        accelerators: [
          { device: "cpu", execution_providers: ["CPUExecutionProvider"] },
        ],
      },
    },
  },
  passes: {
    conversion: { type: "OnnxConversion", config: { target_opset: 20 } },
  },
  engine: {
    search_strategy: false,
    host: "local_system",
    target: "local_system",
    cache_dir: "./cache",
    output_dir: "./out",
  },
};

function writeSmokeMcporterConfig() {
  const dir = mkdtempSync(path.join(tmpdir(), "olive-mcp-agent-smoke-"));
  const configPath = path.join(dir, "mcporter.json");
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        mcpServers: {
          olive: {
            command: resolvePython(root),
            args: [path.join(root, "olive-mcp-server", "run.py")],
            cwd: root,
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  return { dir, configPath };
}

function readStudioDiskConfig() {
  if (!existsSync(STUDIO_CONFIG_PATH)) return {};
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(STUDIO_CONFIG_PATH, "utf8"));
  } catch (e) {
    throw new Error(
      `refusing to patch unreadable Studio config at ${STUDIO_CONFIG_PATH}: ${
        e instanceof Error ? e.message : e
      }`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`unexpected Studio config shape at ${STUDIO_CONFIG_PATH}`);
  }
  return parsed;
}

/** Patch agentAccess on disk — resolveAgentAccess re-reads each request (avoids PUT rate limit). */
function patchAgentAccessDisk(patch) {
  const cfg = readStudioDiskConfig();
  cfg.agentAccess = { ...(cfg.agentAccess || {}), ...patch };
  mkdirSync(path.dirname(STUDIO_CONFIG_PATH), { recursive: true });
  writeFileSync(STUDIO_CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
  // Remember exact bytes we wrote so cleanup can refuse to clobber concurrent edits.
  lastSmokeConfigBytes = readStudioConfigFileContents(STUDIO_CONFIG_PATH);
  return cfg.agentAccess;
}

/**
 * Runs a pinned mcporter command with the selected configuration.
 * @param {string[]} args
 * @param {{ timeoutMs?: number, env?: NodeJS.ProcessEnv, expectOk?: boolean }} [opts]
 */
function run(args, opts = {}) {
  const { timeoutMs = 90_000, env = process.env, expectOk = true } = opts;
  const full = ["--yes", MCPORTER, ...args, "--config", smokeConfigPath];
  console.log(`$ npx ${full.join(" ")}`);
  const r = spawnSync("npx", full, {
    cwd: root,
    encoding: "utf8",
    timeout: timeoutMs,
    shell: process.platform === "win32",
    env: { ...env },
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (expectOk && r.status !== 0) {
    throw new Error(`mcporter failed status=${r.status} signal=${r.signal}`);
  }
  return r;
}

/** @param {string} stdout */
function parseJsonPayload(stdout) {
  const text = (stdout || "").trim();
  if (!text) throw new Error("empty mcporter stdout");
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch !== "{" && ch !== "[") continue;
    try {
      return JSON.parse(text.slice(i));
    } catch {
      /* not a complete document at this offset */
    }
  }
  throw new Error(`no JSON in mcporter stdout: ${text.slice(0, 200)}`);
}

/**
 * @param {string} selector
 * @param {Record<string, unknown>} [toolArgs]
 * @param {{ timeoutMs?: number, env?: NodeJS.ProcessEnv }} [opts]
 */
function callToolAsync(selector, toolArgs, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const args = ["call", selector];
  if (toolArgs && Object.keys(toolArgs).length > 0) {
    args.push("--args", JSON.stringify(toolArgs));
  }
  args.push("--timeout", String(timeoutMs), "--output", "json");
  const full = ["--yes", MCPORTER, ...args, "--config", smokeConfigPath];
  console.log(`$ npx ${full.join(" ")}`);

  return new Promise((resolve, reject) => {
    const child = spawn("npx", full, {
      cwd: root,
      env: { ...(opts.env ?? process.env) },
      shell: process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let killEscalation;
    const graceMs = 15_000;
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      killEscalation = setTimeout(() => {
        try {
          // `killed` can be true after SIGTERM even while the process is still running;
          // exit/signal codes are the authoritative "already exited" check.
          if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
          }
        } catch {
          /* ignore */
        }
      }, 2000);
      reject(
        new Error(
          `mcporter ${selector} timed out after ${timeoutMs + graceMs}ms`,
        ),
      );
    }, timeoutMs + graceMs);
    const clearTimers = () => {
      clearTimeout(timer);
      if (killEscalation) clearTimeout(killEscalation);
    };
    child.stdout?.on("data", (buf) => {
      const s = String(buf);
      stdout += s;
      process.stdout.write(s);
    });
    child.stderr?.on("data", (buf) => {
      const s = String(buf);
      stderr += s;
      process.stderr.write(s);
    });
    child.on("error", (err) => {
      clearTimers();
      reject(err);
    });
    child.on("close", (code) => {
      clearTimers();
      if (code !== 0) {
        reject(
          new Error(
            `mcporter ${selector} exited ${code}: ${(stderr || stdout).slice(0, 400)}`,
          ),
        );
        return;
      }
      try {
        resolve(parseJsonPayload(stdout));
      } catch (e) {
        reject(e);
      }
    });
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
    s.on("error", reject);
  });
}

/**
 * @param {string} baseUrl
 * @param {import("node:child_process").ChildProcess} child
 * @param {number} [timeoutMs]
 */
async function waitForStudio(baseUrl, child, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = "";
  let exited = /** @type {string | null} */ (null);
  child?.once("exit", (code, signal) => {
    exited = `studio exited code=${code} signal=${signal}`;
  });
  while (Date.now() < deadline) {
    if (exited) throw new Error(exited);
    try {
      const res = await fetch(`${baseUrl}/api/olive/agent-access`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) return;
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Studio did not become ready at ${baseUrl}: ${lastErr}`);
}

/** @param {number} port */
function startStudio(port) {
  const env = { ...process.env, PORT: String(port), OLIVE_JOB_SETUP_STUB: "1" };
  // Disk policy must win for the deny path; strip inherited job-policy overrides.
  delete env.OLIVE_MCP_ALLOW_JOBS;
  const child = spawn("pnpm", ["exec", "tsx", "server.ts"], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  child.stdout?.on("data", (buf) => process.stdout.write(`[studio] ${buf}`));
  child.stderr?.on("data", (buf) => process.stderr.write(`[studio] ${buf}`));
  return child;
}

/** @param {import("node:child_process").ChildProcess | null} child */
async function stopStudio(child) {
  if (!child) return;
  let closed = child.exitCode !== null || child.signalCode !== null;
  if (closed) return;

  let resolveClosed;
  const closedPromise = new Promise((resolve) => {
    resolveClosed = resolve;
  });
  child.once("close", () => {
    closed = true;
    resolveClosed();
  });

  try {
    child.kill("SIGTERM");
  } catch {
    /* ignore */
  }

  await Promise.race([
    closedPromise,
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  if (!closed) {
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
    await Promise.race([
      closedPromise,
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  }
}

/**
 * @param {string} jobId
 * @param {NodeJS.ProcessEnv} env
 * @param {number} [timeoutMs]
 */
async function waitForTerminal(jobId, env, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await callToolAsync(
      "olive.get_optimization_job",
      { job_id: jobId },
      { timeoutMs: 60_000, env },
    );
    if (last.terminal === true) return last;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`job ${jobId} not terminal: ${JSON.stringify(last)}`);
}

const { dir: smokeConfigDir, configPath: smokeConfigPath } = writeSmokeMcporterConfig();
let studioChild = null;
/** @type {import("./studioConfigSnapshot.mjs").StudioConfigSnapshot | null} */
let configSnapshot = null;
/**
 * Exact bytes last written by this smoke (`null` if we observed absence after a write path).
 * `undefined` means we have not mutated the file yet.
 * @type {string | null | undefined}
 */
let lastSmokeConfigBytes = undefined;
/** Set when snapshot restore throws so callers cannot exit 0 with a dirty policy file. */
let configRestoreError = /** @type {unknown | null} */ (null);
/** @type {null | (() => void)} */
let releaseSmokeConfigLock = null;

async function runJobControlSmoke() {
  // Serialize overlapping smokes so we never snapshot another run's temporary
  // allowJobSubmission:true (or leave it restored afterward).
  const lock = await acquireStudioConfigSmokeLock(STUDIO_CONFIG_SMOKE_LOCK);
  releaseSmokeConfigLock = lock.release;

  // Snapshot only after the lock is held (exact bytes + existence).
  configSnapshot = snapshotStudioConfigFile(STUDIO_CONFIG_PATH);

  // Denied path: submission off before Studio boots (no PUT / rate-limit burn).
  patchAgentAccessDisk({
    allowJobSubmission: false,
    allowJobCancellation: true,
  });

  const port = await freePort();
  const studioBase = `http://127.0.0.1:${port}`;
  studioChild = startStudio(port);
  await waitForStudio(studioBase, studioChild);

  const studioEnv = { ...process.env, OLIVE_STUDIO_API_URL: studioBase };
  delete studioEnv.OLIVE_MCP_ALLOW_JOBS;

  run(["list", "olive", "--status", "--timeout", "60000"], { env: studioEnv });
  run(
    [
      "call",
      "olive.get_olive_passes",
      "filter=quantization",
      "--timeout",
      "60000",
      "--output",
      "json",
    ],
    { env: studioEnv },
  );
  run(
    [
      "call",
      "olive.get_mcp_capabilities",
      "--timeout",
      "90000",
      "--output",
      "json",
    ],
    { timeoutMs: 120_000, env: studioEnv },
  );

  const idempotencyKey = `mcp-agent-smoke-${Date.now()}-${process.pid}`;

  const denied = await callToolAsync(
    "olive.submit_optimization_job",
    {
      recipe: SMOKE_RECIPE,
      cuda_version: "auto",
      idempotency_key: `${idempotencyKey}-denied`,
    },
    { timeoutMs: 120_000, env: studioEnv },
  );
  if (denied.ok !== false || denied.error !== "forbidden") {
    throw new Error(`expected forbidden denial, got ${JSON.stringify(denied)}`);
  }
  if (
    typeof denied.reason === "string" &&
    !/submission is disabled/i.test(denied.reason)
  ) {
    throw new Error(`unexpected deny reason: ${JSON.stringify(denied)}`);
  }
  console.log("denied submit ok (forbidden)");

  patchAgentAccessDisk({
    allowJobSubmission: true,
    allowJobCancellation: true,
  });

  const submitArgs = {
    recipe: SMOKE_RECIPE,
    cuda_version: "auto",
    idempotency_key: idempotencyKey,
  };
  // Same-key reuse + distinct-key new job (Studio contract; setup is stubbed).
  const [first, second, third] = await Promise.all([
    callToolAsync("olive.submit_optimization_job", submitArgs, {
      timeoutMs: 120_000,
      env: studioEnv,
    }),
    callToolAsync("olive.submit_optimization_job", submitArgs, {
      timeoutMs: 120_000,
      env: studioEnv,
    }),
    callToolAsync(
      "olive.submit_optimization_job",
      {
        recipe: SMOKE_RECIPE,
        cuda_version: "auto",
        idempotency_key: `${idempotencyKey}-other`,
      },
      { timeoutMs: 120_000, env: studioEnv },
    ),
  ]);
  if (!first.ok || !second.ok || !third.ok) {
    throw new Error(`submit failed: ${JSON.stringify({ first, second, third })}`);
  }
  if (first.job_id !== second.job_id) {
    throw new Error(
      `idempotency split jobs: ${JSON.stringify({ first, second })}`,
    );
  }
  if (!first.reused && !second.reused) {
    throw new Error(
      `expected one reused submit, got ${JSON.stringify({ first, second })}`,
    );
  }
  if (third.job_id === first.job_id) {
    throw new Error(
      `distinct key unexpectedly reused job: ${JSON.stringify({ first, third })}`,
    );
  }
  const jobId = first.job_id;
  console.log(
    `submit+reuse ok job_id=${jobId} reused=${first.reused}|${second.reused} other=${third.job_id}`,
  );

  const midStatus = await callToolAsync(
    "olive.get_optimization_job",
    { job_id: jobId },
    { timeoutMs: 60_000, env: studioEnv },
  );
  if (midStatus.id !== jobId) {
    throw new Error(`status id mismatch: ${JSON.stringify(midStatus)}`);
  }
  console.log(`status ok status=${midStatus.status} terminal=${midStatus.terminal}`);

  const cancelled = await callToolAsync(
    "olive.cancel_optimization_job",
    { job_id: jobId },
    { timeoutMs: 60_000, env: studioEnv },
  );
  const terminal = await waitForTerminal(jobId, studioEnv, 60_000);
  if (terminal.status !== "cancelled" || terminal.terminal !== true) {
    throw new Error(
      `expected terminal cancelled, got ${JSON.stringify({ cancelled, terminal })}`,
    );
  }
  console.log("allowed job terminal+reuse ok");

  try {
    await callToolAsync(
      "olive.cancel_optimization_job",
      { job_id: third.job_id },
      { timeoutMs: 30_000, env: studioEnv },
    );
  } catch {
    /* ignore */
  }
}

let cleanupPromise = null;
async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    await stopStudioThenAlways(
      async () => {
        try {
          await stopStudio(studioChild);
        } catch (e) {
          console.warn(
            "stop Studio failed:",
            e instanceof Error ? e.message : e,
          );
        }
      },
      async () => {
        studioChild = null;
        try {
          if (lastSmokeConfigBytes !== undefined) {
            restoreStudioConfigFile(STUDIO_CONFIG_PATH, configSnapshot, {
              expectedContents: lastSmokeConfigBytes,
            });
          } else {
            restoreStudioConfigFile(STUDIO_CONFIG_PATH, configSnapshot);
          }
          configRestoreError = null;
        } catch (e) {
          configRestoreError = e;
          console.warn(
            "restore Studio config failed:",
            e instanceof Error ? e.message : e,
          );
        }
        // Drop the lock only after restore so another smoke cannot snapshot mid-restore.
        if (releaseSmokeConfigLock) {
          try {
            releaseSmokeConfigLock();
          } catch {
            /* ignore */
          }
          releaseSmokeConfigLock = null;
        }
        // Restore may have left `.olive-studio/` because the lock file still existed.
        if (configSnapshot && !configSnapshot.existed) {
          tryRemoveEmptyStudioConfigDir(path.dirname(STUDIO_CONFIG_PATH));
        }
        try {
          rmSync(smokeConfigDir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      },
    );
  })();
  return cleanupPromise;
}

function failExitCode(signal) {
  if (signal === "SIGINT") return 130;
  if (signal === "SIGTERM") return 143;
  return STRICT ? 1 : 0;
}

function handleSignal(signal) {
  void cleanup().finally(() => {
    if (configRestoreError) process.exit(1);
    process.exit(failExitCode(signal));
  });
}
process.once("SIGINT", () => handleSignal("SIGINT"));
process.once("SIGTERM", () => handleSignal("SIGTERM"));
process.once("SIGHUP", () => handleSignal("SIGHUP"));

try {
  await runJobControlSmoke();
  console.log("PASS: pinned mcporter agent smoke (incl. job policy path)");
  await cleanup();
  if (configRestoreError) {
    console.error(
      "FAIL: Studio config restore failed after smoke:",
      configRestoreError instanceof Error
        ? configRestoreError.message
        : configRestoreError,
    );
    process.exit(1);
  }
  process.exit(0);
} catch (err) {
  console.error("FAIL:", err instanceof Error ? err.message : err);
  await cleanup();
  if (configRestoreError) {
    console.error(
      "FAIL: Studio config restore also failed:",
      configRestoreError instanceof Error
        ? configRestoreError.message
        : configRestoreError,
    );
  }
  process.exit(failExitCode());
}
