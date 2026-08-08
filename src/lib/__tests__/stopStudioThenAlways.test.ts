/**
 * stopStudioThenAlways: config restore must run even when shutdown rejects.
 */
import { describe, expect, it, vi } from "vitest";
import { stopStudioThenAlways } from "../../../scripts/stopStudioThenAlways.mjs";

describe("stopStudioThenAlways", () => {
  it("runs afterStop when stopStudio succeeds", async () => {
    const afterStop = vi.fn(async () => undefined);
    await stopStudioThenAlways(async () => "ok", afterStop);
    expect(afterStop).toHaveBeenCalledOnce();
  });

  it("runs afterStop when stopStudio rejects", async () => {
    const afterStop = vi.fn(async () => undefined);
    await expect(
      stopStudioThenAlways(async () => {
        throw new Error("studio hung");
      }, afterStop),
    ).rejects.toThrow(/studio hung/);
    expect(afterStop).toHaveBeenCalledOnce();
  });
});
