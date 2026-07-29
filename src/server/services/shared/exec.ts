import { execFile } from "child_process";
import { promisify } from "util";

/** Shared promisified execFile — use this instead of creating local copies. */
export const execFileAsync = promisify(execFile);
