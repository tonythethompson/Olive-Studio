import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsrsSupported =
  (process.platform === "linux" && ["x64", "arm64"].includes(process.arch)) ||
  (process.platform === "darwin" && process.arch === "arm64");
const binDirectory = resolve(root, "node_modules", ".bin");
const tsrsExecutable = resolve(binDirectory, "tsrs");
const typescript7Cli = resolve(root, "node_modules", "typescript7", "bin", "tsc");
let command;
let args = ["--noEmit"];
let shell = false;

if (tsrsSupported && existsSync(tsrsExecutable)) {
  command = tsrsExecutable;
} else if (existsSync(typescript7Cli)) {
  command = process.execPath;
  args = [typescript7Cli, ...args];
} else {
  command = resolve(binDirectory, process.platform === "win32" ? "tsc.cmd" : "tsc");
  shell = process.platform === "win32";
}

const result = spawnSync(command, args, {
  cwd: root,
  stdio: "inherit",
  shell,
});

if (result.error) {
  console.error(`Failed to start TypeScript type checker: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
