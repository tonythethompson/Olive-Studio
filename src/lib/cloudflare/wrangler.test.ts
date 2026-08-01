import { describe, it, expect } from "vitest";
import { wranglerSpawnUsesShell } from "./wrangler.ts";

describe("wranglerSpawnUsesShell", () => {
  it("uses a shell for .cmd / bare names on Windows", () => {
    expect(wranglerSpawnUsesShell("wrangler.cmd", "win32")).toBe(true);
    expect(wranglerSpawnUsesShell("npx.cmd", "win32")).toBe(true);
    expect(wranglerSpawnUsesShell("wrangler", "win32")).toBe(true);
  });

  it("skips the shell for .exe on Windows", () => {
    expect(wranglerSpawnUsesShell("C:\\\\Tools\\\\wrangler.exe", "win32")).toBe(false);
  });

  it("never forces a shell on non-Windows", () => {
    expect(wranglerSpawnUsesShell("wrangler.cmd", "linux")).toBe(false);
    expect(wranglerSpawnUsesShell("wrangler", "darwin")).toBe(false);
  });
});
