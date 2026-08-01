/**
 * Thin Wrangler CLI helpers for Cloudflare browser OAuth + credential sync.
 *
 * Windows note: Volta/npm/pnpm expose `wrangler` / `npx` as `.cmd` shims (or POSIX
 * shell scripts). Node `spawn`/`execFile` without `shell: true` throws `EINVAL`.
 * Mirror CodexAppServerClient: use a shell for non-.exe commands on win32.
 */

import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const execFileAsync = promisify(execFile);

export type WranglerAuthToken = {
  type: "oauth" | "api_token" | "api_key";
  token?: string;
  key?: string;
  email?: string;
};

export type WranglerWhoAmI = {
  email?: string;
  accounts?: Array<{ id: string; name?: string }>;
};

let loginChild: ReturnType<typeof spawn> | null = null;

/** On Windows, bare `wrangler` / `.cmd` shims need `shell: true`. */
export function wranglerSpawnUsesShell(command: string, platform = process.platform): boolean {
  if (platform !== "win32") return false;
  if (/\.exe$/i.test(command.trim())) return false;
  return true;
}

function preferWindowsCmdShim(candidate: string): string {
  if (process.platform !== "win32") return candidate;
  if (/\.(cmd|bat|exe)$/i.test(candidate)) return candidate;
  const cmdSibling = `${candidate}.CMD`;
  const cmdSiblingLower = `${candidate}.cmd`;
  if (fs.existsSync(cmdSibling)) return cmdSibling;
  if (fs.existsSync(cmdSiblingLower)) return cmdSiblingLower;
  return candidate;
}

function wranglerCandidates(): string[] {
  const fromEnv = process.env.WRANGLER_PATH?.trim();
  const home = os.homedir();
  const bin = process.platform === "win32" ? "wrangler.cmd" : "wrangler";
  return [
    ...(fromEnv ? [fromEnv] : []),
    bin,
    path.join(home, "AppData", "Roaming", "npm", bin),
    path.join(home, "AppData", "Local", "Volta", "bin", bin),
    path.join(home, ".local", "share", "pnpm", bin),
    "npx",
  ];
}

function execOpts(cmd: string, extra: Record<string, unknown> = {}) {
  return {
    windowsHide: true,
    env: { ...process.env },
    ...(wranglerSpawnUsesShell(cmd) ? { shell: true } : {}),
    ...extra,
  };
}

/** Resolve a runnable wrangler argv prefix (`wrangler` or `npx wrangler`). */
export async function resolveWranglerCmd(): Promise<{ cmd: string; prefixArgs: string[] }> {
  for (const raw of wranglerCandidates()) {
    if (raw === "npx") {
      const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
      return { cmd, prefixArgs: ["--yes", "wrangler"] };
    }
    const candidate = preferWindowsCmdShim(raw);
    if (candidate.includes(path.sep) || candidate.includes("/") || candidate.includes("\\")) {
      if (!fs.existsSync(candidate)) continue;
      try {
        await execFileAsync(candidate, ["--version"], execOpts(candidate, { timeout: 8_000 }));
        return { cmd: candidate, prefixArgs: [] };
      } catch {
        continue;
      }
    }
    try {
      await execFileAsync(candidate, ["--version"], execOpts(candidate, { timeout: 8_000 }));
      return { cmd: candidate, prefixArgs: [] };
    } catch {
      /* try next */
    }
  }
  return {
    cmd: process.platform === "win32" ? "npx.cmd" : "npx",
    prefixArgs: ["--yes", "wrangler"],
  };
}

/** Wrangler may print logs before JSON; parse the first valid top-level JSON value. */
export function parseWranglerStdoutJson<T>(text: string, commandLabel = "wrangler"): T {
  const trimmed = text.trim();
  if (!trimmed) throw new Error(`${commandLabel} returned empty output.`);

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    /* fall through */
  }

  for (const line of trimmed.split(/\r?\n/)) {
    const candidate = line.trim();
    if (!candidate.startsWith("{") && !candidate.startsWith("[")) continue;
    try {
      return JSON.parse(candidate) as T;
    } catch {
      continue;
    }
  }

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch !== "{" && ch !== "[") continue;
    try {
      return JSON.parse(trimmed.slice(i)) as T;
    } catch {
      continue;
    }
  }

  throw new Error(`${commandLabel} did not return JSON.`);
}

async function runWranglerJson<T>(args: string[], timeoutMs = 30_000): Promise<T> {
  const { cmd, prefixArgs } = await resolveWranglerCmd();
  try {
    const { stdout } = await execFileAsync(cmd, [...prefixArgs, ...args], {
      ...execOpts(cmd),
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    });
    const text = stdout.trim();
    if (!text) throw new Error(`wrangler ${args.join(" ")} returned empty output.`);
    return parseWranglerStdoutJson<T>(text, args.join(" "));
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : String(err);
    // Wrangler paints stderr with ANSI; keep UI messages readable.
    const msg = raw.replace(/\u001b\[[0-9;]*m/g, "").trim();
    if (/EINVAL/i.test(msg)) {
      throw new Error(
        `Failed to run Wrangler (${msg}). On Windows, set WRANGLER_PATH to wrangler.cmd, or install Wrangler (` +
          `pnpm add -g wrangler) and retry Sync. You can also paste CLOUDFLARE_API_TOKEN + account id below.`,
      );
    }
    throw new Error(msg || "Wrangler command failed.");
  }
}

export async function wranglerAuthToken(): Promise<WranglerAuthToken> {
  return runWranglerJson<WranglerAuthToken>(["auth", "token", "--json"]);
}

export async function wranglerWhoAmI(): Promise<WranglerWhoAmI> {
  return runWranglerJson<WranglerWhoAmI>(["whoami", "--json"]);
}

/**
 * Start interactive `wrangler login` in the background (opens the browser).
 * Caller should poll / sync after the user finishes OAuth.
 */
export async function startWranglerLogin(): Promise<{ started: boolean; detail: string }> {
  if (loginChild && !loginChild.killed) {
    return { started: true, detail: "Wrangler login already in progress." };
  }
  const { cmd, prefixArgs } = await resolveWranglerCmd();
  const args = [...prefixArgs, "login"];
  const useShell = wranglerSpawnUsesShell(cmd);

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const child = spawn(cmd, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
      env: { ...process.env },
      ...(useShell ? { shell: true } : {}),
    });
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      if (loginChild === child) loginChild = null;
      const msg = err.message || String(err);
      reject(
        new Error(
          /EINVAL/i.test(msg)
            ? `Failed to start Wrangler login (${msg}). On Windows use wrangler.cmd on PATH, set WRANGLER_PATH, or paste an API token + account id below.`
            : `Failed to start Wrangler login (${msg}).`,
        ),
      );
    };
    child.once("error", fail);
    // Give spawn a tick to surface synchronous Windows EINVAL via the error event.
    setTimeout(() => {
      if (settled) return;
      settled = true;
      child.unref();
      loginChild = child;
      child.on("exit", () => {
        if (loginChild === child) loginChild = null;
      });
      resolve();
    }, 50);
  });

  return {
    started: true,
    detail: `${cmd} ${args.join(" ")}`,
  };
}

export function isWranglerLoginInProgress(): boolean {
  return Boolean(loginChild && !loginChild.killed);
}
