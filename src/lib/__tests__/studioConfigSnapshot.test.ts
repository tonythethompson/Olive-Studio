/**
 * Exact Studio config snapshot/restore (mcp-agent-smoke contract).
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  restoreStudioConfigFile,
  snapshotStudioConfigFile,
} from "../../../scripts/studioConfigSnapshot.mjs";

describe("studioConfigSnapshot", () => {
  /** @type {string} */
  let root;
  /** @type {string} */
  let configPath;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "olive-studio-cfg-snap-"));
    configPath = path.join(root, ".olive-studio", "config.json");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("restores exact bytes including omitted agentAccess fields", () => {
    mkdirSync(path.dirname(configPath), { recursive: true });
    const original = '{\n  "hfToken": null\n}\n';
    writeFileSync(configPath, original, "utf8");

    const snap = snapshotStudioConfigFile(configPath);
    writeFileSync(
      configPath,
      JSON.stringify(
        {
          hfToken: null,
          agentAccess: { allowJobSubmission: true, allowJobCancellation: true },
        },
        null,
        2,
      ),
      "utf8",
    );

    restoreStudioConfigFile(configPath, snap);
    expect(readFileSync(configPath, "utf8")).toBe(original);
    expect(JSON.parse(readFileSync(configPath, "utf8")).agentAccess).toBeUndefined();
  });

  it("removes a config file that did not exist before the smoke", () => {
    expect(existsSync(configPath)).toBe(false);
    const snap = snapshotStudioConfigFile(configPath);

    mkdirSync(path.dirname(configPath), { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({ agentAccess: { allowJobSubmission: true } }, null, 2),
      "utf8",
    );
    expect(existsSync(configPath)).toBe(true);

    restoreStudioConfigFile(configPath, snap);
    expect(existsSync(configPath)).toBe(false);
  });
});
