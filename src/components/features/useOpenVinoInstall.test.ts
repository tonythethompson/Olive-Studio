import { describe, expect, it, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useOpenVinoInstall } from "./useOpenVinoInstall";

function ndjsonOk(): Response {
  return new Response('{"type":"done","ok":true}\n', {
    status: 200,
    headers: { "content-type": "application/x-ndjson" },
  });
}

describe("useOpenVinoInstall", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("guards against a concurrent second install", async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => fetchPromise),
    );
    const onProbeRefresh = vi.fn(async () => undefined);

    const { result } = renderHook(() =>
      useOpenVinoInstall({ onProbeRefresh, isInstallBusy: false }),
    );

    let first: Promise<void>;
    act(() => {
      first = result.current.install();
    });
    expect(result.current.state.installing).toBe(true);

    await act(async () => {
      await result.current.install();
    });
    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFetch?.(ndjsonOk());
      await first!;
    });
    expect(onProbeRefresh).toHaveBeenCalledTimes(1);
  });

  it('maps fetch rejection "Failed to fetch" to the user-facing server message', async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Failed to fetch");
      }),
    );
    const onProbeRefresh = vi.fn(async () => undefined);
    const { result } = renderHook(() =>
      useOpenVinoInstall({ onProbeRefresh, isInstallBusy: false }),
    );

    await act(async () => {
      await result.current.install();
    });

    expect(result.current.state.error).toContain("Could not reach the Olive Studio server");
    expect(onProbeRefresh).not.toHaveBeenCalled();
  });

  it("invokes onProbeRefresh(true) after a successful install", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ndjsonOk()),
    );
    const onProbeRefresh = vi.fn(async () => undefined);
    const { result } = renderHook(() =>
      useOpenVinoInstall({ onProbeRefresh, isInstallBusy: false }),
    );

    await act(async () => {
      await result.current.install();
    });

    expect(onProbeRefresh).toHaveBeenCalledWith(true);
    expect(result.current.state.error).toBeNull();
    expect(result.current.state.installing).toBe(false);
  });
});
