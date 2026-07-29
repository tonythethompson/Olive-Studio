import { describe, it, expect } from "vitest";
import { isIpLiteralHost, isPrivateOrLocalHostname, sanitizeProviderBaseUrl } from "./security.ts";

describe("AI provider security", () => {
  describe("isIpLiteralHost", () => {
    it("returns true for IPv6 literals", () => {
      expect(isIpLiteralHost("::1")).toBe(true);
    });

    it("returns true for IPv4 literals", () => {
      expect(isIpLiteralHost("192.168.1.1")).toBe(true);
    });

    it("returns false for hostnames", () => {
      expect(isIpLiteralHost("api.openai.com")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isIpLiteralHost("")).toBe(false);
    });
  });

  describe("isPrivateOrLocalHostname", () => {
    it("returns true for localhost", () => {
      expect(isPrivateOrLocalHostname("localhost")).toBe(true);
    });

    it("returns true for 127.0.0.1", () => {
      expect(isPrivateOrLocalHostname("127.0.0.1")).toBe(true);
    });

    it("returns true for 10.x.x.x", () => {
      expect(isPrivateOrLocalHostname("10.0.0.1")).toBe(true);
    });

    it("returns true for 192.168.x.x", () => {
      expect(isPrivateOrLocalHostname("192.168.1.1")).toBe(true);
    });

    it("returns false for public hostnames", () => {
      expect(isPrivateOrLocalHostname("api.openai.com")).toBe(false);
    });
  });

  describe("sanitizeProviderBaseUrl", () => {
    it("returns undefined for empty input", () => {
      expect(sanitizeProviderBaseUrl("openai", "")).toBeUndefined();
    });

    it("throws on non-https URLs", () => {
      expect(() => sanitizeProviderBaseUrl("openai", "http://api.openai.com/v1")).toThrow(
        "baseUrl must use https",
      );
    });

    it("throws on IP literal hosts", () => {
      expect(() => sanitizeProviderBaseUrl("openai", "https://192.168.1.1/v1")).toThrow(
        "baseUrl host is not allowed",
      );
    });

    it("throws on localhost", () => {
      expect(() => sanitizeProviderBaseUrl("openai", "https://localhost:8080/v1")).toThrow(
        "baseUrl host is not allowed",
      );
    });

    it("allows valid provider URLs", () => {
      const result = sanitizeProviderBaseUrl("openai", "https://api.openai.com/v1");
      expect(result).toBe("https://api.openai.com/v1");
    });

    it("rejects wrong base URL for provider", () => {
      expect(() => sanitizeProviderBaseUrl("openai", "https://evil.com/v1")).toThrow(
        "baseUrl is not allowed for provider",
      );
    });
  });
});
