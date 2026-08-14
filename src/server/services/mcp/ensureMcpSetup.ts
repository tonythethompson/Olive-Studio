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
 *
 * Packaged installs can land in a read-only location for a standard user
 * (macOS /Applications, a Linux AppImage's mounted resources; Tauri's default
 * Windows NSIS install is per-user and writable, but isn't guaranteed to stay
 * that way). The rest of this app's venvs already live under `process.cwd()`
 * the same way (see src/server/services/venv/spec.ts) -- moving all of them to
 * a proper per-user app-data directory is a larger, separate change. Here we
 * only make sure a non-writable install degrades to a clean no-op (same as
 * before this feature existed) instead of a partial failure or a crash.
 */
import { existsSync, writeFileSync, unlinkSync } from "fs";
import { spawn } from "child_process";
import path from "path";
import { mcpServerDir } from "./paths.ts";
import { readStudioConfig, writeStudioConfig } from "../../config.ts";
import { findSystemPython } from "../venv/systemPython.ts";
// Plain ESM (not TS) so scripts/postinstall-mcp-setup.mjs can share it with zero build step.
import { venvPython, venvIsWorking } from "../../../../scripts/mcpVenvProbe.mjs";

const RETRY_BACKOFF_MS = 60 * 60 * 1000;

let attemptedThisProcess = false;

function isWritable(dir: string): boolean {
  const probe = path.join(dir, `.mcp-setup-write-test-${process.pid}`);
  try {
    writeFileSync(probe, "");
    unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

// `cmd` is always a fixed candidate ("python"/"python3"), a path resolved by
// findSystemPython(), or a path this module constructs under a known `.venv`
// dir -- never user input -- and spawn runs without a shell, so there's no
// command-injection surface here.
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
  try {
    writeStudioConfig({ mcpAutoSetup: { lastAttemptAt: new Date().toISOString(), lastResult } });
  } catch (err: unknown) {
    console.warn("[mcp-setup] failed to persist setup result:", err instanceof Error ? err.message : err);
  }
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

async function runEnsureMcpSetup(): Promise<void> {
  const mcpDir = mcpServerDir();
  if (!existsSync(mcpDir)) return; // not bundled: npm CLI install, or dev checkout mid-clone

  const existing = venvPython(mcpDir);
  if (existing && venvIsWorking(existing, mcpDir)) return; // already set up

  const last = readStudioConfig().mcpAutoSetup;
  if (last && last.lastResult !== "ok" && Date.now() - Date.parse(last.lastAttemptAt) < RETRY_BACKOFF_MS) {
    return; // avoid re-attempting/re-warning a repeat failure on every relaunch within the backoff window
  }

  if (!isWritable(mcpDir)) {
    console.warn(
      "[mcp-setup] MCP server directory is read-only (common for /Applications or AppImage installs) -- " +
        "skipping auto-setup. MCP features are unavailable until it's set up from a writable location.",
    );
    recordResult("failed");
    return;
  }

  // Honors OLIVE_STUDIO_PYTHON / the persisted systemPython setting / standard
  // per-user install locations, not just a bare "python"/"python3" on PATH.
  const pythonCmd = await findSystemPython();
  if (!pythonCmd) {
    console.warn(
      "[mcp-setup] No supported system Python found. MCP features are unavailable until Python is installed " +
        "(will retry automatically).",
    );
    recordResult("python-missing");
    return;
  }

  await performSetup(mcpDir, pythonCmd);
}

/** Fire-and-forget: call once at server startup. Safe to call in any context. */
export function ensureMcpSetupInBackground(): void {
  if (attemptedThisProcess) return;
  attemptedThisProcess = true;

  runEnsureMcpSetup().catch((err: unknown) => {
    console.warn("[mcp-setup] background setup failed unexpectedly:", err instanceof Error ? err.message : err);
  });
}
