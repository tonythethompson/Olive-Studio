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
// Remove any existing --max-old-space-size setting before appending the enforced 4GB policy
const cleanedOptions = existingOptions.replace(/--max-old-space-size=\d+/g, "").trim();
const nodeOptions = `${cleanedOptions} ${memoryOption}`.trim();

const isWin = process.platform === "win32";
const child = spawn(
  isWin ? "pnpm.cmd" : "pnpm",
  ["exec", "tsx", serverScript, ...process.argv.slice(2)],
  {
    cwd: root,
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      NODE_OPTIONS: nodeOptions,
    },
  },
);

let completed = false;

child.on("error", (err) => {
  if (completed) return;
  completed = true;
  console.error("Failed to start dev server:", err.message);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (completed) return;
  completed = true;
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});

let childExited = false;
child.on("exit", () => {
  childExited = true;
});

const signalHandlers = new Map();
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  const handler = () => {
    if (!childExited && !child.killed) {
      child.kill(sig);
    } else if (childExited) {
      // Remove all signal listeners before re-signaling self
      for (const [signal, h] of signalHandlers) {
        process.removeListener(signal, h);
      }
      process.kill(process.pid, sig);
    }
  };
  signalHandlers.set(sig, handler);
  process.on(sig, handler);
}
