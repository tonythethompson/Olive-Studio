import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  clearMigrationJournal,
  inspectDefaultVenvIntent,
  readMigrationJournal,
  writeMigrationJournal,
} from "./migration.ts";
import { getFamilyRoot, getMigrationJournalPath } from "./spec.ts";

function defaultPythonPath(root: string): string {
  return process.platform === "win32"
    ? path.join(root, "Scripts", "python.exe")
    : path.join(root, "bin", "python");
}

describe("migration journal", () => {
  let tmp: string;
  let prevCwd: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "olive-migrate-"));
    prevCwd = process.cwd();
    process.chdir(tmp);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("writes and clears journal outside venv roots", () => {
    writeMigrationJournal("building");
    expect(fs.existsSync(getMigrationJournalPath())).toBe(true);
    expect(readMigrationJournal()?.phase).toBe("building");
    writeMigrationJournal("cuda_promoted");
    expect(readMigrationJournal()?.phase).toBe("cuda_promoted");
    clearMigrationJournal();
    expect(readMigrationJournal()).toBeNull();
  });

  it("detects cuda-contaminated default venv", async () => {
    const root = getFamilyRoot("default");
    const py = defaultPythonPath(root);
    fs.mkdirSync(path.dirname(py), { recursive: true });
    fs.writeFileSync(py, "");
    const intent = await inspectDefaultVenvIntent(async () => ["onnxruntime-gpu"]);
    expect(intent).toBe("cuda-contaminated");
  });

  it("reports missing when default python absent", async () => {
    const intent = await inspectDefaultVenvIntent(async () => ["onnxruntime"]);
    expect(intent).toBe("missing");
  });

  it("reports unknown when ORT probe throws", async () => {
    const root = getFamilyRoot("default");
    const py = defaultPythonPath(root);
    fs.mkdirSync(path.dirname(py), { recursive: true });
    fs.writeFileSync(py, "");
    const intent = await inspectDefaultVenvIntent(async () => {
      throw new Error("probe failed");
    });
    expect(intent).toBe("unknown");
  });

  it("reports default when ORT probe finds a non-GPU wheel (post-migration fast-path)", async () => {
    const root = getFamilyRoot("default");
    const py = defaultPythonPath(root);
    fs.mkdirSync(path.dirname(py), { recursive: true });
    fs.writeFileSync(py, "");
    const intent = await inspectDefaultVenvIntent(async () => ["onnxruntime"]);
    expect(intent).toBe("default");
  });
});
