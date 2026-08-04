/**
 * Shared `pip install` helper used by every service that streams install
 * progress back to the UI as NDJSON (`/api/env/install-*` routes). Keeping
 * the helper in one place ensures three things stay equal across paths:
 *
 *   1. Line prefix — every line is prepended with `[deps]` so the UI
 *      recognizes the output regardless of which install route produced it.
 *   2. Error shape — `pip` launch failures and `pip install` exit non-zero
 *      produce the same `Error` class with the same prefix, so the UI
 *      can show a uniform error message.
 *   3. Stdout/stderr handling — both pipes are forwarded so `pip`'s
 *      progress bars and warnings are visible instead of being swallowed.
 *
 * Replaces the per-service copies that lived in `cuda.ts`, `tensorrt.ts`,
 * and `tensorrt-rtx.ts` before the helper was extracted; behavior is
 * unchanged.
 */
import { spawn } from "child_process";

export async function pipInstall(
  pip: string,
  args: string[],
  onLine: (line: string) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(pip, ["install", ...args], { stdio: "pipe" });
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
