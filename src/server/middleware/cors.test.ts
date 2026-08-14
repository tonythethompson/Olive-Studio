import { describe, expect, it } from "vitest";
import { isTrustedStudioOrigin } from "./cors.ts";

describe("isTrustedStudioOrigin", () => {
  it("allows missing origin (non-browser local clients)", () => {
    expect(isTrustedStudioOrigin(undefined)).toBe(true);
  });

  it("allows loopback and Tauri webview origins", () => {
    expect(isTrustedStudioOrigin("http://localhost:3000")).toBe(true);
    expect(isTrustedStudioOrigin("http://127.0.0.1:3000")).toBe(true);
    expect(isTrustedStudioOrigin("tauri://localhost")).toBe(true);
    expect(isTrustedStudioOrigin("https://tauri.localhost")).toBe(true);
  });

  it("rejects untrusted browser origins", () => {
    expect(isTrustedStudioOrigin("https://evil.example")).toBe(false);
    expect(isTrustedStudioOrigin("not a url")).toBe(false);
  });
});
