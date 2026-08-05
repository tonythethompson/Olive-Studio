/**
 * Local AI engine infrastructure: LM Studio + Ollama discovery, lifecycle
 * (install/start/ensure), and pull-verification helpers shared by the
 * /ai/local-*, /ai/ollama-*, and /ai/install-engine routes.
 */
import { spawn, execFile, execSync, type ChildProcess } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";

import {
  findInstalledStarterId,
  LMS_STARTER_MODELS,
  OLLAMA_STARTER_MODELS,
  resolveLocalEnableModelId,
} from "../../../lib/localEngineStarters.ts";
import {
  localEngineRuntime,
  type EnsureProgressEvt,
  type LmsEnsureResult,
  type OllamaEnsureResult,
} from "../../services/ai/localEngineState.ts";

const execFileAsync = promisify(execFile);

export const LM_STUDIO_PORT = 1234;
export const OLLAMA_PORT = 11434;

export function lmStudioFetchInit(signal?: AbortSignal): RequestInit {
  return {
    signal,
    headers: { "Content-Type": "application/json" },
    // LM Studio local API doesn't need authorization
  };
}

export async function isLmsServerRunning(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(
      `http://127.0.0.1:${LM_STUDIO_PORT}/v1/models`,
      lmStudioFetchInit(controller.signal),
    );
    clearTimeout(timeout);
    return response.status > 0;
  } catch {
    return false;
  }
}

/** Spawn `lms server …`; resolves exit code if the child exits quickly, else null. */
function spawnLmsServerDetached(lms: string, args: string[]): Promise<number | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      resolve(code);
    };
    try {
      const child = spawn(lms, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: { ...process.env },
      });
      child.once("exit", (code) => finish(code));
      child.once("error", () => finish(1));
      child.unref();
      setTimeout(() => finish(null), 2000);
    } catch {
      finish(1);
    }
  });
}

export async function isOllamaRunning(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(`http://127.0.0.1:${OLLAMA_PORT}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

const LMS_CLI_MISS_TTL_MS = 5000;

function resetLmsCliCache(): void {
  localEngineRuntime.cachedLmsCli = undefined;
  localEngineRuntime.lmsCliMissAt = 0;
}

/** Module-level LMS CLI path cache (avoids re-probing disk/PATH on every request). */
export function findLmsCli(): string | null {
  // Reuse a positive cache hit immediately
  if (localEngineRuntime.cachedLmsCli) return localEngineRuntime.cachedLmsCli;
  // Reuse a cached miss within TTL to avoid repeated expensive probes
  if (
    localEngineRuntime.cachedLmsCli === null &&
    localEngineRuntime.lmsCliMissAt > 0 &&
    Date.now() - localEngineRuntime.lmsCliMissAt < LMS_CLI_MISS_TTL_MS
  ) {
    return null;
  }
  const home = os.homedir();
  const candidates =
    process.platform === "win32"
      ? [
          path.join(home, ".lmstudio", "bin", "lms.exe"),
          path.join(home, ".lmstudio", "bin", "lms"),
          path.join(process.env.LOCALAPPDATA || "", "Programs", "LM Studio", "lms.exe"),
          path.join(process.env.LOCALAPPDATA || "", "LM Studio", "lms.exe"),
        ]
      : [path.join(home, ".lmstudio", "bin", "lms"), "/usr/local/bin/lms", "/opt/homebrew/bin/lms"];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) {
      localEngineRuntime.cachedLmsCli = c;
      localEngineRuntime.lmsCliMissAt = 0;
      return localEngineRuntime.cachedLmsCli;
    }
  }
  try {
    const result = execSync(process.platform === "win32" ? "where lms" : "which lms", {
      encoding: "utf-8",
      timeout: 2000,
      windowsHide: true,
    })
      .toString()
      .trim()
      .split(/\r?\n/)[0]
      ?.trim();
    if (result && fs.existsSync(result)) {
      localEngineRuntime.cachedLmsCli = result;
      localEngineRuntime.lmsCliMissAt = 0;
      return localEngineRuntime.cachedLmsCli;
    }
  } catch {
    /* not on PATH */
  }
  // Cache the miss with timestamp
  localEngineRuntime.cachedLmsCli = null;
  localEngineRuntime.lmsCliMissAt = Date.now();
  return null;
}

/** List downloaded LM Studio LLM model keys via `lms ls --json` (not just currently loaded). */
export async function listLmsInstalledModelKeys(): Promise<string[] | null> {
  const lms = findLmsCli();
  if (!lms) return null;
  try {
    const { stdout } = await execFileAsync(lms, ["ls", "--json"], {
      encoding: "utf-8",
      timeout: 20_000,
      windowsHide: true,
      maxBuffer: 12 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout) as Array<{ type?: string; modelKey?: string; path?: string }>;
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter((m) => m && (m.type === "llm" || m.type === undefined))
      .map((m) => String(m.modelKey || m.path || "").trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

function findOllamaCli(): string | null {
  const home = os.homedir();
  const candidates =
    process.platform === "win32"
      ? [
          path.join(process.env.LOCALAPPDATA || "", "Programs", "Ollama", "ollama.exe"),
          path.join(process.env.ProgramFiles || "C:\\Program Files", "Ollama", "ollama.exe"),
          path.join(home, "AppData", "Local", "Programs", "Ollama", "ollama.exe"),
        ]
      : ["/usr/local/bin/ollama", "/opt/homebrew/bin/ollama", path.join(home, ".ollama", "bin", "ollama")];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  try {
    const result = execSync(process.platform === "win32" ? "where ollama" : "which ollama", {
      encoding: "utf-8",
      timeout: 2000,
      windowsHide: true,
    })
      .toString()
      .trim()
      .split(/\r?\n/)[0]
      ?.trim();
    if (result && fs.existsSync(result)) return result;
  } catch {
    /* not on PATH */
  }
  return null;
}

/** Windows/macOS tray app that owns the local server lifecycle (do not also spawn `ollama serve`). */
function findOllamaApp(): string | null {
  if (process.platform === "win32") {
    const candidates = [
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Ollama", "ollama app.exe"),
      path.join(process.env.ProgramFiles || "C:\\Program Files", "Ollama", "ollama app.exe"),
      path.join(os.homedir(), "AppData", "Local", "Programs", "Ollama", "ollama app.exe"),
    ];
    for (const c of candidates) {
      if (c && fs.existsSync(c)) return c;
    }
    return null;
  }
  if (process.platform === "darwin") {
    return "/Applications/Ollama.app";
  }
  return null;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function tryWingetInstall(packageIds: string[]): Promise<boolean> {
  if (process.platform !== "win32") return false;
  try {
    await execFileAsync("winget", ["--version"], { timeout: 5000, windowsHide: true });
  } catch {
    return false;
  }
  for (const id of packageIds) {
    try {
      await execFileAsync(
        "winget",
        [
          "install",
          "-e",
          "--id",
          id,
          "--accept-package-agreements",
          "--accept-source-agreements",
          "--disable-interactivity",
          "--silent",
        ],
        { timeout: 600_000, windowsHide: true },
      );
      return true;
    } catch {
      /* try next id */
    }
  }
  return false;
}

/**
 * Start Ollama without opening a console flood.
 * On Windows/macOS the tray app owns `serve`; spawning `ollama serve` beside it
 * fights the app (reap/respawn) and can flash endless terminal windows.
 * Observes async ChildProcess `error` so launch failures propagate to callers.
 */
function startOllamaOnce(cliPath: string): Promise<{ mode: "app" | "serve"; detail: string }> {
  return new Promise((resolve, reject) => {
    let mode: "app" | "serve" = "serve";
    let detail = `${cliPath} serve`;
    let child: ChildProcess | null = null;

    if (process.platform === "win32") {
      const app = findOllamaApp();
      if (app) {
        child = spawn(app, [], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
          env: { ...process.env },
        });
        mode = "app";
        detail = app;
      }
    } else if (process.platform === "darwin") {
      const app = findOllamaApp();
      if (app && fs.existsSync(app)) {
        child = spawn("open", ["-a", "Ollama"], {
          detached: true,
          stdio: "ignore",
          env: { ...process.env },
        });
        mode = "app";
        detail = app;
      }
    }

    if (!child) {
      child = spawn(cliPath, ["serve"], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: { ...process.env },
      });
      mode = "serve";
      detail = `${cliPath} serve`;
    }

    // Attach listeners in the same turn as spawn so async failures are never unhandled.
    let settled = false;
    const settleOk = () => {
      if (settled) return;
      settled = true;
      child!.unref();
      resolve({ mode, detail });
    };
    child.once("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    child.once("spawn", settleOk);
  });
}

const OLLAMA_START_COOLDOWN_MS = 45_000;

export async function ensureOllamaReady(
  onProgress?: (evt: EnsureProgressEvt) => void,
): Promise<OllamaEnsureResult> {
  if (onProgress) {
    localEngineRuntime.ollamaProgressSubscribers.add(onProgress);
    if (localEngineRuntime.ollamaEnsureInFlight) {
      onProgress({ type: "step", message: "Ollama setup already in progress…", percent: 5 });
    }
  }
  if (!localEngineRuntime.ollamaEnsureInFlight) {
    localEngineRuntime.ollamaEnsureInFlight = ensureOllamaReadyImpl((evt) => {
      for (const sub of localEngineRuntime.ollamaProgressSubscribers) {
        try {
          sub(evt);
        } catch (err) {
          console.error("[ensureOllamaReady] Progress subscriber threw:", err);
        }
      }
    }).finally(() => {
      localEngineRuntime.ollamaEnsureInFlight = null;
    });
  }
  try {
    return await localEngineRuntime.ollamaEnsureInFlight;
  } finally {
    if (onProgress) localEngineRuntime.ollamaProgressSubscribers.delete(onProgress);
  }
}

async function ensureOllamaReadyImpl(
  onProgress?: (evt: { type: string; message: string; percent?: number }) => void,
): Promise<OllamaEnsureResult> {
  const steps: string[] = [];
  const note = (message: string, percent?: number) => {
    steps.push(message);
    onProgress?.({ type: "step", message, percent });
  };
  if (await isOllamaRunning()) {
    note("Ollama already running", 15);
    return { ok: true, steps };
  }
  let ollama = findOllamaCli();
  if (!ollama) {
    note("Ollama CLI not found. Installing…", 5);
    if (process.platform === "win32") {
      note("Running winget install Ollama.Ollama (silent)…", 8);
      await tryWingetInstall(["Ollama.Ollama"]);
    } else if (process.platform === "darwin") {
      note("Running brew install ollama…", 8);
      try {
        await execFileAsync("brew", ["install", "ollama"], { timeout: 600_000 });
      } catch {
        note("brew install failed", 12);
      }
    }
    for (let i = 0; i < 20; i++) {
      ollama = findOllamaCli();
      if (ollama) break;
      await sleepMs(2000);
    }
    // Installer often auto-starts the tray app; give it a moment before we launch anything.
    for (let i = 0; i < 15; i++) {
      if (await isOllamaRunning()) {
        note("Ollama started after install", 28);
        return { ok: true, steps };
      }
      await sleepMs(1000);
    }
  }
  if (!ollama)
    return {
      ok: false,
      steps,
      error: "Could not install or find Ollama. Install from https://ollama.com, then retry.",
    };

  if (!(await isOllamaRunning())) {
    const now = Date.now();
    if (now - localEngineRuntime.lastOllamaStartAt < OLLAMA_START_COOLDOWN_MS) {
      note("Waiting for a recent Ollama start attempt…", 22);
    } else {
      try {
        const started = await startOllamaOnce(ollama);
        localEngineRuntime.lastOllamaStartAt = now;
        note(
          started.mode === "app"
            ? `Launching Ollama app (${started.detail})…`
            : `Starting headless ollama serve (${started.detail})…`,
          22,
        );
      } catch (err: unknown) {
        note(`Failed to start Ollama: ${err instanceof Error ? err.message : String(err)}`, 22);
      }
    }
    for (let i = 0; i < 40; i++) {
      await sleepMs(1000);
      if (await isOllamaRunning()) {
        note("Ollama HTTP server ready on :11434", 30);
        return { ok: true, steps };
      }
    }
    return {
      ok: false,
      steps,
      error:
        process.platform === "win32" || process.platform === "darwin"
          ? "Ollama did not become ready. Open the Ollama app from the Start menu / Applications, wait until the tray icon appears, then retry."
          : "Ollama serve did not start. Run `ollama serve` manually, then retry.",
    };
  }
  return { ok: true, steps };
}

export const LMS_GET_MAX_MS = 20 * 60 * 1000;
export const OLLAMA_PULL_MAX_MS = 20 * 60 * 1000;

export function starterMetaForTag(engine: "lms" | "ollama", tag: string) {
  const list = engine === "ollama" ? OLLAMA_STARTER_MODELS : LMS_STARTER_MODELS;
  return list.find((m) => m.tag === tag);
}

export function verifyInstalledAfterPull(
  engine: "lms" | "ollama",
  downloadTag: string,
  installed: readonly string[],
): { ok: true; modelId: string } | { ok: false; error: string; hint: string } {
  const starter = starterMetaForTag(engine, downloadTag);
  const found = findInstalledStarterId(
    {
      tag: downloadTag,
      enableTag: starter?.enableTag ?? downloadTag,
      match: starter?.match ?? starter?.enableTag ?? downloadTag,
    },
    installed,
  );
  if (found) return { ok: true, modelId: found };
  const expected = starter?.enableTag ?? resolveLocalEnableModelId(downloadTag, starter?.enableTag, installed);
  const engineName = engine === "ollama" ? "Ollama" : "LM Studio";
  return {
    ok: false,
    error: `Download finished but the model did not appear in ${engineName}.`,
    hint: `Expected something like "${expected}". Open ${engineName}, click Refresh under Installed models, then Enable.`,
  };
}

export async function listOllamaInstalledNames(): Promise<string[] | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const tagsRes = await fetch(`http://127.0.0.1:${OLLAMA_PORT}/api/tags`, {
      signal: controller.signal,
    });
    if (!tagsRes.ok) return null;
    const data = (await tagsRes.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function ensureLmsReady(onProgress?: (evt: EnsureProgressEvt) => void): Promise<LmsEnsureResult> {
  if (onProgress) {
    localEngineRuntime.lmsProgressSubscribers.add(onProgress);
    if (localEngineRuntime.lmsEnsureInFlight) {
      onProgress({ type: "step", message: "LM Studio setup already in progress…", percent: 5 });
    }
  }
  if (!localEngineRuntime.lmsEnsureInFlight) {
    localEngineRuntime.lmsEnsureInFlight = ensureLmsReadyImpl((evt) => {
      for (const sub of localEngineRuntime.lmsProgressSubscribers) {
        try {
          sub(evt);
        } catch (err) {
          console.error("[ensureLmsReady] Progress subscriber threw:", err);
        }
      }
    }).finally(() => {
      localEngineRuntime.lmsEnsureInFlight = null;
    });
  }
  try {
    return await localEngineRuntime.lmsEnsureInFlight;
  } finally {
    if (onProgress) localEngineRuntime.lmsProgressSubscribers.delete(onProgress);
  }
}

async function ensureLmsReadyImpl(onProgress?: (evt: EnsureProgressEvt) => void): Promise<LmsEnsureResult> {
  const steps: string[] = [];
  const note = (message: string, percent?: number) => {
    steps.push(message);
    onProgress?.({ type: "step", message, percent });
  };

  if (await isLmsServerRunning()) {
    note("LM Studio server already running", 15);
    return { ok: true, steps };
  }

  let lms = findLmsCli();
  if (!lms) {
    note("LM Studio CLI (lms) not found. Installing…", 5);
    if (process.platform === "win32") {
      note("Running winget install ElementLabs.LMStudio…", 8);
      await tryWingetInstall(["ElementLabs.LMStudio"]);
    } else if (process.platform === "darwin") {
      note("Running brew install --cask lm-studio…", 8);
      try {
        await execFileAsync("brew", ["install", "--cask", "lm-studio"], { timeout: 600_000 });
      } catch {
        note("brew cask install failed. Continuing discovery…", 10);
      }
    } else {
      note("No package-manager install path for this Linux host. Install LM Studio manually if needed.", 8);
    }

    for (let i = 0; i < 20; i++) {
      resetLmsCliCache();
      lms = findLmsCli();
      if (lms) break;
      await sleepMs(2000);
    }
  }

  if (!lms) {
    return {
      ok: false,
      steps,
      openedUrl: "https://lmstudio.ai",
      error:
        "Could not install or find the LM Studio CLI (lms). Install LM Studio from https://lmstudio.ai, open it once, then retry Setup.",
    };
  }

  note(`Found LM Studio CLI at ${lms}`, 35);

  if (!(await isLmsServerRunning())) {
    note("Starting LM Studio server (lms server start)…", 50);
    let exitCode = await spawnLmsServerDetached(lms, ["server", "start"]);
    if (exitCode !== null && exitCode !== 0) {
      note(`lms server start exited (${exitCode}); retrying lms server…`, 52);
      exitCode = await spawnLmsServerDetached(lms, ["server"]);
      if (exitCode !== null && exitCode !== 0) {
        note(`lms server exited (${exitCode})`, 54);
      }
    }

    for (let i = 0; i < 30; i++) {
      await sleepMs(1000);
      if (await isLmsServerRunning()) {
        note("LM Studio HTTP server ready", 90);
        return { ok: true, steps };
      }
    }
    return {
      ok: false,
      steps,
      openedUrl: "https://lmstudio.ai",
      error:
        "LM Studio CLI is installed but the local server did not start. Open LM Studio once (or run `lms server start`), then retry.",
    };
  }

  return { ok: true, steps };
}
