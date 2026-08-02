import { describe, it, expect } from "vitest";
import {
  assertUrlPolicy,
  isBlockedIpAddress,
  isBlockedIpv4,
  isLoopbackIp,
  isLoopbackHostname,
  resolvePinnedAddresses,
} from "./ssrfGuard.ts";

describe("ssrfGuard IP classification", () => {
  it("blocks private and link-local IPv4", () => {
    expect(isBlockedIpv4("10.0.0.1")).toBe(true);
    expect(isBlockedIpv4("192.168.1.1")).toBe(true);
    expect(isBlockedIpv4("172.16.0.1")).toBe(true);
    expect(isBlockedIpv4("127.0.0.1")).toBe(true);
    expect(isBlockedIpv4("169.254.169.254")).toBe(true);
    expect(isBlockedIpv4("100.64.0.1")).toBe(true);
    expect(isBlockedIpv4("0.0.0.0")).toBe(true);
  });

  it("allows public IPv4", () => {
    expect(isBlockedIpv4("8.8.8.8")).toBe(false);
    expect(isBlockedIpv4("1.1.1.1")).toBe(false);
    expect(isBlockedIpv4("93.184.216.34")).toBe(false);
  });

  it("blocks loopback / ULA IPv6 and mapped private IPv4", () => {
    expect(isBlockedIpAddress("::1")).toBe(true);
    expect(isBlockedIpAddress("fe80::1")).toBe(true);
    expect(isBlockedIpAddress("fd12:3456:789a::1")).toBe(true);
    expect(isBlockedIpAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedIpAddress("::ffff:10.1.2.3")).toBe(true);
  });

  it("blocks hex-compressed IPv4-mapped IPv6 (Node URL hostname form)", () => {
    // Node rewrites https://[::ffff:127.0.0.1]/ → hostname [::ffff:7f00:1]
    expect(isBlockedIpAddress("::ffff:7f00:1")).toBe(true);
    expect(isBlockedIpAddress("::ffff:a9fe:a9fe")).toBe(true); // 169.254.169.254
    expect(isBlockedIpAddress("[::ffff:7f00:1]")).toBe(true);
    expect(isLoopbackIp("::ffff:7f00:1")).toBe(true);
    expect(isLoopbackIp("::ffff:a9fe:a9fe")).toBe(false);
  });

  it("detects loopback helpers", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
    expect(isLoopbackIp("127.0.0.1")).toBe(true);
    expect(isLoopbackIp("::1")).toBe(true);
  });
});

describe("assertUrlPolicy", () => {
  it("requires https for non-loopback hosts", () => {
    expect(() =>
      assertUrlPolicy(new URL("http://api.example.com/v1"), { allowLoopbackHttp: false }),
    ).toThrow(/HTTPS/);
  });

  it("rejects credentialed URLs", () => {
    expect(() =>
      assertUrlPolicy(new URL("https://user:pass@api.example.com/v1"), {
        allowLoopbackHttp: false,
      }),
    ).toThrow(/Credentialed/);
  });

  it("rejects literal private IPs", () => {
    expect(() =>
      assertUrlPolicy(new URL("https://169.254.169.254/latest"), { allowLoopbackHttp: false }),
    ).toThrow(/Private/);
  });

  it("rejects IPv4-mapped literals after Node normalizes to hex form", () => {
    expect(() =>
      assertUrlPolicy(new URL("https://[::ffff:127.0.0.1]/v1"), { allowLoopbackHttp: false }),
    ).toThrow(/Private/);
    expect(() =>
      assertUrlPolicy(new URL("https://[::ffff:169.254.169.254]/latest"), {
        allowLoopbackHttp: false,
      }),
    ).toThrow(/Private/);
  });

  it("allows loopback http only when policy says so", () => {
    expect(() =>
      assertUrlPolicy(new URL("http://127.0.0.1:11434/v1"), { allowLoopbackHttp: false }),
    ).toThrow(/HTTPS/);
    expect(() =>
      assertUrlPolicy(new URL("http://127.0.0.1:11434/v1"), { allowLoopbackHttp: true }),
    ).not.toThrow();
  });
});

describe("resolvePinnedAddresses", () => {
  it("returns the literal public IP without DNS", async () => {
    const addrs = await resolvePinnedAddresses("8.8.8.8", { allowLoopbackHttp: false });
    expect(addrs).toEqual(["8.8.8.8"]);
  });

  it("rejects literal private IP", async () => {
    await expect(
      resolvePinnedAddresses("10.0.0.5", { allowLoopbackHttp: false }),
    ).rejects.toThrow(/Private/);
  });
});
