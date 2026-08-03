/**
 * Olive-output list/download routes + cloud body-read abort regressions.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import fc from "fast-check";
import fs from "node:fs";
import http, { type IncomingHttpHeaders, type Server } from "node:http";
import os from "node:os";
import path from "node:path";

vi.mock("../middleware/localOnly.ts", () => ({
  arenaLocalOnly: (_req: unknown, _res: unknown, next: () => void) => next(),
  isLoopbackRemoteAddress: () => true,
  hasProxyForwardingHeaders: () => false,
}));

vi.mock("../middleware/rateLimit.ts", () => ({
  arenaProxyRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../services/arena/ssrfGuard.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/arena/ssrfGuard.ts")>();
  return {
    ...actual,
    pinnedFetch: vi.fn(),
  };
});

import { pinnedFetch } from "../services/arena/ssrfGuard.ts";
import { mountArenaRoutes } from "./arena.ts";
import {
  __setOliveOutputRootsForTests,
  hasRejectedOliveOutputQuery,
} from "../services/playground/oliveOutputScan.ts";
import { arenaLocalOnly } from "../middleware/localOnly.ts";
import { arenaProxyRateLimit } from "../middleware/rateLimit.ts";

const mockedPinnedFetch = vi.mocked(pinnedFetch);

let server: Server;
let baseUrl: string;
let tmpRoot: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  mountArenaRoutes(router);
  app.use("/api", router);
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") return reject(new Error("no port"));
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
    server.on("error", reject);
  });
});

afterAll(async () => {
  __setOliveOutputRootsForTests(null);
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  mockedPinnedFetch.mockReset();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "olive-outputs-"));
  const cache = path.join(tmpRoot, "cache");
  const output = path.join(tmpRoot, "output");
  fs.mkdirSync(cache, { recursive: true });
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(cache, "a.onnx"), Buffer.alloc(16, 1));
  fs.writeFileSync(path.join(output, "b.ort"), Buffer.alloc(32, 2));
  fs.writeFileSync(path.join(output, "skip.bin"), Buffer.alloc(8, 3));
  __setOliveOutputRootsForTests([
    { label: "cache", absolutePath: cache },
    { label: "output", absolutePath: output },
  ]);
});

afterEach(() => {
  __setOliveOutputRootsForTests(null);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

type LocalResponse = {
  status: number;
  headers: IncomingHttpHeaders;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
  body: Buffer;
};

function request(
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<LocalResponse> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const url = new URL(`${baseUrl}${urlPath}`);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method,
        headers:
          payload === undefined
            ? undefined
            : {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              },
      },
      (res: http.IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const text = buf.toString("utf8");
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: buf,
            text: async () => text,
            json: async () => JSON.parse(text) as unknown,
          });
        });
      },
    );
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

describe("GET /api/arena/olive-outputs", () => {
  it("lists server-owned roots with opaque ids and no filesystem paths", async () => {
    const res = await request("GET", "/api/arena/olive-outputs");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      roots: Array<{ label: string; path?: string; absolutePath?: string }>;
      recent: Array<{ id: string; displayPath: string; absolutePath?: string }>;
      entries: Array<{ id: string; displayPath: string; absolutePath?: string }>;
    };
    expect(body.roots.every((r) => r.label && r.path === undefined)).toBe(true);
    expect(body.entries.length).toBe(2);
    expect(body.entries.every((e) => typeof e.id === "string" && !e.id.includes(path.sep))).toBe(
      true,
    );
    expect(body.recent.length).toBeLessThanOrEqual(10);

    // Strengthen: no filesystem paths leaked anywhere in serialized response
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(tmpRoot);
    expect(serialized).not.toContain("absolutePath");
    // Ensure no entry looks like an absolute path value
    for (const entry of body.entries) {
      expect(entry).not.toHaveProperty("absolutePath");
    }
    for (const recent of body.recent) {
      expect(recent).not.toHaveProperty("absolutePath");
    }
    for (const root of body.roots) {
      expect(root).not.toHaveProperty("absolutePath");
      expect(root).not.toHaveProperty("path");
    }
  });

  it("rejects path-related query params with empty 400", async () => {
    for (const key of ["path", "absolutePath", "cacheDir", "outputDir"]) {
      const res = await request("GET", `/api/arena/olive-outputs?${key}=/tmp/evil`);
      expect(res.status).toBe(400);
      expect(res.body.length).toBe(0);
    }
  });

  it("keeps opaque ids stable across list refreshes so downloads still resolve", async () => {
    const first = await request("GET", "/api/arena/olive-outputs");
    const firstBody = (await first.json()) as {
      entries: Array<{ id: string; displayPath: string }>;
    };
    const entry = firstBody.entries.find((e) => e.displayPath.endsWith("a.onnx"));
    expect(entry).toBeTruthy();

    const second = await request("GET", "/api/arena/olive-outputs");
    const secondBody = (await second.json()) as {
      entries: Array<{ id: string; displayPath: string }>;
    };
    const again = secondBody.entries.find((e) => e.displayPath.endsWith("a.onnx"));
    expect(again?.id).toBe(entry!.id);

    const download = await request("GET", `/api/arena/olive-outputs/file?id=${entry!.id}`);
    expect(download.status).toBe(200);
    expect(download.body.equals(Buffer.alloc(16, 1))).toBe(true);
  });
});

describe("GET /api/arena/olive-outputs/file", () => {
  it("streams bytes for a listed opaque id", async () => {
    const list = await request("GET", "/api/arena/olive-outputs");
    const body = (await list.json()) as { entries: Array<{ id: string; displayPath: string }> };
    const entry = body.entries.find((e) => e.displayPath.endsWith("a.onnx"));
    expect(entry).toBeTruthy();
    const res = await request("GET", `/api/arena/olive-outputs/file?id=${entry!.id}`);
    expect(res.status).toBe(200);
    expect(res.body.equals(Buffer.alloc(16, 1))).toBe(true);
  });

  it("rejects unknown id and path-related download queries with empty body", async () => {
    const unknown = await request("GET", "/api/arena/olive-outputs/file?id=missing");
    expect(unknown.status).toBe(400);
    expect(unknown.body.length).toBe(0);

    for (const key of ["path", "absolutePath", "cacheDir", "outputDir"]) {
      const res = await request("GET", `/api/arena/olive-outputs/file?${key}=/tmp/x.onnx`);
      expect(res.status).toBe(400);
      expect(res.body.length).toBe(0);
    }

    // path/absolutePath must be rejected even when an id is also present.
    const list = await request("GET", "/api/arena/olive-outputs");
    const body = (await list.json()) as { entries: Array<{ id: string }> };
    const id = body.entries[0]?.id;
    expect(id).toBeTruthy();
    const withPath = await request(
      "GET",
      `/api/arena/olive-outputs/file?id=${id}&path=/tmp/x.onnx`,
    );
    expect(withPath.status).toBe(400);
    expect(withPath.body.length).toBe(0);
  });

  it("returns proper Content-Disposition with UTF-8 encoding for non-ASCII filenames", async () => {
    // Create a file with non-ASCII characters
    const unicodeName = "modèl-tést-★.onnx";
    const unicodePath = path.join(tmpRoot, "cache", unicodeName);
    fs.writeFileSync(unicodePath, Buffer.alloc(24, 5));

    __setOliveOutputRootsForTests([
      { label: "cache", absolutePath: path.join(tmpRoot, "cache") },
      { label: "output", absolutePath: path.join(tmpRoot, "output") },
    ]);

    const list = await request("GET", "/api/arena/olive-outputs");
    const body = (await list.json()) as { entries: Array<{ id: string; displayPath: string }> };
    const entry = body.entries.find((e) => e.displayPath.includes("mod"));
    expect(entry).toBeTruthy();

    const download = await request("GET", `/api/arena/olive-outputs/file?id=${entry!.id}`);
    expect(download.status).toBe(200);
    expect(download.headers["content-type"]).toBe("application/octet-stream");

    const disposition = download.headers["content-disposition"];
    expect(disposition).toBeDefined();
    // Should have both filename= (ASCII fallback) and filename*= (UTF-8 percent-encoded)
    expect(disposition).toMatch(/filename="/);
    expect(disposition).toMatch(/filename\*=UTF-8''/);
  });

  it("rejects download when registered path resolves to a disallowed extension", async () => {
    const list = await request("GET", "/api/arena/olive-outputs");
    const body = (await list.json()) as {
      entries: Array<{ id: string; displayPath: string }>;
    };
    const onnx = body.entries.find((e) => e.displayPath.endsWith("a.onnx"));
    expect(onnx).toBeDefined();

    const onnxPath = path.join(tmpRoot, "cache", "a.onnx");
    const binPath = path.join(tmpRoot, "output", "skip.bin");
    fs.unlinkSync(onnxPath);
    fs.symlinkSync(binPath, onnxPath);

    const res = await request("GET", `/api/arena/olive-outputs/file?id=${onnx!.id}`);
    expect(res.status).toBe(403);
    expect(res.body.length).toBe(0);
  });

  it("rejects download when registered path escapes the configured roots via symlink", async () => {
    const list = await request("GET", "/api/arena/olive-outputs");
    const body = (await list.json()) as {
      entries: Array<{ id: string; displayPath: string }>;
    };
    const onnx = body.entries.find((e) => e.displayPath.endsWith("a.onnx"));
    expect(onnx).toBeDefined();

    const onnxPath = path.join(tmpRoot, "cache", "a.onnx");
    const outside = path.join(tmpRoot, "outside.onnx");
    fs.writeFileSync(outside, Buffer.alloc(8, 9));
    fs.unlinkSync(onnxPath);
    fs.symlinkSync(outside, onnxPath);

    const res = await request("GET", `/api/arena/olive-outputs/file?id=${onnx!.id}`);
    expect(res.status).toBe(403);
    expect(res.body.length).toBe(0);
  });

  it("rejects download of zero-byte model files with 403 empty body", async () => {
    const emptyPath = path.join(tmpRoot, "cache", "empty.onnx");
    fs.writeFileSync(emptyPath, Buffer.alloc(0));

    const list = await request("GET", "/api/arena/olive-outputs");
    const body = (await list.json()) as {
      entries: Array<{ id: string; displayPath: string }>;
    };
    const empty = body.entries.find((e) => e.displayPath.endsWith("empty.onnx"));
    expect(empty).toBeDefined();

    const res = await request("GET", `/api/arena/olive-outputs/file?id=${empty!.id}`);
    expect(res.status).toBe(403);
    expect(res.body.length).toBe(0);
  });
});

describe("olive-output middleware wiring", () => {
  it("applies arenaLocalOnly before arenaProxyRateLimit on olive-output routes", () => {
    // IMPORTANT: This test ONLY verifies middleware REGISTRATION ORDER.
    // It does NOT verify actual loopback enforcement or rate-limiting behavior
    // (both middleware are mocked as passthrough in this suite).
    //
    // This inspection relies on Express internal APIs (router.stack, route.stack, handle)
    // which are specific to Express 5.2.1 and may be version-sensitive.
    //
    // Un-mocked middleware identity check via a fresh router (same mount function).
    // The production mount uses arenaLocalOnly then arenaProxyRateLimit; this suite
    // stubs both as passthroughs, so assert the helpers still reject bad queries
    // and that the rate-limit / local-only modules remain the ones exported for mount.
    expect(typeof arenaLocalOnly).toBe("function");
    expect(typeof arenaProxyRateLimit).toBe("function");
    expect(hasRejectedOliveOutputQuery({ cacheDir: "/x" })).toBe(true);
    expect(hasRejectedOliveOutputQuery({})).toBe(false);

    const router = express.Router();
    mountArenaRoutes(router);
    type StackLayer = {
      route?: {
        path?: string;
        methods?: Record<string, boolean>;
        stack: Array<{ handle: unknown }>;
      };
    };
    const oliveList = router.stack.find((layer: StackLayer) => {
      const route = layer.route;
      return route?.path === "/arena/olive-outputs" && Boolean(route.methods?.get);
    }) as StackLayer | undefined;
    const oliveFile = router.stack.find((layer: StackLayer) => {
      const route = layer.route;
      return route?.path === "/arena/olive-outputs/file" && Boolean(route.methods?.get);
    }) as StackLayer | undefined;

    const listStack = oliveList?.route?.stack ?? [];
    const fileStack = oliveFile?.route?.stack ?? [];
    expect(listStack.length).toBeGreaterThanOrEqual(3);
    expect(fileStack.length).toBeGreaterThanOrEqual(3);
    expect(listStack[0]?.handle).toBe(arenaLocalOnly);
    expect(listStack[1]?.handle).toBe(arenaProxyRateLimit);
    expect(fileStack[0]?.handle).toBe(arenaLocalOnly);
    expect(fileStack[1]?.handle).toBe(arenaProxyRateLimit);
  });
});

describe("cloud-inference body-read abort handling", () => {
  it("maps AbortError from upstream.text to 504", async () => {
    mockedPinnedFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => {
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      },
      json: async () => ({}),
    });

    const res = await request("POST", "/api/arena/cloud-inference", {
      endpointUrl: "https://api.example.com/v1",
      prompt: "hello",
    });
    expect(res.status).toBe(504);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/timed out/i);
  });

  it("maps AbortError from upstream.json to 504", async () => {
    mockedPinnedFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => {
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      },
    });

    const res = await request("POST", "/api/arena/cloud-inference", {
      endpointUrl: "https://api.example.com/v1",
      prompt: "hello",
    });
    expect(res.status).toBe(504);
  });

  it("does not write a timeout body when the client disconnects during json read", async () => {
    let responseSent = false;
    let timeoutHandle: NodeJS.Timeout | undefined;

    mockedPinnedFetch.mockImplementation(async (_url, init) => {
      const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => {
          await new Promise<void>((resolve, reject) => {
            const onAbort = () => {
              const err = new Error("Aborted");
              err.name = "AbortError";
              reject(err);
            };
            if (signal?.aborted) {
              onAbort();
              return;
            }
            signal?.addEventListener("abort", onAbort, { once: true });
            // Hang indefinitely until abort
          });
        },
      };
    });

    const url = new URL(`${baseUrl}/api/arena/cloud-inference`);
    const payload = JSON.stringify({
      endpointUrl: "https://api.example.com/v1",
      prompt: "hello",
    });

    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          },
        },
        (res) => {
          // If we receive any response data or headers, the route wrote to the client.
          res.on("data", () => {
            responseSent = true;
          });
          res.on("end", () => {
            responseSent = true;
          });
        },
      );
      req.on("error", () => {
        // Expected when we destroy mid-flight
        if (timeoutHandle) clearTimeout(timeoutHandle);
        resolve();
      });
      req.write(payload);
      req.end();

      // Destroy the client connection after a brief delay
      timeoutHandle = setTimeout(() => {
        req.destroy();
      }, 20);
    });

    // Give the server time to finish handling the aborted request
    await new Promise((r) => {
      timeoutHandle = setTimeout(r, 50);
    });

    if (timeoutHandle) clearTimeout(timeoutHandle);

    // Assert: No response bytes or error payload were sent before client disconnect
    expect(responseSent).toBe(false);
    expect(mockedPinnedFetch).toHaveBeenCalled();
  });
});

describe("Olive-output security contract (property-based)", () => {
  const REJECTED_KEYS = ["path", "absolutePath", "cacheDir", "outputDir"] as const;
  const PBT_RUNS = 100;

  function assertEmptyStatus(res: LocalResponse, allowed: ReadonlyArray<number>) {
    expect(allowed).toContain(res.status);
    expect(res.body.length).toBe(0);
  }

  function assertListPayloadShape(body: {
    roots: Array<Record<string, unknown>>;
    entries: Array<Record<string, unknown>>;
    recent: Array<Record<string, unknown>>;
  }) {
    for (const root of body.roots) {
      expect(root).toEqual({ label: expect.any(String) });
      expect(root).not.toHaveProperty("path");
      expect(root).not.toHaveProperty("absolutePath");
    }
    for (const entry of [...body.entries, ...body.recent]) {
      expect(entry).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          displayPath: expect.any(String),
        }),
      );
      expect(entry).not.toHaveProperty("absolutePath");
      expect(entry).not.toHaveProperty("path");
    }
    expect(JSON.stringify(body)).not.toContain(tmpRoot);
  }

  it("Property 20: list rejects disallowed query keys with empty 400 body", async () => {
    // Feature: playground-tab, Property 20
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...REJECTED_KEYS),
        fc.string({ minLength: 0, maxLength: 64 }),
        async (key, value) => {
          const res = await request(
            "GET",
            `/api/arena/olive-outputs?${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
          );
          assertEmptyStatus(res, [400]);
        },
      ),
      { numRuns: PBT_RUNS },
    );
  });

  it("Property 20: download rejects disallowed query keys with empty 400 body", async () => {
    // Feature: playground-tab, Property 20
    const list = await request("GET", "/api/arena/olive-outputs");
    const body = (await list.json()) as { entries: Array<{ id: string }> };
    const knownId = body.entries[0]?.id ?? "deadbeef";

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...REJECTED_KEYS),
        fc.string({ minLength: 0, maxLength: 64 }),
        fc.boolean(),
        async (key, value, withId) => {
          const qs = withId
            ? `id=${encodeURIComponent(knownId)}&${encodeURIComponent(key)}=${encodeURIComponent(value)}`
            : `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
          const res = await request("GET", `/api/arena/olive-outputs/file?${qs}`);
          assertEmptyStatus(res, [400]);
        },
      ),
      { numRuns: PBT_RUNS },
    );
  });

  it("Property 20: unregistered opaque ids return empty 400 body", async () => {
    // Feature: playground-tab, Property 20
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.stringMatching(/^[a-f0-9]{64}$/),
          fc.string({ minLength: 1, maxLength: 80 }),
          fc.constant(""),
        ),
        async (id) => {
          const res = await request(
            "GET",
            `/api/arena/olive-outputs/file?id=${encodeURIComponent(id)}`,
          );
          // Empty/missing id and unknown registered ids are both 400 (never 404).
          assertEmptyStatus(res, [400]);
        },
      ),
      { numRuns: PBT_RUNS },
    );
  });

  it("Property 20b: list/download reject root-selection params; list exposes labels/ids/displayPath only", async () => {
    // Feature: playground-tab, Property 20b
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          path: fc.option(fc.string({ maxLength: 48 }), { nil: undefined }),
          absolutePath: fc.option(fc.string({ maxLength: 48 }), { nil: undefined }),
          cacheDir: fc.option(fc.string({ maxLength: 48 }), { nil: undefined }),
          outputDir: fc.option(fc.string({ maxLength: 48 }), { nil: undefined }),
        }),
        fc.constantFrom("list", "download") as fc.Arbitrary<"list" | "download">,
        async (params, endpoint) => {
          const present = Object.entries(params).filter(([, v]) => v !== undefined);
          fc.pre(present.length > 0);
          const qs = present
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`)
            .join("&");
          const pathUrl =
            endpoint === "list"
              ? `/api/arena/olive-outputs?${qs}`
              : `/api/arena/olive-outputs/file?${qs}`;
          const rejected = await request("GET", pathUrl);
          assertEmptyStatus(rejected, [400, 403]);

          // Fresh list without params still returns the server-bound shape only.
          const list = await request("GET", "/api/arena/olive-outputs");
          expect(list.status).toBe(200);
          assertListPayloadShape(
            (await list.json()) as {
              roots: Array<Record<string, unknown>>;
              entries: Array<Record<string, unknown>>;
              recent: Array<Record<string, unknown>>;
            },
          );
        },
      ),
      { numRuns: PBT_RUNS },
    );
  });

  it("Property 20: Content-Disposition sanitizes generated basenames", async () => {
    // Feature: playground-tab, Property 20 (sanitization)
    // Only characters that can be created as a single path segment on both Linux CI
    // and Windows. Quotes/backslashes/control bytes are covered by the unit assertion
    // on the sanitization regex below (they cannot be round-tripped via the filesystem).
    const basenameArb = fc
      .array(
        fc.oneof(fc.constant("'"), fc.stringMatching(/^[A-Za-z0-9_-]{1,10}$/)),
        { minLength: 1, maxLength: 6 },
      )
      .map((parts) => `${parts.join("")}.onnx`)
      .filter((name) => name !== ".onnx");

    await fc.assert(
      fc.asyncProperty(basenameArb, async (basename) => {
        const filePath = path.join(tmpRoot, "cache", basename);
        fs.writeFileSync(filePath, Buffer.alloc(8, 42));
        try {
          const list = await request("GET", "/api/arena/olive-outputs");
          expect(list.status).toBe(200);
          const body = (await list.json()) as {
            entries: Array<{ id: string; displayPath: string }>;
          };
          const entry = body.entries.find((e) => e.displayPath.endsWith(basename));
          expect(entry).toBeTruthy();

          const download = await request(
            "GET",
            `/api/arena/olive-outputs/file?id=${entry!.id}`,
          );
          expect(download.status).toBe(200);
          const disposition = String(download.headers["content-disposition"] ?? "");
          expect(disposition).toMatch(/^attachment;/);
          // quoted filename= must not contain raw quotes or backslashes after sanitize
          const quoted = /filename="([^"]*)"/.exec(disposition);
          expect(quoted?.[1]).toBeTruthy();
          expect(quoted?.[1]).not.toMatch(/["\\]/);
        } finally {
          fs.rmSync(filePath, { force: true });
        }
      }),
      { numRuns: PBT_RUNS },
    );
  });

  it("Content-Disposition sanitization replaces quotes, backslashes, and controls", () => {
    const sanitize = (basename: string) => {
      const safeBasename = basename.replace(/[\u0000-\u001f\u007f"\\]/g, "_");
      return safeBasename.replace(/[^\x20-\x7e]/g, "_");
    };
    expect(sanitize('a"b\\c\u0007d\u007fe.onnx')).toBe("a_b_c_d_e.onnx");
  });
});
