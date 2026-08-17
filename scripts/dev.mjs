#!/usr/bin/env node
/**
 * Cross-platform dev server launcher that enforces a 4GB V8 heap size
 * for the Express + Vite development environment.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverScript = path.join(root, "server.ts");

const existingOptions = process.env.NODE_OPTIONS || "";
const memoryOption = "--max-old-space-size=4096";
const nodeOptions = existingOptions.includes("--max-old-space-size")
  ? existingOptions
  : `${existingOptions} ${memoryOption}`.trim();

const isWin = process.platform === "win32";
const child = spawn(
  isWin ? "pnpm.cmd" : "pnpm",
  ["exec", "tsx", serverScript, ...process.argv.slice(2)],
  {
    cwd: root,
    stdio: "inherit",
    shell: isWin,
    env: {
      ...process.env,
      NODE_OPTIONS: nodeOptions,
    },
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    if (!child.killed) {
      child.kill(sig);
    }
  });
}
