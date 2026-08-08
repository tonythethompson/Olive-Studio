#!/usr/bin/env node
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.join(__dirname, "..");
const serverPath = path.join(pkgDir, "dist", "server.mjs");
const legacyServerPath = path.join(pkgDir, "dist", "server.cjs");
const resolvedServer = fs.existsSync(serverPath)
  ? serverPath
  : fs.existsSync(legacyServerPath)
    ? legacyServerPath
    : null;

if (!resolvedServer) {
  console.error(
    "olive-studio: dist/server.mjs not found. Run `pnpm build` first (from a clone of this repo)."
  );
  process.exit(1);
}

const openBrowser = () => {
  const url = "http://localhost:3000";
  const args = process.platform === "win32" ? ["start", "", url]
    : process.platform === "darwin" ? ["open", url]
    : ["xdg-open", url];
  const cmd = args.shift();
  spawn(cmd, args, { shell: process.platform === "win32", detached: true, stdio: "ignore" }).unref();
};

console.log("Starting Olive Studio at http://localhost:3000 ...");

const server = spawn(process.execPath, [resolvedServer], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: "production",
    OLIVE_DIST_DIR: path.join(pkgDir, "dist"),
  },
  stdio: "inherit",
});

server.on("spawn", () => setTimeout(openBrowser, 1500));
server.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => server.kill("SIGINT"));
process.on("SIGTERM", () => server.kill("SIGTERM"));
