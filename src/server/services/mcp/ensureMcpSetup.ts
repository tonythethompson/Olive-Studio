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
import { venvPython, venvIsWorking, findSystemPython as findPathPython } from "../../../../scripts/mcpVenvProbe.mjs";
// Full resolver (env override -> persisted systemPython -> known install locations -> PATH).
// Only usable here (TS, bundled server code) -- the plain-.mjs probe above stays PATH-only so
// the zero-build-step postinstall script can keep importing it directly.
import { findSystemPython as findConfiguredPython } from "../venv/systemPython.ts";

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
  // Never throw out of a fire-and-forget setup step: on a packaged install where the
  // resource dir (and thus .olive-studio/config.json under it) isn't writable, this
  // write itself can fail. Swallow it -- setup is still best-effort either way, and an
  // unhandled rejection here would otherwise propagate out of the caller's void-called
  // promise chain.
  try {
    writeStudioConfig({ mcpAutoSetup: { lastAttemptAt: new Date().toISOString(), lastResult } });
  } catch (err: unknown) {
    console.warn("[mcp-setup] Failed to persist setup result:", err instanceof Error ? err.message : err);
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

/**
 * Resolves the Python interpreter to use for setup: prefers the full config-aware
 * resolver (OLIVE_STUDIO_PYTHON -> persisted systemPython -> known per-OS install
 * locations -> PATH) so a user who selected Python via Runtime -> Set Python (or has
 * it outside PATH) is honored here too, then falls back to the PATH-only probe.
 */
async function resolveSetupPython(): Promise<string | null> {
  try {
    const configured = await findConfiguredPython();
    if (configured) return configured;
  } catch {
    // fall through to the PATH-only probe below
  }
  return findPathPython();
}

/** Fire-and-forget: call once at server startup. Safe to call in any context. */
export function ensureMcpSetupInBackground(): void {
  if (attemptedThisProcess) return;
  attemptedThisProcess = true;

  const mcpDir = mcpServerDir();
  if (!existsSync(mcpDir)) return; // not bundled: npm CLI install, or dev checkout mid-clone

  const existing = venvPython(mcpDir);
  if (existing && venvIsWorking(existing, mcpDir)) return; // already set up

  void (async () => {
    const pythonCmd = await resolveSetupPython();
    if (!pythonCmd) {
      console.warn(
        "[mcp-setup] Python >= 3.10 not found. MCP features are unavailable until Python is installed " +
          "(the app will retry automatically on next launch).",
      );
      recordResult("python-missing");
      return;
    }

    const last = readStudioConfig().mcpAutoSetup;
    if (last?.lastResult === "failed" && Date.now() - Date.parse(last.lastAttemptAt) < RETRY_BACKOFF_MS) {
      return; // avoid hammering a failing install (e.g. offline) on every relaunch
    }

    await performSetup(mcpDir, pythonCmd);
  })();
}
