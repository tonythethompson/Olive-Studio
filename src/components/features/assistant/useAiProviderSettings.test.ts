import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAiProviderSettings } from "./useAiProviderSettings";

describe("useAiProviderSettings", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls onProviderCleared when handleCodexLogout results in source 'none'", async () => {
    const onProviderCleared = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes("codex/logout")) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      if (urlStr.includes("codex/account")) {
        return Promise.resolve(new Response(JSON.stringify({ ready: false }), { status: 200 }));
      }
      if (urlStr.includes("ai/provider")) {
        return Promise.resolve(new Response(JSON.stringify({ source: "none" }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
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

  it("calls onProviderCleared when handleDevinLogout results in source 'none'", async () => {
    const onProviderCleared = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url: unknown) => {
      const urlStr = String(url);
      if (urlStr.includes("devin/logout")) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      if (urlStr.includes("ai/provider")) {
        return Promise.resolve(new Response(JSON.stringify({ source: "none" }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
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
});
