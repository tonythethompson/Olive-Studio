import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("cloudflare credentials", () => {
  let tmp: string;
  let prevCwd: string;

  beforeEach(() => {
    prevCwd = process.cwd();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "olive-cf-"));
    process.chdir(tmp);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("validates account ids and builds AI base URLs", async () => {
    const {
      isValidCloudflareAccountId,
      cloudflareAiBaseUrl,
      saveCloudflareCredentials,
      loadCloudflareCredentials,
      clearCloudflareCredentials,
    } = await import("./credentials.ts");

    expect(isValidCloudflareAccountId("abcd")).toBe(false);
    expect(isValidCloudflareAccountId("a".repeat(32))).toBe(true);
    expect(cloudflareAiBaseUrl("b".repeat(32))).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${"b".repeat(32)}/ai/v1`,
    );

    const saved = saveCloudflareCredentials({
      apiToken: "tok",
      accountId: "c".repeat(32),
      accountName: "Test",
      authType: "manual",
    });
    expect(saved.accountId).toHaveLength(32);
    expect(loadCloudflareCredentials()?.apiToken).toBe("tok");
    clearCloudflareCredentials();
    expect(loadCloudflareCredentials()).toBeNull();
  });
});
