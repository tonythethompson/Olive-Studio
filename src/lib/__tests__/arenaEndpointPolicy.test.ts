/**
 * Unit tests for isomorphic Arena outbound endpoint policy (IPv4/IPv6 blocks).
 */
import { describe, it, expect } from "vitest";
import {
  isBlockedIpv4,
  isBlockedIpv6,
  assertArenaEndpointUrlPolicy,
} from "@/lib/arenaEndpointPolicy";

describe("isBlockedIpv6", () => {
  it("blocks loopback ::1", () => {
    expect(isBlockedIpv6("::1")).toBe(true);
  });

  it("blocks link-local fe80::/10 including fe90::", () => {
    expect(isBlockedIpv6("fe80::1")).toBe(true);
    expect(isBlockedIpv6("fe90::1")).toBe(true); // still within fe80::/10
    expect(isBlockedIpv6("febf::1")).toBe(true); // top of fe80::/10
  });

  it("blocks deprecated site-local fec0::/10", () => {
    expect(isBlockedIpv6("fec0::1")).toBe(true);
    expect(isBlockedIpv6("fed0::1")).toBe(true);
  });

  it("blocks multicast ff00::/8", () => {
    expect(isBlockedIpv6("ff02::1")).toBe(true);
    expect(isBlockedIpv6("ff00::1")).toBe(true);
    expect(isBlockedIpv6("ff0e::1")).toBe(true);
  });

  it("blocks ULA fc00::/7", () => {
    expect(isBlockedIpv6("fc00::1")).toBe(true);
    expect(isBlockedIpv6("fd12:3456:789a::1")).toBe(true);
  });

  it("allows public IPv6 (e.g. Google DNS)", () => {
    expect(isBlockedIpv6("2001:4860:4860::8888")).toBe(false);
    expect(isBlockedIpv6("2606:4700:4700::1111")).toBe(false);
  });

  it("does not treat unparsable hosts as blocked IPv6", () => {
    expect(isBlockedIpv6("not-an-ip")).toBe(false);
    expect(isBlockedIpv6("8.8.8.8")).toBe(false);
  });
});

describe("isBlockedIpv4", () => {
  it("blocks private and reserved IPv4", () => {
    expect(isBlockedIpv4("10.0.0.1")).toBe(true);
    expect(isBlockedIpv4("192.168.1.1")).toBe(true);
    expect(isBlockedIpv4("127.0.0.1")).toBe(true);
    expect(isBlockedIpv4("169.254.169.254")).toBe(true);
  });

  it("allows public IPv4", () => {
    expect(isBlockedIpv4("8.8.8.8")).toBe(false);
  });
});

describe("assertArenaEndpointUrlPolicy IPv6 literals", () => {
  it("rejects multicast and site-local endpoint URLs", () => {
    expect(() => assertArenaEndpointUrlPolicy("https://[ff02::1]/v1")).toThrow(/Private/);
    expect(() => assertArenaEndpointUrlPolicy("https://[fec0::1]/v1")).toThrow(/Private/);
    expect(() => assertArenaEndpointUrlPolicy("https://[fe90::1]/v1")).toThrow(/Private/);
  });

  it("allows public IPv6 endpoint URLs", () => {
    expect(() =>
      assertArenaEndpointUrlPolicy("https://[2001:4860:4860::8888]/v1"),
    ).not.toThrow();
  });
});
