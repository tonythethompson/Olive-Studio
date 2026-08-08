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

    const writeFileSync = vi.fn((p: string, body: string, opts?: { flag?: string }) => {
      if (opts?.flag === "wx" && store.has(p)) {
        throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
      }
      store.set(p, body);
    });
    const readFileSync = vi.fn((p: string) => {
      if (!store.has(p)) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
      return store.get(p) ?? "";
    });
    const unlinkSync = vi.fn((p: string) => {
      store.delete(p);
    });
    const mkdirSync = vi.fn();

    const lock = await acquireStudioConfigSmokeLock("/tmp/lock", {
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

    const lock = await acquireStudioConfigSmokeLock("/tmp/lock", {
      writeFileSync: vi.fn((p: string, body: string, opts?: { flag?: string }) => {
        if (opts?.flag === "wx" && store.has(p)) {
          throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
        }
        store.set(p, body);
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

  it("does not reclaim a freshly empty lock (publisher still writing)", async () => {
    const store = new Map<string, string>([["/tmp/lock", ""]]);
    const unlinkSync = vi.fn((p: string) => {
      store.delete(p);
    });
    let t = 1_000;
    const sleep = vi.fn(async () => {
      // After the first poll, the publisher finishes writing its PID.
      store.set("/tmp/lock", "4242\n");
      t += 50;
    });

    await expect(
      acquireStudioConfigSmokeLock("/tmp/lock", {
        writeFileSync: vi.fn((p: string, _body: string, opts?: { flag?: string }) => {
          if (opts?.flag === "wx" && store.has(p)) {
            throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
          }
          store.set(p, _body);
        }) as never,
        readFileSync: vi.fn((p: string) => {
          if (!store.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
          return store.get(p) ?? "";
        }) as never,
        statSync: vi.fn(() => ({ mtimeMs: 1_000 })) as never,
        unlinkSync: unlinkSync as never,
        mkdirSync: vi.fn() as never,
        isProcessAlive: () => true,
        pid: 999,
        timeoutMs: 500,
        pollMs: 50,
        publishGraceMs: 1_000,
        now: () => t,
        sleep,
      }),
    ).rejects.toThrow(/could not acquire/);

    expect(unlinkSync).not.toHaveBeenCalled();
    expect(store.get("/tmp/lock")).toBe("4242\n");
    expect(sleep).toHaveBeenCalled();
  });

  it("reclaims an aged empty lock after the publish grace window", async () => {
    const store = new Map<string, string>([["/tmp/lock", ""]]);
    let t = 5_000;

    const lock = await acquireStudioConfigSmokeLock("/tmp/lock", {
      writeFileSync: vi.fn((p: string, body: string, opts?: { flag?: string }) => {
        if (opts?.flag === "wx" && store.has(p)) {
          throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
        }
        store.set(p, body);
      }) as never,
      readFileSync: vi.fn((p: string) => {
        if (!store.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        return store.get(p) ?? "";
      }) as never,
      statSync: vi.fn(() => ({ mtimeMs: 1_000 })) as never,
      unlinkSync: vi.fn((p: string) => {
        store.delete(p);
      }) as never,
      mkdirSync: vi.fn() as never,
      pid: 999,
      timeoutMs: 1_000,
      pollMs: 5,
      publishGraceMs: 1_000,
      now: () => t,
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
