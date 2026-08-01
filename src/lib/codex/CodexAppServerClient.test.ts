import { describe, expect, it } from "vitest";
import { codexSpawnUsesShell } from "./CodexAppServerClient.ts";

describe("codexSpawnUsesShell", () => {
  it("uses shell for bare codex on Windows", () => {
    expect(codexSpawnUsesShell("codex", "win32")).toBe(true);
    expect(codexSpawnUsesShell("codex.cmd", "win32")).toBe(true);
  });

  it("skips shell for a direct .exe path on Windows", () => {
    expect(codexSpawnUsesShell("C:\\\\Tools\\\\codex.exe", "win32")).toBe(false);
  });

  it("never uses shell on non-Windows", () => {
    expect(codexSpawnUsesShell("codex", "linux")).toBe(false);
    expect(codexSpawnUsesShell("codex", "darwin")).toBe(false);
  });
});
