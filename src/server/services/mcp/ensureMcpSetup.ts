/**
 * First-launch, best-effort MCP server venv setup for packaged desktop builds.
 *
 * A plain `pnpm install` already gets this via postinstall (scripts/postinstall-mcp-setup.mjs).
 * That doesn't run for a packaged Tauri install, so this covers the same gap
 * at server startup instead: if the bundled `olive-mcp-server/` resource is
 * present but its venv isn't set up, set it up in the background.
 *
 * Never blocks server startup and never throws — the app works without MCP
 * either way, this only makes it available with zero manual steps when it can.
 */
import { existsSync } from "fs";
import { spawn } from "child_process";
import path from "path";
import { mcpServerDir } from "./paths.ts";
import { readStudioConfig, writeStudioConfig } from "../../config.ts";
// Plain ESM (not TS) so scripts/postinstall-mcp-setup.mjs can share it with zero build step.
import { venvPython, venvIsWorking, findSystemPython } from "../../../../scripts/mcpVenvProbe.mjs";

const RETRY_BACKOFF_MS = 60 * 60 * 1000;

let attemptedThisProcess = false;

// `cmd` is always a fixed candidate ("python"/"python3") or a path this module
// constructs under a known `.venv` dir -- never user input -- and spawn runs
// without a shell, so there's no command-injection surface here.
function run(cmd: string, args: string[], cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    // nosemgrep: javascript.lang.security.detect-child-process -- cmd is internal-only, see comment above this function
    const child = spawn(cmd, args, { cwd, stdio: "pipe" });
    // eslint-disable-next-line no-console -- intentional background setup progress logging
    child.stdout?.on("data", (d: Buffer) => console.log(`[mcp-setup] ${d.toString().trim()}`));
    // eslint-disable-next-line no-console -- intentional background setup progress logging
    child.stderr?.on("data", (d: Buffer) => console.log(`[mcp-setup] ${d.toString().trim()}`));
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

function recordResult(lastResult: "ok" | "python-missing" | "failed"): void {
  writeStudioConfig({ mcpAutoSetup: { lastAttemptAt: new Date().toISOString(), lastResult } });
}

async function performSetup(mcpDir: string, pythonCmd: string): Promise<void> {
  const venvDir = path.join(mcpDir, ".venv");
  // eslint-disable-next-line no-console -- intentional background setup progress logging
  console.log("[mcp-setup] Setting up Olive MCP server (first launch, one-time)...");

  if (!(await run(pythonCmd, ["-m", "venv", venvDir], mcpDir))) {
    console.warn("[mcp-setup] Failed to create venv.");
    recordResult("failed");
    return;
  }

  const venvPy =
    process.platform === "win32" ? path.join(venvDir, "Scripts", "python.exe") : path.join(venvDir, "bin", "python");

  const installOk = await run(
    venvPy,
    ["-m", "pip", "install", "--upgrade", "pip", "-e", `${mcpDir}[dev]`, "mcp<2", "--quiet"],
    mcpDir,
  );
  if (!installOk) {
    console.warn("[mcp-setup] pip install failed.");
    recordResult("failed");
    return;
  }

  if (!venvIsWorking(venvPy, mcpDir)) {
    console.warn("[mcp-setup] Server import check failed after install.");
    recordResult("failed");
    return;
  }

  // eslint-disable-next-line no-console -- intentional background setup progress logging
  console.log("[mcp-setup] Olive MCP server is ready.");
  recordResult("ok");
}

/** Fire-and-forget: call once at server startup. Safe to call in any context. */
export function ensureMcpSetupInBackground(): void {
  if (attemptedThisProcess) return;
  attemptedThisProcess = true;

  const mcpDir = mcpServerDir();
  if (!existsSync(mcpDir)) return; // not bundled: npm CLI install, or dev checkout mid-clone

  const existing = venvPython(mcpDir);
  if (existing && venvIsWorking(existing, mcpDir)) return; // already set up

  const pythonCmd = findSystemPython();
  if (!pythonCmd) {
    console.warn(
      "[mcp-setup] Python >= 3.10 not found on PATH. MCP features are unavailable until Python is installed " +
        "(the app will retry automatically on next launch).",
    );
    recordResult("python-missing");
    return;
  }

  const last = readStudioConfig().mcpAutoSetup;
  if (last?.lastResult === "failed" && Date.now() - Date.parse(last.lastAttemptAt) < RETRY_BACKOFF_MS) {
    return; // avoid hammering a failing install (e.g. offline) on every relaunch
  }

  void performSetup(mcpDir, pythonCmd);
}
