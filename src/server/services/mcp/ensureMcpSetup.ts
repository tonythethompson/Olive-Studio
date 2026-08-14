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
import { spawn, spawnSync } from "child_process";
import path from "path";
import { mcpServerDir } from "./paths.ts";
import { readStudioConfig, writeStudioConfig } from "../../config.ts";

const RETRY_BACKOFF_MS = 60 * 60 * 1000;

let attemptedThisProcess = false;

function venvPython(mcpDir: string): string | null {
  const winPy = path.join(mcpDir, ".venv", "Scripts", "python.exe");
  const nixPy = path.join(mcpDir, ".venv", "bin", "python");
  if (existsSync(winPy)) return winPy;
  if (existsSync(nixPy)) return nixPy;
  return null;
}

function venvIsWorking(python: string, mcpDir: string): boolean {
  const r = spawnSync(python, ["-c", "import mcp"], {
    env: { ...process.env, PYTHONPATH: mcpDir },
  });
  return r.status === 0;
}

function findSystemPython(): string | null {
  const candidates = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
  for (const cmd of candidates) {
    const r = spawnSync(cmd, ["--version"], { encoding: "utf8" });
    if (r.status === 0) {
      const match = /Python 3\.(\d+)/.exec(r.stdout || r.stderr || "");
      if (match && Number(match[1]) >= 10) return cmd;
    }
  }
  return null;
}

function run(cmd: string, args: string[], cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: "pipe" });
    child.stdout?.on("data", (d: Buffer) => console.log(`[mcp-setup] ${d.toString().trim()}`));
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
