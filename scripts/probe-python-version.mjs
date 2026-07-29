#!/usr/bin/env node
/**
 * Probe `python --version` for an absolute interpreter path.
 * Invoked as: node scripts/probe-python-version.mjs <absolute-python>
 *
 * Kept as a fixed Node entrypoint so the Express process never passes a
 * user-supplied string as execFile's executable (CodeQL command-injection).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PYTHON_BASENAME_RE = /^python(\d+(\.\d+)*)?(\.exe)?$/i;

function allowedRoots() {
  const roots = [
    path.resolve("/usr"),
    path.resolve("/usr/local"),
    path.resolve("/opt"),
    path.resolve("/home"),
    path.resolve(os.homedir()),
    path.resolve(process.cwd(), ".venv"),
  ];
  if (process.platform === "win32") {
    for (const key of ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)", "USERPROFILE"]) {
      const v = process.env[key];
      if (v) roots.push(path.resolve(v));
    }
  }
  return roots;
}

function isUnderRoot(resolved) {
  const normalized = path.normalize(resolved);
  if (normalized.includes("\0") || normalized.includes("..")) return false;
  for (const root of allowedRoots()) {
    const rootNorm = path.normalize(root);
    const prefix = rootNorm.endsWith(path.sep) ? rootNorm : rootNorm + path.sep;
    if (normalized === rootNorm || normalized.startsWith(prefix)) return true;
  }
  return false;
}

const target = process.argv[2];
if (!target || target.includes("\0")) {
  process.stderr.write("missing python path\n");
  process.exit(2);
}
const resolved = path.resolve(target);
if (!path.isAbsolute(resolved) || !isUnderRoot(resolved) || !PYTHON_BASENAME_RE.test(path.basename(resolved))) {
  process.stderr.write("python path not allowed\n");
  process.exit(2);
}
if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
  process.stderr.write("python path not a file\n");
  process.exit(2);
}

try {
  const out = execFileSync(resolved, ["--version"], {
    encoding: "utf8",
    timeout: 8000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  process.stdout.write(typeof out === "string" ? out : String(out));
  process.exit(0);
} catch (err) {
  const stderr = err && typeof err === "object" && "stderr" in err ? String(err.stderr ?? "") : "";
  const stdout = err && typeof err === "object" && "stdout" in err ? String(err.stdout ?? "") : "";
  process.stdout.write(stdout);
  process.stderr.write(stderr || (err instanceof Error ? err.message : String(err)));
  process.exit(1);
}
