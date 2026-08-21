/**
 * Server-only native Playground sidecar runner.
 * Do not import from the browser bundle.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getVenvPython } from "../venv/paths.ts";
import { type VenvFamily, VENV_FAMILIES } from "../../../lib/venvFamily.ts";
import { getFamilyRoot } from "../venv/spec.ts";
import {
  resolveOliveOutputForDownload,
  listOliveOutputs,
  type OliveOutputResolveOk,
} from "./oliveOutputScan.ts";

export type NativeTensor = {
  dtype: string;
  dims: number[];
  data: number[];
};

export type NativeRequest = {
  model_path: string;
  execution_provider?: string;
  inputs?: Record<string, NativeTensor>;
  default_input?: NativeTensor;
  warmup_iterations?: number;
  iterations?: number;
  batch_size?: number;
  include_outputs?: boolean;
};

export type NativeResponse = {
  ok: boolean;
  error?: string;
  ep_used?: string;
  session_create_ms?: number;
  latencies_ms?: number[];
  avg_ms?: number;
  min_ms?: number;
  max_ms?: number;
  p50_ms?: number;
  p99_ms?: number;
  throughput_per_sec?: number;
  output_shapes?: string[];
  output_preview?: string;
};

const SIDEAR_TIMEOUT_MS = 120_000;

function findSidecarBinary(): string | undefined {
  const binName = `native-playground${process.platform === "win32" ? ".exe" : ""}`;
  const candidates = [
    path.join(process.cwd(), "src-tauri", "target", "release", binName),
    path.join(process.cwd(), "src-tauri", "target", "debug", binName),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return undefined;
}

function sidecarEnv(dylibPath: string): NodeJS.ProcessEnv {
  const libDir = path.dirname(dylibPath);
  const env: NodeJS.ProcessEnv = { ...process.env, ORT_DYLIB_PATH: dylibPath };
  // Windows uses PATH; Unix uses LD_LIBRARY_PATH / DYLD_LIBRARY_PATH.
  if (process.platform === "win32") {
    env.PATH = libDir + path.delimiter + (process.env.PATH ?? "");
  } else {
    env.LD_LIBRARY_PATH = libDir + path.delimiter + (process.env.LD_LIBRARY_PATH ?? "");
    env.DYLD_LIBRARY_PATH = libDir + path.delimiter + (process.env.DYLD_LIBRARY_PATH ?? "");
  }
  return env;
}

export function isSafeVenvPython(pythonPath: string, family: VenvFamily): boolean {
  // Validate the family against an allowlist so untrusted input can never
  // influence the executable path passed to spawnSync.
  if (!VENV_FAMILIES.includes(family)) return false;
  const root = path.resolve(getFamilyRoot(family));
  const resolved = path.resolve(pythonPath);
  // Ensure the resolved python path is inside the expected venv root.
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return false;
  // Only allow paths to the expected python binary name.
  const basename = path.basename(resolved);
  const expected = process.platform === "win32" ? "python.exe" : "python";
  if (basename !== expected) return false;
  return true;
}

function findOrtDylibInVenv(venvFamily: VenvFamily = "default"): string | undefined {
  const python = getVenvPython(venvFamily);
  if (!isSafeVenvPython(python, venvFamily)) return undefined;
  if (!fs.existsSync(python)) return undefined;

  const script = `
import glob, os, importlib.util
spec = importlib.util.find_spec("onnxruntime")
base = os.path.dirname(spec.origin) if spec else ""
patterns = [
    os.path.join(base, "**", "onnxruntime.dll"),
    os.path.join(base, "**", "libonnxruntime*.so"),
    os.path.join(base, "**", "libonnxruntime*.dylib"),
    os.path.join(base, "..", "onnxruntime.dll"),
    os.path.join(base, "..", "libonnxruntime*.so"),
    os.path.join(base, "..", "libonnxruntime*.dylib"),
]
files = []
for p in patterns:
    files.extend(glob.glob(p, recursive=True))
print(files[0] if files else "")
`;

  try {
    const result = spawnSync(python, ["-c", script], { encoding: "utf-8", timeout: 15_000 });
    const found = result.stdout?.trim();
    if (found && fs.existsSync(found)) return found;
  } catch {
    // ignore
  }
  return undefined;
}

function collectOutput(
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
      reject(new Error(`Native sidecar timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      if (killed) return;
      resolve({ stdout, stderr, exitCode });
    });
  });
}

export type NativeModelRef = { id: string; family?: VenvFamily };

export async function resolveNativeModel(
  ref: NativeModelRef,
): Promise<OliveOutputResolveOk | { ok: false; status: 400 | 403 }> {
  // Ensure the registry is populated if the id is missing.
  if (!resolveOliveOutputForDownload(ref.id).ok) {
    listOliveOutputs();
  }
  return resolveOliveOutputForDownload(ref.id);
}

export async function runNativeSidecar(
  req: NativeRequest,
  venvFamily: VenvFamily = "default",
): Promise<NativeResponse> {
  const binary = findSidecarBinary();
  if (!binary) {
    throw new Error(
      "Native Playground sidecar not found. Build the desktop shell with `cargo build --bin native-playground`.",
    );
  }

  const dylib = findOrtDylibInVenv(venvFamily);
  if (!dylib) {
    throw new Error(
      `ONNX Runtime dynamic library not found in the ${venvFamily} venv.`,
    );
  }

  const env = sidecarEnv(dylib);
  const child = spawn(binary, [], { env, stdio: ["pipe", "pipe", "pipe"] });

  child.stdin?.write(JSON.stringify(req) + "\n");
  child.stdin?.end();

  const { stdout, stderr, exitCode } = await collectOutput(child, SIDEAR_TIMEOUT_MS);

  if (exitCode !== 0) {
    throw new Error(
      `Native sidecar exited with code ${exitCode}: ${stderr || stdout || "unknown error"}`,
    );
  }

  const lastLine = stdout.trim().split(/\r?\n/).pop() ?? stdout.trim();
  if (!lastLine) {
    throw new Error(`Native sidecar returned no output: ${stderr}`);
  }

  try {
    const parsed = JSON.parse(lastLine) as NativeResponse;
    if (!parsed.ok) {
      throw new Error(parsed.error || "Native sidecar returned an error");
    }
    return parsed;
  } catch (e) {
    throw new Error(
      `Native sidecar output was not valid JSON: ${e instanceof Error ? e.message : String(e)}. Output: ${lastLine}. Stderr: ${stderr}`,
    );
  }
}

export function buildNativeRequest(
  modelPath: string,
  inputs: Record<string, NativeTensor>,
  opts: {
    executionProvider?: string;
    defaultInput?: NativeTensor;
    warmupIterations?: number;
    iterations?: number;
    batchSize?: number;
    includeOutputs?: boolean;
  } = {},
): NativeRequest {
  return {
    model_path: modelPath,
    execution_provider: opts.executionProvider,
    inputs,
    default_input: opts.defaultInput,
    warmup_iterations: opts.warmupIterations ?? 0,
    iterations: opts.iterations ?? 1,
    batch_size: opts.batchSize ?? 1,
    include_outputs: opts.includeOutputs ?? false,
  };
}
