/**
 * Studio env bootstrap: dotenv files + Windows User/Machine env hydration.
 *
 * On Windows, User/Machine variables set in System Properties are not always
 * present in process.env for long-lived parents (e.g. Cursor started before
 * the var existed). We fill gaps from persisted Windows env without logging secrets.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { isPlaceholderEnvValue } from "../lib/aiResponse.ts";

/** Known Olive Studio / Assistant credential env names (never log values). */
export const STUDIO_ENV_KEY_NAMES = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENAI_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "MISTRAL_API_KEY",
  "XAI_API_KEY",
  "OPENROUTER_API_KEY",
  "GROQ_API_KEY",
  "TOGETHER_API_KEY",
  "KILO_API_KEY",
  "KILOCODE_API_KEY",
  "OPENCODE_API_KEY",
  "FIREWORKS_API_KEY",
  "NVIDIA_API_KEY",
  "HF_TOKEN",
  "HUGGINGFACE_API_KEY",
  "GITHUB_COPILOT_TOKEN",
  "COPILOT_GITHUB_TOKEN",
  "GITHUB_TOKEN",
  "OPENAI_COMPAT_API_KEY",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "LM_API_TOKEN",
  "LM_STUDIO_API_KEY",
  "SYNC_KB_TOKEN",
  "OLIVE_STUDIO_WEB_SEARCH_URL",
] as const;

function isUsableEnvValue(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  return !isPlaceholderEnvValue(value);
}

/** Apply dotenv file entries; only overwrite when the file value is non-empty and non-placeholder. */
export function applyDotenvFile(filePath: string, opts?: { overrideUsable?: boolean }): void {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return;
  const parsed = dotenv.parse(fs.readFileSync(resolved));
  for (const [key, raw] of Object.entries(parsed)) {
    const value = typeof raw === "string" ? raw : "";
    if (!isUsableEnvValue(value)) continue;
    const existing = process.env[key];
    if (opts?.overrideUsable || !isUsableEnvValue(existing)) {
      process.env[key] = value.trim();
    }
  }
}

/**
 * Read persisted Windows User then Machine env for the given names.
 * Returns a map of name → value (no secrets logged by callers).
 */
export function readWindowsPersistedEnv(
  names: readonly string[],
  exec: typeof execFileSync = execFileSync,
): Record<string, string> {
  if (process.platform !== "win32" || names.length === 0) return {};

  const namesJson = JSON.stringify([...names]);
  const script = [
    `$ErrorActionPreference = 'Stop'`,
    `$names = ConvertFrom-Json -InputObject @'`,
    namesJson,
    `'@`,
    `$out = [ordered]@{}`,
    `foreach ($n in $names) {`,
    `  $u = [Environment]::GetEnvironmentVariable([string]$n, 'User')`,
    `  $m = [Environment]::GetEnvironmentVariable([string]$n, 'Machine')`,
    `  if (-not [string]::IsNullOrWhiteSpace($u)) { $out[$n] = $u }`,
    `  elseif (-not [string]::IsNullOrWhiteSpace($m)) { $out[$n] = $m }`,
    `}`,
    `($out | ConvertTo-Json -Compress)`,
  ].join("\n");

  try {
    const raw = exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
    }).trim();
    if (!raw || raw === "null" || raw === "{}") return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && isUsableEnvValue(v)) out[k] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

/** Fill process.env gaps from Windows User/Machine persisted environment. */
export function hydrateProcessEnvFromWindows(
  names: readonly string[] = STUDIO_ENV_KEY_NAMES,
  opts?: { exec?: typeof execFileSync },
): string[] {
  const persisted = readWindowsPersistedEnv(names, opts?.exec ?? execFileSync);
  const filled: string[] = [];
  for (const [name, value] of Object.entries(persisted)) {
    if (isUsableEnvValue(process.env[name])) continue;
    process.env[name] = value;
    filled.push(name);
  }
  return filled;
}

/** Full bootstrap used by server.ts. */
export function loadStudioEnv(cwd: string = process.cwd()): void {
  applyDotenvFile(path.join(cwd, ".env"));
  applyDotenvFile(path.join(cwd, ".env.local"), { overrideUsable: true });
  hydrateProcessEnvFromWindows();
}
