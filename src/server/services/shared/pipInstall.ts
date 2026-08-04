/**
 * Shared `pip install` helper used by every service that streams install
 * progress back to the UI as NDJSON (`/api/env/install-*` routes).
 *
 * Prefer `pipInstallViaPython` (`python -m pip`) with an isolated family env.
 * Capability installs should use `pipInstallForFamily` so packageConstraints
 * are enforced (no OpenVINO ORT swap; CUDA keeps pinned onnxruntime-gpu).
 * The legacy `pipInstall(pipExe, …)` path remains for transitional callers.
 */
import { spawn } from "child_process";
import type { VenvFamily } from "../../../lib/venvFamily.ts";
import { envForFamily } from "../venv/pathIsolation.ts";
import {
  assertFamilyOrtConstraints,
  enforcePackageConstraintsOrThrow,
  withFamilyPipConstraintArgs,
} from "../venv/packageConstraints.ts";
import { conflictingOrtDistributions, getFamilySpec } from "../venv/spec.ts";

export async function pipInstallViaPython(
  python: string,
  args: string[],
  onLine: (line: string) => void,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(python, ["-m", "pip", "install", ...args], { stdio: "pipe", env });
    proc.stdout.on("data", (d: Buffer) => onLine("[deps] " + d.toString().trim()));
    proc.stderr.on("data", (d: Buffer) => onLine("[deps] " + d.toString().trim()));
    proc.on("error", (err: Error) =>
      reject(
        new Error(
          `Failed to launch ${python} -m pip: ${err.message}. Create the project runtime via Setup first.`,
        ),
      ),
    );
    proc.on("close", (code: number | null) =>
      code === 0
        ? resolve()
        : reject(new Error(`pip install ${args.join(" ")} failed (exit ${code})`)),
    );
  });
}

async function pipUninstallViaPython(
  python: string,
  packages: string[],
  onLine: (line: string) => void,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  if (packages.length === 0) return;
  await new Promise<void>((resolve) => {
    const proc = spawn(python, ["-m", "pip", "uninstall", "-y", ...packages], {
      stdio: "pipe",
      env,
    });
    proc.stdout.on("data", (d: Buffer) => onLine("[deps] " + d.toString().trim()));
    proc.stderr.on("data", (d: Buffer) => onLine("[deps] " + d.toString().trim()));
    proc.on("error", () => resolve());
    proc.on("close", () => resolve());
  });
}

/**
 * Family-scoped pip install: reject forbidden ORT args, inject packageConstraints
 * via `--constraint`, run under `envForFamily`, then assert ORT integrity.
 *
 * If post-install ORT constraints fail, heal once by uninstalling conflicting
 * ORT distributions and reinstalling family packageConstraints, then re-assert.
 * Full building-tree promote for every capability install is intentionally not
 * used (too heavy); heal is the recovery path.
 */
export async function pipInstallForFamily(
  family: VenvFamily,
  python: string,
  args: string[],
  onLine: (line: string) => void,
): Promise<void> {
  enforcePackageConstraintsOrThrow(family, args);
  const initialOrtError = await assertFamilyOrtConstraints(family, python);
  if (initialOrtError) throw new Error(initialOrtError);
  const constrained = withFamilyPipConstraintArgs(family, args);
  const env = envForFamily(family);
  try {
    await pipInstallViaPython(python, constrained.args, onLine, env);
  } finally {
    constrained.cleanup();
  }
  let ortError = await assertFamilyOrtConstraints(family, python);
  if (!ortError) return;

  onLine(
    `[deps] ORT constraints violated after install — healing ${family} runtime once (${ortError})...`,
  );
  const spec = getFamilySpec(family);
  const conflicts = conflictingOrtDistributions(spec.ortDistribution);
  await pipUninstallViaPython(python, [...conflicts], onLine, env);
  await pipInstallViaPython(python, [...spec.packageConstraints], onLine, env);
  ortError = await assertFamilyOrtConstraints(family, python);
  if (ortError) {
    throw new Error(`ORT constraints still violated after heal: ${ortError}`);
  }
  onLine(`[deps] ${family} runtime ORT constraints restored after heal`);
}

/** @deprecated Prefer pipInstallViaPython with envForFamily. */
export async function pipInstall(
  pip: string,
  args: string[],
  onLine: (line: string) => void,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(pip, ["install", ...args], { stdio: "pipe", env });
    proc.stdout.on("data", (d: Buffer) => onLine("[deps] " + d.toString().trim()));
    proc.stderr.on("data", (d: Buffer) => onLine("[deps] " + d.toString().trim()));
    proc.on("error", (err: Error) =>
      reject(
        new Error(
          `Failed to launch ${pip}: ${err.message}. Create the project .venv via Setup runtime first.`,
        ),
      ),
    );
    proc.on("close", (code: number | null) =>
      code === 0
        ? resolve()
        : reject(new Error(`pip install ${args.join(" ")} failed (exit ${code})`)),
    );
  });
}
