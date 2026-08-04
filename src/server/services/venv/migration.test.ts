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
import { getFamilyRoot, MIGRATION_JOURNAL_PATH } from "./spec.ts";

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
    expect(fs.existsSync(MIGRATION_JOURNAL_PATH)).toBe(true);
    expect(readMigrationJournal()?.phase).toBe("building");
    writeMigrationJournal("cuda_promoted");
    expect(readMigrationJournal()?.phase).toBe("cuda_promoted");
    clearMigrationJournal();
    expect(readMigrationJournal()).toBeNull();
  });

  it("detects cuda-contaminated default venv", async () => {
    const root = getFamilyRoot("default");
    const pyDir = path.join(root, "bin");
    fs.mkdirSync(pyDir, { recursive: true });
    fs.writeFileSync(path.join(pyDir, "python"), "");
    const intent = await inspectDefaultVenvIntent(async () => ["onnxruntime-gpu"]);
    expect(intent).toBe("cuda-contaminated");
  });

  it("reports missing when default python absent", async () => {
    const intent = await inspectDefaultVenvIntent(async () => ["onnxruntime"]);
    expect(intent).toBe("missing");
  });
});
