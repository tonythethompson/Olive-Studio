/**
 * Inter-process smoke lock for Studio config mutation.
 */
import { describe, expect, it, vi } from "vitest";
import {
  acquireStudioConfigSmokeLock,
  isProcessAlive,
  tryRemoveEmptyStudioConfigDir,
} from "../../../scripts/studioConfigSmokeLock.mjs";

type Store = Map<string, string>;

function makeFs(store: Store) {
  const writeFileSync = vi.fn((p: string, body: string, opts?: { flag?: string }) => {
    if (opts?.flag === "wx" && store.has(p)) {
      throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
    }
    store.set(p, String(body));
  });
  const linkSync = vi.fn((from: string, to: string) => {
    if (!store.has(from)) {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }
    if (store.has(to)) {
      throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
    }
    // Hard link: destination appears with the fully written temp contents.
    store.set(to, store.get(from)!);
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
  return { writeFileSync, linkSync, readFileSync, unlinkSync, mkdirSync };
}

describe("studioConfigSmokeLock", () => {
  it("acquires via temp+link and releases only own pid", async () => {
    const store: Store = new Map();
    const fs = makeFs(store);

    const lock = await acquireStudioConfigSmokeLock("/tmp/lock", {
      ...fs,
      writeFileSync: fs.writeFileSync as never,
      linkSync: fs.linkSync as never,
      readFileSync: fs.readFileSync as never,
      unlinkSync: fs.unlinkSync as never,
      mkdirSync: fs.mkdirSync as never,
      pid: 4242,
      timeoutMs: 1_000,
      pollMs: 10,
      randomId: () => "abc",
    });
    expect(store.get("/tmp/lock")).toBe("4242\n");
    expect(fs.linkSync).toHaveBeenCalled();
    expect([...store.keys()].some((k) => k.includes(".tmp"))).toBe(false);

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
    const store: Store = new Map([["/tmp/lock", "111\n"]]);
    const fs = makeFs(store);

    const lock = await acquireStudioConfigSmokeLock("/tmp/lock", {
      writeFileSync: fs.writeFileSync as never,
      linkSync: fs.linkSync as never,
      readFileSync: fs.readFileSync as never,
      unlinkSync: fs.unlinkSync as never,
      mkdirSync: fs.mkdirSync as never,
      isProcessAlive: (pid) => pid !== 111,
      pid: 999,
      timeoutMs: 1_000,
      pollMs: 5,
      sleep: async () => undefined,
      randomId: () => "dead",
    });
    expect(store.get("/tmp/lock")).toBe("999\n");
    lock.release();
  });

  it("does not reclaim a partial numeric PID body before the publish grace window", async () => {
    // Mid-publish body "12" must not be treated as live PID 12 via parseInt.
    const store: Store = new Map([["/tmp/lock", "12"]]);
    const fs = makeFs(store);
    let t = 1_000;
    const sleep = vi.fn(async () => {
      store.set("/tmp/lock", "12345\n");
      t += 50;
    });

    await expect(
      acquireStudioConfigSmokeLock("/tmp/lock", {
        writeFileSync: fs.writeFileSync as never,
        linkSync: fs.linkSync as never,
        readFileSync: fs.readFileSync as never,
        unlinkSync: fs.unlinkSync as never,
        mkdirSync: fs.mkdirSync as never,
        statSync: vi.fn(() => ({ mtimeMs: 1_000 })) as never,
        isProcessAlive: (pid) => pid === 12 || pid === 12345,
        pid: 999,
        timeoutMs: 500,
        pollMs: 50,
        publishGraceMs: 1_000,
        now: () => t,
        sleep,
        randomId: () => "partial",
      }),
    ).rejects.toThrow(/could not acquire/);

    expect(fs.unlinkSync).not.toHaveBeenCalledWith("/tmp/lock");
    expect(store.get("/tmp/lock")).toBe("12345\n");
    expect(sleep).toHaveBeenCalled();
  });

  it("does not reclaim a freshly empty lock while process A delays PID publish", async () => {
    // Process A created the final path (legacy open/write or crash remnant) but
    // has not written the PID yet. Process B must poll through grace, not unlink.
    const store: Store = new Map([["/tmp/lock", ""]]);
    const fs = makeFs(store);
    let t = 1_000;
    const sleep = vi.fn(async () => {
      // Process A finishes publishing after B's first empty-body observation.
      store.set("/tmp/lock", "4242\n");
      t += 50;
    });

    await expect(
      acquireStudioConfigSmokeLock("/tmp/lock", {
        writeFileSync: fs.writeFileSync as never,
        linkSync: fs.linkSync as never,
        readFileSync: fs.readFileSync as never,
        unlinkSync: fs.unlinkSync as never,
        mkdirSync: fs.mkdirSync as never,
        statSync: vi.fn(() => ({ mtimeMs: 1_000 })) as never,
        isProcessAlive: () => true,
        pid: 999,
        timeoutMs: 500,
        pollMs: 50,
        publishGraceMs: 1_000,
        now: () => t,
        sleep,
        randomId: () => "b",
      }),
    ).rejects.toThrow(/could not acquire/);

    // Critical: B never unlinked A's in-progress empty lock path.
    expect(fs.unlinkSync).not.toHaveBeenCalledWith("/tmp/lock");
    expect(store.get("/tmp/lock")).toBe("4242\n");
    expect(sleep).toHaveBeenCalled();
  });

  it("reclaims an aged empty lock after the publish grace window", async () => {
    const store: Store = new Map([["/tmp/lock", ""]]);
    const fs = makeFs(store);
    const nowMs = 5_000;

    const lock = await acquireStudioConfigSmokeLock("/tmp/lock", {
      writeFileSync: fs.writeFileSync as never,
      linkSync: fs.linkSync as never,
      readFileSync: fs.readFileSync as never,
      unlinkSync: fs.unlinkSync as never,
      mkdirSync: fs.mkdirSync as never,
      statSync: vi.fn(() => ({ mtimeMs: 1_000 })) as never,
      pid: 999,
      timeoutMs: 1_000,
      pollMs: 5,
      publishGraceMs: 1_000,
      now: () => nowMs,
      sleep: async () => undefined,
      randomId: () => "aged",
    });
    expect(store.get("/tmp/lock")).toBe("999\n");
    lock.release();
  });

  it("falls back to exclusive write when hardlinks are unsupported", async () => {
    const store: Store = new Map();
    const writeFileSync = vi.fn((p: string, body: string, opts?: { flag?: string }) => {
      if (opts?.flag === "wx" && store.has(p)) {
        throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
      }
      store.set(p, String(body));
    });
    const linkSync = vi.fn(() => {
      throw Object.assign(new Error("ENOTSUP"), { code: "ENOTSUP" });
    });
    const unlinkSync = vi.fn((p: string) => {
      store.delete(p);
    });

    const lock = await acquireStudioConfigSmokeLock("/tmp/lock", {
      writeFileSync: writeFileSync as never,
      linkSync: linkSync as never,
      readFileSync: vi.fn((p: string) => {
        if (!store.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        return store.get(p) ?? "";
      }) as never,
      unlinkSync: unlinkSync as never,
      mkdirSync: vi.fn() as never,
      pid: 777,
      timeoutMs: 1_000,
      pollMs: 10,
      randomId: () => "fb",
    });
    expect(store.get("/tmp/lock")).toBe("777\n");
    expect(writeFileSync).toHaveBeenCalledWith("/tmp/lock", "777\n", { flag: "wx" });
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
