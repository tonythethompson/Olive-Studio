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

  it("polls via sleep when reclaim unlink fails with EPERM", async () => {
    const store: Store = new Map([["/tmp/lock", "111\n"]]);
    const fs = makeFs(store);
    let t = 0;
    const sleep = vi.fn(async (ms: number) => {
      t += ms;
    });
    const unlinkSync = vi.fn((p: string) => {
      if (p === "/tmp/lock") {
        throw Object.assign(new Error("EPERM"), { code: "EPERM" });
      }
      store.delete(p);
    });

    await expect(
      acquireStudioConfigSmokeLock("/tmp/lock", {
        writeFileSync: fs.writeFileSync as never,
        linkSync: fs.linkSync as never,
        readFileSync: fs.readFileSync as never,
        unlinkSync: unlinkSync as never,
        mkdirSync: fs.mkdirSync as never,
        isProcessAlive: (pid) => pid !== 111,
        pid: 999,
        timeoutMs: 30,
        pollMs: 10,
        now: () => t,
        sleep,
        randomId: () => "eperm",
      }),
    ).rejects.toThrow(/could not acquire/);

    expect(unlinkSync).toHaveBeenCalledWith("/tmp/lock");
    expect(sleep).toHaveBeenCalled();
    expect(store.get("/tmp/lock")).toBe("111\n");
  });

  it("clears an orphaned reclaim mutex and recovers the main lock", async () => {
    const store: Store = new Map([
      ["/tmp/lock", "111\n"],
      ["/tmp/lock.reclaim", "222\n"],
    ]);
    const fs = makeFs(store);

    const lock = await acquireStudioConfigSmokeLock("/tmp/lock", {
      writeFileSync: fs.writeFileSync as never,
      linkSync: fs.linkSync as never,
      readFileSync: fs.readFileSync as never,
      unlinkSync: fs.unlinkSync as never,
      mkdirSync: fs.mkdirSync as never,
      isProcessAlive: (pid) => pid !== 111 && pid !== 222,
      pid: 999,
      timeoutMs: 1_000,
      pollMs: 5,
      sleep: async () => undefined,
      randomId: () => "orphan",
    });
    expect(store.get("/tmp/lock")).toBe("999\n");
    expect(store.has("/tmp/lock.reclaim")).toBe(false);
    lock.release();
  });

  it("does not steal a live reclaim mutex", async () => {
    const store: Store = new Map([
      ["/tmp/lock", "111\n"],
      ["/tmp/lock.reclaim", "222\n"],
    ]);
    const fs = makeFs(store);
    let t = 0;
    const sleep = vi.fn(async (ms: number) => {
      t += ms;
    });

    await expect(
      acquireStudioConfigSmokeLock("/tmp/lock", {
        writeFileSync: fs.writeFileSync as never,
        linkSync: fs.linkSync as never,
        readFileSync: fs.readFileSync as never,
        unlinkSync: fs.unlinkSync as never,
        mkdirSync: fs.mkdirSync as never,
        isProcessAlive: (pid) => pid === 222, // reclaim holder still live
        pid: 999,
        timeoutMs: 30,
        pollMs: 10,
        now: () => t,
        sleep,
        randomId: () => "live-reclaim",
      }),
    ).rejects.toThrow(/could not acquire/);

    expect(store.get("/tmp/lock")).toBe("111\n");
    expect(store.get("/tmp/lock.reclaim")).toBe("222\n");
    expect(sleep).toHaveBeenCalled();
  });

  it("does not clear an aged incomplete reclaim mutex by age alone", async () => {
    // Incomplete reclaim bodies must not be age-reaped: a live reclaimer could
    // still be in its critical section. Only dead complete PIDs are cleared.
    const store: Store = new Map([
      ["/tmp/lock", "111\n"],
      ["/tmp/lock.reclaim", ""],
    ]);
    const fs = makeFs(store);
    let t = 5_000;
    const sleep = vi.fn(async (ms: number) => {
      t += ms;
    });

    await expect(
      acquireStudioConfigSmokeLock("/tmp/lock", {
        writeFileSync: fs.writeFileSync as never,
        linkSync: fs.linkSync as never,
        readFileSync: fs.readFileSync as never,
        unlinkSync: fs.unlinkSync as never,
        mkdirSync: fs.mkdirSync as never,
        statSync: vi.fn(() => ({ mtimeMs: 1_000 })) as never,
        isProcessAlive: () => false,
        pid: 999,
        timeoutMs: 30,
        pollMs: 10,
        publishGraceMs: 1_000,
        now: () => t,
        sleep,
        randomId: () => "incomplete-reclaim",
      }),
    ).rejects.toThrow(/could not acquire/);

    expect(store.get("/tmp/lock")).toBe("111\n");
    expect(store.get("/tmp/lock.reclaim")).toBe("");
    expect(fs.unlinkSync).not.toHaveBeenCalledWith("/tmp/lock");
  });

  it("does not unlink the main lock after losing reclaim gate ownership", async () => {
    const store: Store = new Map([["/tmp/lock", "111\n"]]);
    const fs = makeFs(store);
    let reclaimReads = 0;
    const readFileSync = vi.fn((p: string) => {
      if (p === "/tmp/lock.reclaim") {
        reclaimReads += 1;
        // After we create the gate as 999, a peer replaces it before main unlink.
        if (reclaimReads >= 2) return "4242\n";
      }
      if (!store.has(p)) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
      return store.get(p) ?? "";
    });
    const writeFileSync = vi.fn((p: string, body: string, opts?: { flag?: string }) => {
      fs.writeFileSync(p, body, opts as never);
      if (p === "/tmp/lock.reclaim") reclaimReads = 0;
    });

    await expect(
      acquireStudioConfigSmokeLock("/tmp/lock", {
        writeFileSync: writeFileSync as never,
        linkSync: fs.linkSync as never,
        readFileSync: readFileSync as never,
        unlinkSync: fs.unlinkSync as never,
        mkdirSync: fs.mkdirSync as never,
        isProcessAlive: (pid) => pid !== 111,
        pid: 999,
        timeoutMs: 30,
        pollMs: 10,
        now: (() => {
          let t = 0;
          return () => {
            t += 10;
            return t;
          };
        })(),
        sleep: async () => undefined,
        randomId: () => "lost-gate",
      }),
    ).rejects.toThrow(/could not acquire/);

    expect(fs.unlinkSync).not.toHaveBeenCalledWith("/tmp/lock");
    expect(store.get("/tmp/lock")).toBe("111\n");
  });

  it("does not unlink a peer lock published between classify and reclaim", async () => {
    // Both waiters saw the same aged incomplete body; the first already
    // reclaimed and published before the second's body compare under reclaim gate.
    const store: Store = new Map([["/tmp/lock", ""]]);
    const fs = makeFs(store);
    let lockReads = 0;
    let t = 5_000;
    const sleep = vi.fn(async (ms: number) => {
      t += ms;
    });
    const readFileSync = vi.fn((p: string) => {
      if (p !== "/tmp/lock") {
        if (!store.has(p)) {
          throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        }
        return store.get(p) ?? "";
      }
      lockReads += 1;
      // Classify against aged empty, then observe the peer's published PID.
      return lockReads === 1 ? "" : "4242\n";
    });

    await expect(
      acquireStudioConfigSmokeLock("/tmp/lock", {
        writeFileSync: fs.writeFileSync as never,
        linkSync: fs.linkSync as never,
        readFileSync: readFileSync as never,
        unlinkSync: fs.unlinkSync as never,
        mkdirSync: fs.mkdirSync as never,
        statSync: vi.fn(() => ({ mtimeMs: 1_000 })) as never,
        isProcessAlive: () => true,
        pid: 999,
        timeoutMs: 30,
        pollMs: 10,
        publishGraceMs: 1_000,
        now: () => t,
        sleep,
        randomId: () => "cas",
      }),
    ).rejects.toThrow(/could not acquire/);

    expect(fs.unlinkSync).not.toHaveBeenCalledWith("/tmp/lock");
    expect(sleep).toHaveBeenCalled();
  });

  it("recreates the lock directory when temp publish hits ENOENT", async () => {
    const store: Store = new Map();
    const fs = makeFs(store);
    let mkdirCalls = 0;
    const mkdirSync = vi.fn((dir: string, opts?: { recursive?: boolean }) => {
      mkdirCalls += 1;
      return fs.mkdirSync(dir, opts as never);
    });
    let tempWrites = 0;
    const writeFileSync = vi.fn((p: string, body: string, opts?: { flag?: string }) => {
      if (String(p).includes(".tmp") && tempWrites === 0) {
        tempWrites += 1;
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }
      return fs.writeFileSync(p, body, opts as never);
    });

    const lock = await acquireStudioConfigSmokeLock("/tmp/olive/.lock", {
      writeFileSync: writeFileSync as never,
      linkSync: fs.linkSync as never,
      readFileSync: fs.readFileSync as never,
      unlinkSync: fs.unlinkSync as never,
      mkdirSync: mkdirSync as never,
      pid: 321,
      timeoutMs: 1_000,
      pollMs: 10,
      randomId: () => "enoent",
    });
    expect(store.get("/tmp/olive/.lock")).toBe("321\n");
    expect(mkdirCalls).toBeGreaterThanOrEqual(2);
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
    const fs = makeFs(store);
    const linkSync = vi.fn(() => {
      throw Object.assign(new Error("ENOTSUP"), { code: "ENOTSUP" });
    });

    const lock = await acquireStudioConfigSmokeLock("/tmp/lock", {
      writeFileSync: fs.writeFileSync as never,
      linkSync: linkSync as never,
      readFileSync: fs.readFileSync as never,
      unlinkSync: fs.unlinkSync as never,
      mkdirSync: fs.mkdirSync as never,
      pid: 777,
      timeoutMs: 1_000,
      pollMs: 10,
      randomId: () => "fb",
    });
    expect(store.get("/tmp/lock")).toBe("777\n");
    expect(fs.writeFileSync).toHaveBeenCalledWith("/tmp/lock", "777\n", { flag: "wx" });
    expect([...store.keys()].some((k) => k.includes(".tmp"))).toBe(false);
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
