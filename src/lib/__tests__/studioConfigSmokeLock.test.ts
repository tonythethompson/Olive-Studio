/**
 * Inter-process smoke lock for Studio config mutation.
 */
import { describe, expect, it, vi } from "vitest";
import {
  acquireStudioConfigSmokeLock,
  isProcessAlive,
  tryRemoveEmptyStudioConfigDir,
} from "../../../scripts/studioConfigSmokeLock.mjs";

describe("studioConfigSmokeLock", () => {
  it("acquires with wx and releases only own pid", async () => {
    const store = new Map<string, string>();
    let nextFd = 1;
    const fds = new Map<number, string>();

    const openSync = vi.fn((p: string, flag: string) => {
      if (flag === "wx" && store.has(p)) {
        const err = Object.assign(new Error("EEXIST"), { code: "EEXIST" });
        throw err;
      }
      if (flag === "wx") store.set(p, "");
      const fd = nextFd++;
      fds.set(fd, p);
      return fd;
    });
    const writeFileSync = vi.fn((fd: number, body: string) => {
      const p = fds.get(fd);
      if (p) store.set(p, body);
    });
    const closeSync = vi.fn();
    const readFileSync = vi.fn((p: string) => {
      if (!store.has(p)) {
        const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        throw err;
      }
      return store.get(p) ?? "";
    });
    const unlinkSync = vi.fn((p: string) => {
      store.delete(p);
    });
    const mkdirSync = vi.fn();

    const lock = await acquireStudioConfigSmokeLock("/tmp/lock", {
      openSync: openSync as never,
      closeSync: closeSync as never,
      writeFileSync: writeFileSync as never,
      readFileSync: readFileSync as never,
      unlinkSync: unlinkSync as never,
      mkdirSync: mkdirSync as never,
      pid: 4242,
      timeoutMs: 1_000,
      pollMs: 10,
    });
    expect(store.get("/tmp/lock")).toBe("4242\n");
    // Foreign PID must not be unlinked by our release().
    store.set("/tmp/lock", "9999\n");
    lock.release();
    expect(store.get("/tmp/lock")).toBe("9999\n");
    // Restore ownership and confirm own-pid release clears the lock.
    store.set("/tmp/lock", "4242\n");
    lock.release();
    expect(store.has("/tmp/lock")).toBe(false);
  });

  it("reclaims a stale lock from a dead pid", async () => {
    const store = new Map<string, string>([["/tmp/lock", "111\n"]]);
    let nextFd = 1;
    const fds = new Map<number, string>();
    const openSync = vi.fn((p: string, flag: string) => {
      if (flag === "wx" && store.has(p)) {
        throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
      }
      if (flag === "wx") store.set(p, "");
      const fd = nextFd++;
      fds.set(fd, p);
      return fd;
    });

    const lock = await acquireStudioConfigSmokeLock("/tmp/lock", {
      openSync: openSync as never,
      closeSync: vi.fn() as never,
      writeFileSync: vi.fn((fd: number, body: string) => {
        const p = fds.get(fd);
        if (p) store.set(p, body);
      }) as never,
      readFileSync: vi.fn((p: string) => {
        if (!store.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        return store.get(p) ?? "";
      }) as never,
      unlinkSync: vi.fn((p: string) => {
        store.delete(p);
      }) as never,
      mkdirSync: vi.fn() as never,
      isProcessAlive: (pid) => pid !== 111,
      pid: 999,
      timeoutMs: 1_000,
      pollMs: 5,
      sleep: async () => undefined,
    });
    expect(store.get("/tmp/lock")).toBe("999\n");
    lock.release();
  });

  it("reports process liveness via kill(pid, 0)", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(-1)).toBe(false);
  });

  it("tryRemoveEmptyStudioConfigDir ignores busy dirs", () => {
    const rmdirSync = vi.fn(() => {
      throw Object.assign(new Error("ENOTEMPTY"), { code: "ENOTEMPTY" });
    });
    expect(() =>
      tryRemoveEmptyStudioConfigDir("/x", { rmdirSync: rmdirSync as never }),
    ).not.toThrow();
  });
});
