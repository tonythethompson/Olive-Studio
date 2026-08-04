import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { runNdjsonInstall } from "./ndjsonInstall.ts";

function ndjsonResponse(frames: string[], status = 200): Response {
  const body = frames.join("");
  return new Response(body, {
    status,
    headers: { "content-type": "application/x-ndjson" },
  });
}

describe("runNdjsonInstall", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses log and done frames", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ndjsonResponse([
          '{"type":"log","message":"step 1"}\n',
          '{"type":"done","ok":true}\n',
        ]),
      ),
    );
    const log: string[] = [];
    await runNdjsonInstall("/api/env/install-openvino", (u) => {
      const next = typeof u === "function" ? u(log) : u;
      log.splice(0, log.length, ...next);
    });
    expect(log).toEqual(["step 1"]);
  });

  it("flushes a final unterminated frame after the reader completes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ndjsonResponse(['{"type":"log","message":"partial"}\n', '{"type":"done","ok":true}']),
      ),
    );
    const log: string[] = [];
    await runNdjsonInstall("/api/env/install-openvino", (u) => {
      const next = typeof u === "function" ? u(log) : u;
      log.splice(0, log.length, ...next);
    });
    expect(log).toEqual(["partial"]);
  });

  it("throws when done reports failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ndjsonResponse(['{"type":"done","ok":false,"error":"pip failed"}\n'], 500),
      ),
    );
    await expect(runNdjsonInstall("/api/env/x", () => undefined)).rejects.toThrow("pip failed");
  });
});
