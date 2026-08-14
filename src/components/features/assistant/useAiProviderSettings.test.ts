import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAiProviderSettings } from "./useAiProviderSettings";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("useAiProviderSettings", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls onProviderCleared when handleCodexLogout results in source 'none'", async () => {
    const onProviderCleared = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes("codex/logout")) return Promise.resolve(jsonResponse({ ok: true }));
      if (urlStr.includes("codex/account")) return Promise.resolve(jsonResponse({ ready: false }));
      if (urlStr.includes("ai/provider")) return Promise.resolve(jsonResponse({ source: "none" }));
      return Promise.resolve(jsonResponse({}));
    });

    const { result } = renderHook(() =>
      useAiProviderSettings({
        isOpen: true,
        activeTab: "settings",
        onProviderActivated: vi.fn(),
        onProviderCleared,
        onProviderMissing: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleCodexLogout();
    });

    expect(fetchSpy).toHaveBeenCalledWith("/api/codex/logout", { method: "POST" });
    expect(onProviderCleared).toHaveBeenCalledTimes(1);
  });

  it("clears retained Codex runtime provider and review on logout", async () => {
    const onProviderCleared = vi.fn();
    let providerDeleted = false;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url: unknown, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("codex/logout")) return Promise.resolve(jsonResponse({ ok: true }));
      if (urlStr.includes("codex/account")) return Promise.resolve(jsonResponse({ ready: false }));
      if (urlStr.includes("ai/provider") && init?.method === "DELETE") {
        providerDeleted = true;
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      if (urlStr.includes("ai/provider")) {
        return Promise.resolve(
          jsonResponse(
            providerDeleted
              ? { source: "none" }
              : { source: "runtime", provider: "codex", model: "default" },
          ),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });

    const { result } = renderHook(() =>
      useAiProviderSettings({
        isOpen: true,
        activeTab: "settings",
        onProviderActivated: vi.fn(),
        onProviderCleared,
        onProviderMissing: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleCodexLogout();
    });

    expect(fetchSpy).toHaveBeenCalledWith("/api/ai/provider", { method: "DELETE" });
    expect(onProviderCleared).toHaveBeenCalledTimes(1);
    expect(result.current.providerStatus.source).toBe("none");
  });

  it("calls onProviderCleared when handleDevinLogout results in source 'none'", async () => {
    const onProviderCleared = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes("devin/logout")) return Promise.resolve(jsonResponse({ ok: true }));
      if (urlStr.includes("ai/provider")) return Promise.resolve(jsonResponse({ source: "none" }));
      return Promise.resolve(jsonResponse({}));
    });

    const { result } = renderHook(() =>
      useAiProviderSettings({
        isOpen: true,
        activeTab: "settings",
        onProviderActivated: vi.fn(),
        onProviderCleared,
        onProviderMissing: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleDevinLogout();
    });

    expect(fetchSpy).toHaveBeenCalledWith("/api/devin/logout", { method: "POST" });
    expect(onProviderCleared).toHaveBeenCalledTimes(1);
  });

  it("clears retained Devin runtime provider and review on logout", async () => {
    const onProviderCleared = vi.fn();
    let providerDeleted = false;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url: unknown, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("devin/logout")) return Promise.resolve(jsonResponse({ ok: true }));
      if (urlStr.includes("ai/provider") && init?.method === "DELETE") {
        providerDeleted = true;
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      if (urlStr.includes("ai/provider")) {
        return Promise.resolve(
          jsonResponse(
            providerDeleted
              ? { source: "none" }
              : { source: "runtime", provider: "devin", model: "swe-1-6" },
          ),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });

    const { result } = renderHook(() =>
      useAiProviderSettings({
        isOpen: true,
        activeTab: "settings",
        onProviderActivated: vi.fn(),
        onProviderCleared,
        onProviderMissing: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleDevinLogout();
    });

    expect(fetchSpy).toHaveBeenCalledWith("/api/ai/provider", { method: "DELETE" });
    expect(onProviderCleared).toHaveBeenCalledTimes(1);
    expect(result.current.providerStatus.source).toBe("none");
  });

  it("clears review when retained Codex provider DELETE rejects after logout", async () => {
    const onProviderCleared = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url: unknown, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("codex/logout")) return Promise.resolve(jsonResponse({ ok: true }));
      if (urlStr.includes("codex/account")) return Promise.resolve(jsonResponse({ ready: false }));
      if (urlStr.includes("ai/provider") && init?.method === "DELETE") {
        return Promise.reject(new Error("network down"));
      }
      if (urlStr.includes("ai/provider")) {
        return Promise.resolve(
          jsonResponse({ source: "runtime", provider: "codex", model: "default" }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });

    const { result } = renderHook(() =>
      useAiProviderSettings({
        isOpen: true,
        activeTab: "settings",
        onProviderActivated: vi.fn(),
        onProviderCleared,
        onProviderMissing: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleCodexLogout();
    });

    expect(fetchSpy).toHaveBeenCalledWith("/api/ai/provider", { method: "DELETE" });
    expect(onProviderCleared).toHaveBeenCalledTimes(1);
  });

  it("does not clear review when logging out of Codex while another provider is active", async () => {
    const onProviderCleared = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url: unknown, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("codex/logout")) return Promise.resolve(jsonResponse({ ok: true }));
      if (urlStr.includes("codex/account")) return Promise.resolve(jsonResponse({ ready: false }));
      if (urlStr.includes("ai/provider") && init?.method === "DELETE") {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      if (urlStr.includes("ai/provider")) {
        return Promise.resolve(
          jsonResponse({ source: "runtime", provider: "openai", model: "gpt-4o" }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });

    const { result } = renderHook(() =>
      useAiProviderSettings({
        isOpen: true,
        activeTab: "settings",
        onProviderActivated: vi.fn(),
        onProviderCleared,
        onProviderMissing: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleCodexLogout();
    });

    expect(fetchSpy).not.toHaveBeenCalledWith("/api/ai/provider", { method: "DELETE" });
    expect(onProviderCleared).not.toHaveBeenCalled();
  });
});
