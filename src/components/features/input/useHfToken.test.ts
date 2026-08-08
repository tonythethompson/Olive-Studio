import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useHfToken } from "./useHfToken";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe("useHfToken", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps a failed status request to error", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((url: unknown) => {
      if (String(url).includes("hf-token-status")) {
        return Promise.resolve(new Response("Internal Error", { status: 500 }));
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    });

    const { result } = renderHook(() => useHfToken(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.hfTokenStatus).toBe("error");
    });
  });

  it("maps a successful status request to the returned source", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((url: unknown) => {
      if (String(url).includes("hf-token-status")) {
        return Promise.resolve(new Response(JSON.stringify({ source: "runtime" }), { status: 200 }));
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    });

    const { result } = renderHook(() => useHfToken(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.hfTokenStatus).toBe("runtime");
    });
  });

  it("keeps runtime status on failed clear and recovers after a successful save", async () => {
    let resolveDelete!: (res: Response) => void;
    const deletePromise = new Promise<Response>((resolve) => {
      resolveDelete = resolve;
    });

    vi.spyOn(globalThis, "fetch").mockImplementation((url: unknown, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("hf-token-status")) {
        return Promise.resolve(new Response(JSON.stringify({ source: "runtime" }), { status: 200 }));
      }
      if (urlStr.includes("/api/env/hf-token") && init?.method === "DELETE") {
        return deletePromise;
      }
      if (urlStr.includes("/api/env/hf-token") && init?.method === "POST") {
        return Promise.resolve(new Response("{}", { status: 200 }));
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    });

    const { result } = renderHook(() => useHfToken(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.hfTokenStatus).toBe("runtime");
    });

    let clearPromise: Promise<void>;
    act(() => {
      clearPromise = result.current.handleClearToken();
    });

    await waitFor(() => {
      expect(result.current.clearTokenMutation.isPending).toBe(true);
    });

    await act(async () => {
      resolveDelete(new Response("Internal Error", { status: 500 }));
      await clearPromise;
    });

    expect(result.current.hfTokenStatus).toBe("runtime");
    await waitFor(() => {
      expect(result.current.clearTokenMutation.isError).toBe(true);
    });

    act(() => {
      result.current.setHfTokenInput("hf_new_token_123");
    });

    await act(async () => {
      await result.current.handleSubmitToken();
    });

    expect(result.current.hfTokenStatus).toBe("runtime");
    expect(result.current.hfTokenInput).toBe("");
    expect(result.current.clearTokenMutation.isError).toBe(false);
  });
});
