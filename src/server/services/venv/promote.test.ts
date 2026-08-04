import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { clearBuildingRoot, promoteBuildingToLive, writeVenvManifest } from "./promote.ts";
import { getFamilyBuildingRoot, getFamilyRoot } from "./spec.ts";

describe("promoteBuildingToLive", () => {
  let tmp: string;
  let prevCwd: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "olive-promote-"));
    prevCwd = process.cwd();
    process.chdir(tmp);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("promotes building → live when live is missing", () => {
    const building = getFamilyBuildingRoot("default");
    fs.mkdirSync(building, { recursive: true });
    fs.writeFileSync(path.join(building, "marker"), "new");
    writeVenvManifest(building, {
      family: "default",
      specVersion: 1,
      ortDistribution: "onnxruntime",
      createdAt: new Date().toISOString(),
    });

    const result = promoteBuildingToLive("default");
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(getFamilyRoot("default"), "marker"))).toBe(true);
    expect(fs.existsSync(building)).toBe(false);
  });

  it("backs up live then promotes; rolls back rename failure when building missing mid-flight", () => {
    const live = getFamilyRoot("default");
    const building = getFamilyBuildingRoot("default");
    fs.mkdirSync(live, { recursive: true });
    fs.writeFileSync(path.join(live, "old"), "1");
    fs.mkdirSync(building, { recursive: true });
    fs.writeFileSync(path.join(building, "new"), "2");

    const result = promoteBuildingToLive("default");
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(live, "new"))).toBe(true);
    // Backup retained under .venv.backup-*
    const backups = fs.readdirSync(tmp).filter((n) => n.startsWith(".venv.backup-"));
    expect(backups.length).toBe(1);
    expect(fs.existsSync(path.join(tmp, backups[0]!, "old"))).toBe(true);
  });

  it("clearBuildingRoot removes building tree", () => {
    const building = getFamilyBuildingRoot("cuda");
    fs.mkdirSync(building, { recursive: true });
    clearBuildingRoot("cuda");
    expect(fs.existsSync(building)).toBe(false);
  });
});
