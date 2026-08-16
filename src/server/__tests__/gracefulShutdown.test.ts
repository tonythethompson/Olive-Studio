import { describe, it, expect, vi, afterEach } from "vitest";
import { createSingleFlightShutdown } from "../gracefulShutdown.ts";

describe("createSingleFlightShutdown", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs each cleanup once, then exits", async () => {
    const sidecar = vi.fn(async () => {});
    const mcp = vi.fn(async () => {});
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const shutdown = createSingleFlightShutdown([sidecar, mcp]);
    await shutdown("SIGINT");

    expect(sidecar).toHaveBeenCalledTimes(1);
    expect(mcp).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("is single-flight: a second signal reuses the in-flight shutdown", async () => {
    const deferred = <T>() => {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((res) => {
        resolve = res;
      });
      return { promise, resolve };
    };

    const sidecarGate = deferred<void>();
    const mcpGate = deferred<void>();
    const sidecar = vi.fn(() => sidecarGate.promise);
    const mcp = vi.fn(() => mcpGate.promise);
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const shutdown = createSingleFlightShutdown([sidecar, mcp]);

    const first = shutdown("SIGINT");
    const second = shutdown("SIGTERM");

    // The repeated signal must not start a second cleanup pass.
    expect(sidecar).toHaveBeenCalledTimes(1);
    expect(mcp).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();

    // Let cleanup finish, then assert a single process.exit(0).
    sidecarGate.resolve();
    mcpGate.resolve();
    await first;
    await second;

    expect(sidecar).toHaveBeenCalledTimes(1);
    expect(mcp).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });
});
