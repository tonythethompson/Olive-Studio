import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  clearBuildingRoot,
  promoteBuildingToLive,
  rollbackPromotedFamily,
  writeVenvManifest,
} from "./promote.ts";
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
    if (result.ok) expect(result.backupPath).toBeUndefined();
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
    if (result.ok) expect(result.backupPath).toBe(path.join(tmp, backups[0]!));
  });

  it("rollbackPromotedFamily restores backup when present", () => {
    const live = getFamilyRoot("cuda");
    const building = getFamilyBuildingRoot("cuda");
    fs.mkdirSync(live, { recursive: true });
    fs.writeFileSync(path.join(live, "old-cuda"), "1");
    fs.mkdirSync(building, { recursive: true });
    fs.writeFileSync(path.join(building, "new-cuda"), "2");

    const promoted = promoteBuildingToLive("cuda");
    expect(promoted.ok).toBe(true);
    expect(fs.existsSync(path.join(live, "new-cuda"))).toBe(true);

    const rolled = rollbackPromotedFamily("cuda", promoted.ok ? promoted.backupPath : undefined);
    expect(rolled.ok).toBe(true);
    expect(fs.existsSync(path.join(live, "old-cuda"))).toBe(true);
    expect(fs.existsSync(path.join(live, "new-cuda"))).toBe(false);
  });

  it("rollbackPromotedFamily removes newly created live when no backup", () => {
    const live = getFamilyRoot("cuda");
    const building = getFamilyBuildingRoot("cuda");
    fs.mkdirSync(building, { recursive: true });
    fs.writeFileSync(path.join(building, "fresh"), "1");
    const promoted = promoteBuildingToLive("cuda");
    expect(promoted.ok).toBe(true);
    expect(fs.existsSync(live)).toBe(true);

    const rolled = rollbackPromotedFamily("cuda", undefined);
    expect(rolled.ok).toBe(true);
    expect(fs.existsSync(live)).toBe(false);
  });

  it("clearBuildingRoot removes building tree", () => {
    const building = getFamilyBuildingRoot("cuda");
    fs.mkdirSync(building, { recursive: true });
    clearBuildingRoot("cuda");
    expect(fs.existsSync(building)).toBe(false);
  });
});
