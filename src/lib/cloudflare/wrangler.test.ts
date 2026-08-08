import { describe, it, expect } from "vitest";
import { parseWranglerStdoutJson, wranglerSpawnUsesShell } from "./wrangler.ts";

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

describe("parseWranglerStdoutJson", () => {
  it("parses JSON when logs precede the payload", () => {
    const payload = {
      email: "dev@example.com",
      accounts: [{ id: "abc123456789012345678901234567890", name: "Primary" }],
    };
    const text = `Getting User settings...\n${JSON.stringify(payload)}`;
    expect(parseWranglerStdoutJson<typeof payload>(text)).toEqual(payload);
  });

  it("parses JSON when logs precede the payload on the same line", () => {
    const payload = {
      email: "dev@example.com",
      accounts: [{ id: "abc123456789012345678901234567890", name: "Primary" }],
    };
    const text = `Getting User settings...${JSON.stringify(payload)}`;
    expect(parseWranglerStdoutJson<typeof payload>(text)).toEqual(payload);
  });

  it("prefers the first top-level object when a trailing sibling follows", () => {
    const payload = {
      email: "dev@example.com",
      accounts: [{ id: "abc123456789012345678901234567890", name: "Primary" }],
    };
    const text = `${JSON.stringify(payload)}\n{"nested": true}`;
    expect(parseWranglerStdoutJson<typeof payload>(text).accounts).toHaveLength(1);
  });
});
