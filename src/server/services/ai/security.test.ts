import { describe, it, expect } from "vitest";
import {
  isIpLiteralHost,
  isPrivateOrLocalHostname,
  sanitizeProviderBaseUrl,
  stripTrailingSlashes,
} from "./security.ts";

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

    it("preserves valid Bedrock regions without parsing them as URLs", () => {
      expect(sanitizeProviderBaseUrl("bedrock", "us-east-1")).toBe("us-east-1");
      // Multi-segment regions (gov, isoe, ...) must survive sanitization too.
      expect(sanitizeProviderBaseUrl("bedrock", "us-gov-west-1")).toBe("us-gov-west-1");
      expect(() => sanitizeProviderBaseUrl("bedrock", "https://example.com")).toThrow(
        "Invalid AWS Bedrock region",
      );
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

    it("strips trailing slashes without regex ReDoS", () => {
      const result = sanitizeProviderBaseUrl("openai", "https://api.openai.com/v1///");
      expect(result).toBe("https://api.openai.com/v1");
    });

    it("rejects wrong base URL for provider", () => {
      expect(() => sanitizeProviderBaseUrl("openai", "https://evil.com/v1")).toThrow(
        "baseUrl is not allowed for provider",
      );
    });

    it("allows built-in Ollama / LM Studio loopback without OLIVE_ALLOW_LOOPBACK_HTTP", () => {
      const prev = process.env.OLIVE_ALLOW_LOOPBACK_HTTP;
      delete process.env.OLIVE_ALLOW_LOOPBACK_HTTP;
      try {
        expect(sanitizeProviderBaseUrl("openai-compat", "http://127.0.0.1:11434/v1")).toBe(
          "http://127.0.0.1:11434/v1",
        );
        expect(sanitizeProviderBaseUrl("openai-compat", "http://127.0.0.1:1234/v1")).toBe(
          "http://127.0.0.1:1234/v1",
        );
        expect(sanitizeProviderBaseUrl("openai-compat", "http://[::1]:11434/v1")).toBe(
          "http://[::1]:11434/v1",
        );
      } finally {
        if (prev === undefined) delete process.env.OLIVE_ALLOW_LOOPBACK_HTTP;
        else process.env.OLIVE_ALLOW_LOOPBACK_HTTP = prev;
      }
    });

    it("allows loopback http for openai-compat when OLIVE_ALLOW_LOOPBACK_HTTP is set", () => {
      const prev = process.env.OLIVE_ALLOW_LOOPBACK_HTTP;
      process.env.OLIVE_ALLOW_LOOPBACK_HTTP = "1";
      try {
        expect(sanitizeProviderBaseUrl("openai-compat", "http://127.0.0.1:11434/v1")).toBe(
          "http://127.0.0.1:11434/v1",
        );
        expect(sanitizeProviderBaseUrl("openai-compat", "http://localhost:1234/v1")).toBe(
          "http://localhost:1234/v1",
        );
      } finally {
        if (prev === undefined) delete process.env.OLIVE_ALLOW_LOOPBACK_HTTP;
        else process.env.OLIVE_ALLOW_LOOPBACK_HTTP = prev;
      }
    });

    it("still rejects LAN http and non-loopback for openai-compat", () => {
      expect(() => sanitizeProviderBaseUrl("openai-compat", "http://192.168.1.10:11434/v1")).toThrow(
        "baseUrl must use https",
      );
      expect(() => sanitizeProviderBaseUrl("openai", "http://127.0.0.1:11434/v1")).toThrow(
        "baseUrl must use https",
      );
    });

    it("allows Cloudflare account-scoped AI base URLs", () => {
      const account = "a".repeat(32);
      const url = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1`;
      expect(sanitizeProviderBaseUrl("cloudflare", url)).toBe(url);
      expect(() =>
        sanitizeProviderBaseUrl("cloudflare", "https://evil.example/client/v4/accounts/x/ai/v1"),
      ).toThrow(/not allowed/);
    });

    it("rejects Cloudflare URLs with invalid account IDs under the allowed prefix", () => {
      expect(() =>
        sanitizeProviderBaseUrl(
          "cloudflare",
          "https://api.cloudflare.com/client/v4/accounts/not-a-valid-id/ai/v1",
        ),
      ).toThrow(/valid 32-hex account ID/);
    });

    it("allows Fireworks, NVIDIA, and Hugging Face prefixes", () => {
      expect(sanitizeProviderBaseUrl("fireworks", "https://api.fireworks.ai/inference/v1")).toBe(
        "https://api.fireworks.ai/inference/v1",
      );
      expect(sanitizeProviderBaseUrl("nvidia", "https://integrate.api.nvidia.com/v1")).toBe(
        "https://integrate.api.nvidia.com/v1",
      );
      expect(sanitizeProviderBaseUrl("huggingface", "https://router.huggingface.co/v1")).toBe(
        "https://router.huggingface.co/v1",
      );
    });
  });

  describe("stripTrailingSlashes", () => {
    it("removes trailing slashes", () => {
      expect(stripTrailingSlashes("https://x.com/v1///")).toBe("https://x.com/v1");
      expect(stripTrailingSlashes("noslash")).toBe("noslash");
      expect(stripTrailingSlashes("")).toBe("");
    });
  });
});
