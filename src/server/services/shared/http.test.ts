import { describe, it, expect, afterEach, vi } from "vitest";
import { fetchWithTimeout, DEFAULT_FETCH_TIMEOUT_MS } from "./http.ts";

const realFetch = globalThis.fetch;

describe("fetchWithTimeout", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("resolves normally when the request completes in time", async () => {
    const ok = new Response("hello", { status: 200 });
    globalThis.fetch = vi.fn(async () => ok) as unknown as typeof fetch;

    const res = await fetchWithTimeout("https://example.com", {}, 1_000);
    expect(res.status).toBe(200);
  });

  it("passes an AbortSignal through to fetch", async () => {
    const spy = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response("ok");
    });
    globalThis.fetch = spy as unknown as typeof fetch;

    await fetchWithTimeout("https://example.com");
    expect(spy).toHaveBeenCalledOnce();
  });

  it("throws a friendly timeout error when the signal fires", async () => {
    // Simulate fetch rejecting with a TimeoutError like the platform does.
    globalThis.fetch = vi.fn(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    }) as unknown as typeof fetch;

    await expect(fetchWithTimeout("https://example.com", {}, 5)).rejects.toThrow(/timed out after 5ms/);
  });

  it("exposes a sane default timeout", () => {
    expect(DEFAULT_FETCH_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
