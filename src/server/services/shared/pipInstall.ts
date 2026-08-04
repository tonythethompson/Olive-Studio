/**
 * Shared `pip install` helper used by every service that streams install
 * progress back to the UI as NDJSON (`/api/env/install-*` routes).
 *
 * Prefer `pipInstallViaPython` (`python -m pip`) with an isolated family env.
 * The legacy `pipInstall(pipExe, …)` path remains for transitional callers.
 */
import { spawn } from "child_process";

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
