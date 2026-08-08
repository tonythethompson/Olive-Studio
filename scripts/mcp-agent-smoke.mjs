/**
 * Pinned mcporter canary smoke for Olive MCP (Phase 0 + job-control path).
 * Non-blocking CI by default — third-party CLI must not hard-break product PRs.
 *
 * Covers:
 *   - list --status, get_olive_passes, get_mcp_capabilities (existing)
 *   - policy-gated submit / status / cancel / idempotent reuse via MCP → Studio
 *   - one allowed job (reuse + terminal cancel) and one denied submit
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const MCPORTER = "mcporter@0.13.0";
const STUDIO_CONFIG_PATH = path.join(root, ".olive-studio", "config.json");

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

/**
 * Prefer project venv, then python3, then python — mcporter configs often say
 * `python`, which is missing on some CI images that only ship python3.
 */
function resolvePython() {
  const candidates = [
    path.join(root, "olive-mcp-server", ".venv", "bin", "python"),
    path.join(root, "olive-mcp-server", ".venv", "Scripts", "python.exe"),
    path.join(root, ".venv", "bin", "python"),
    path.join(root, ".venv", "Scripts", "python.exe"),
    "python3",
    "python",
  ];
  for (const c of candidates) {
    if (c === "python3" || c === "python") return c;
    if (existsSync(c)) return c;
  }
  return "python3";
}

function writeSmokeMcporterConfig() {
  const dir = mkdtempSync(path.join(tmpdir(), "olive-mcp-agent-smoke-"));
  const configPath = path.join(dir, "mcporter.json");
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        mcpServers: {
          olive: {
            command: resolvePython(),
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
  try {
    if (!existsSync(STUDIO_CONFIG_PATH)) return {};
    const parsed = JSON.parse(readFileSync(STUDIO_CONFIG_PATH, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

/** Patch agentAccess on disk — resolveAgentAccess re-reads each request (avoids PUT rate limit). */
function patchAgentAccessDisk(patch) {
  const cfg = readStudioDiskConfig();
  cfg.agentAccess = { ...(cfg.agentAccess || {}), ...patch };
  mkdirSync(path.dirname(STUDIO_CONFIG_PATH), { recursive: true });
  writeFileSync(STUDIO_CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
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
    console.error(`mcporter failed status=${r.status} signal=${r.signal}`);
    process.exit(r.status ?? 1);
  }
  return r;
}

/** @param {string} stdout */
function parseJsonPayload(stdout) {
  const text = (stdout || "").trim();
  if (!text) throw new Error("empty mcporter stdout");
  const startObj = text.lastIndexOf("{");
  const startArr = text.lastIndexOf("[");
  const start = Math.max(startObj, startArr);
  if (start < 0) throw new Error(`no JSON in mcporter stdout: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(start));
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
      env: { ...opts.env },
      shell: process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`mcporter ${selector} timed out after ${timeoutMs}ms`));
    }, timeoutMs + 15_000);
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
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
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

async function waitForStudio(baseUrl, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/olive/agent-access`);
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
  const child = spawn("pnpm", ["exec", "tsx", "server.ts"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      // Do not set OLIVE_MCP_ALLOW_JOBS — deny path must be reachable via disk policy.
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (buf) => process.stdout.write(`[studio] ${buf}`));
  child.stderr?.on("data", (buf) => process.stderr.write(`[studio] ${buf}`));
  return child;
}

function stopStudio(child) {
  if (!child || child.killed) return;
  try {
    child.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    try {
      if (!child.killed) child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }, 2000).unref?.();
}

const { dir: smokeConfigDir, configPath: smokeConfigPath } = writeSmokeMcporterConfig();
let studioChild = null;
/** @type {{ allowJobSubmission?: boolean, allowJobCancellation?: boolean } | null} */
let priorAgentAccess = null;

async function runJobControlSmoke() {
  const diskBefore = readStudioDiskConfig();
  priorAgentAccess = {
    allowJobSubmission: diskBefore.agentAccess?.allowJobSubmission === true,
    allowJobCancellation: diskBefore.agentAccess?.allowJobCancellation === true,
  };

  // Denied path: submission off before Studio boots (no PUT / rate-limit burn).
  patchAgentAccessDisk({
    allowJobSubmission: false,
    allowJobCancellation: true,
  });

  const port = await freePort();
  const studioBase = `http://127.0.0.1:${port}`;
  studioChild = startStudio(port);
  await waitForStudio(studioBase);

  const studioEnv = { ...process.env, OLIVE_STUDIO_API_URL: studioBase };
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
  // Concurrent submits: mcporter cold-starts are slow enough that a sequential
  // replay can miss reuse after a fast failed setup. The Studio MCP lock still
  // serializes check-then-act into one job_id + reused:true.
  const [first, second] = await Promise.all([
    callToolAsync("olive.submit_optimization_job", submitArgs, {
      timeoutMs: 120_000,
      env: studioEnv,
    }),
    callToolAsync("olive.submit_optimization_job", submitArgs, {
      timeoutMs: 120_000,
      env: studioEnv,
    }),
  ]);
  if (!first.ok || !second.ok) {
    throw new Error(`submit failed: ${JSON.stringify({ first, second })}`);
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
  const jobId = first.job_id;
  console.log(
    `submit+reuse ok job_id=${jobId} reused=${first.reused}|${second.reused}`,
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
  if (!cancelled.ok || cancelled.status !== "cancelled") {
    // Already terminal-failed before cancel still counts if status is terminal.
    const after = await callToolAsync(
      "olive.get_optimization_job",
      { job_id: jobId },
      { timeoutMs: 60_000, env: studioEnv },
    );
    if (!(after.terminal === true && after.status === "cancelled")) {
      throw new Error(
        `expected cancel, got ${JSON.stringify({ cancelled, after })}`,
      );
    }
  }

  const terminal = await callToolAsync(
    "olive.get_optimization_job",
    { job_id: jobId },
    { timeoutMs: 60_000, env: studioEnv },
  );
  if (terminal.status !== "cancelled" || terminal.terminal !== true) {
    throw new Error(`expected terminal cancelled, got ${JSON.stringify(terminal)}`);
  }
  console.log("allowed job terminal+reuse ok");
}

function cleanup() {
  if (priorAgentAccess) {
    try {
      patchAgentAccessDisk(priorAgentAccess);
    } catch (e) {
      console.warn(
        "restore agentAccess skipped:",
        e instanceof Error ? e.message : e,
      );
    }
  }
  stopStudio(studioChild);
  try {
    rmSync(smokeConfigDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

try {
  run(["list", "olive", "--status", "--timeout", "60000"]);
  run([
    "call",
    "olive.get_olive_passes",
    "filter=quantization",
    "--timeout",
    "60000",
    "--output",
    "json",
  ]);
  run(
    [
      "call",
      "olive.get_mcp_capabilities",
      "--timeout",
      "90000",
      "--output",
      "json",
    ],
    { timeoutMs: 120_000 },
  );

  await runJobControlSmoke();
  console.log("PASS: pinned mcporter agent smoke (incl. job policy path)");
  cleanup();
  process.exit(0);
} catch (err) {
  console.error("FAIL:", err instanceof Error ? err.message : err);
  cleanup();
  process.exit(1);
}
