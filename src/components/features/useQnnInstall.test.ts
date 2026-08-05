import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useQnnInstall } from "./useQnnInstall";

vi.mock("@/lib/ndjsonInstall", () => ({
  runNdjsonInstall: vi.fn(async () => undefined),
}));

import { runNdjsonInstall } from "@/lib/ndjsonInstall";

describe("useQnnInstall", () => {
  beforeEach(() => {
    vi.mocked(runNdjsonInstall).mockClear();
  });

  it("streams install-qnn and refreshes probe", async () => {
    const onProbeRefresh = vi.fn(async () => undefined);
    const { result } = renderHook(() =>
      useQnnInstall({ onProbeRefresh, isInstallBusy: false }),
    );
    await act(async () => {
      await result.current.install();
    });
    expect(runNdjsonInstall).toHaveBeenCalledWith("/api/env/install-qnn", expect.any(Function));
    expect(onProbeRefresh).toHaveBeenCalledWith(true);
  });

  it("streams test-qnn-npu for HTP diagnostic", async () => {
    const onProbeRefresh = vi.fn(async () => undefined);
    const { result } = renderHook(() =>
      useQnnInstall({ onProbeRefresh, isInstallBusy: false }),
    );
    await act(async () => {
      await result.current.testNpu();
    });
    expect(runNdjsonInstall).toHaveBeenCalledWith("/api/env/test-qnn-npu", expect.any(Function));
    expect(onProbeRefresh).toHaveBeenCalledWith(true);
  });

  it("no-ops when another install is busy", async () => {
    const onProbeRefresh = vi.fn(async () => undefined);
    const { result } = renderHook(() =>
      useQnnInstall({ onProbeRefresh, isInstallBusy: true }),
    );
    await act(async () => {
      await result.current.install();
    });
    expect(runNdjsonInstall).not.toHaveBeenCalled();
  });
});
