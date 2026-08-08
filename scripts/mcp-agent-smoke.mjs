/**
 * Pinned mcporter canary smoke for Olive MCP (Phase 0).
 * Non-blocking CI by default — third-party CLI must not hard-break product PRs.
 *
 * Usage (repo root):
 *   node scripts/mcp-agent-smoke.mjs
 *   pnpm mcp:agent-smoke
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const MCPORTER = "mcporter@0.13.0";
const configCandidates = [
  path.join(root, "config", "mcporter.example.json"),
  path.join(root, "config", "mcporter.json"),
];
const configPath = configCandidates.find((p) => existsSync(p));
if (!configPath) {
  console.error("No mcporter config found (config/mcporter.example.json)");
  process.exit(1);
}

function run(args, timeoutMs = 90_000) {
  const full = ["--yes", MCPORTER, ...args, "--config", configPath];
  console.log(`$ npx ${full.join(" ")}`);
  const r = spawnSync("npx", full, {
    cwd: root,
    encoding: "utf8",
    timeout: timeoutMs,
    shell: process.platform === "win32",
    env: { ...process.env },
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    console.error(`mcporter failed status=${r.status} signal=${r.signal}`);
    process.exit(r.status ?? 1);
  }
}

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
  120_000,
);
console.log("PASS: pinned mcporter agent smoke");
