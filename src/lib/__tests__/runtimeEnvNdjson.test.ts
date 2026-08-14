import { describe, expect, it } from "vitest";
import {
  applyInstallStreamEvent,
  consumeInstallNdjson,
  parseInstallStreamEvent,
  type InstallStreamAcc,
} from "../runtimeEnvNdjson.ts";

describe("runtimeEnvNdjson", () => {
  it("ignores blank and non-JSON lines", () => {
    expect(parseInstallStreamEvent("")).toBeNull();
    expect(parseInstallStreamEvent("not-json")).toBeNull();
  });

  it("applies log and done events", () => {
    const acc: InstallStreamAcc = { finalOk: null, lastLog: "fallback" };
    applyInstallStreamEvent(acc, { type: "log", message: "Installing…" });
    applyInstallStreamEvent(acc, { type: "done", ok: true, message: "ready", command: "winget" });
    expect(acc.lastLog).toBe("ready");
    expect(acc.finalOk).toBe(true);
    expect(acc.command).toBe("winget");
  });

  it("consumes an NDJSON response stream (including chunk boundaries)", async () => {
    const logs: string[] = [];
    const chunks = [
      '{"type":"log","message":"Installing…"}\n{"type":"do',
      'ne","ok":true,"message":"ready","command":"winget"}\n',
    ];

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(enc.encode(chunk));
        controller.close();
      },
    });

    const res = new Response(stream, { status: 200 });
    const result = await consumeInstallNdjson(res, "fallback error", (m) => logs.push(m));

    expect(result.ok).toBe(true);
    expect(result.message).toBe("ready");
    expect(result.command).toBe("winget");
    expect(result.downloadUrl).toBeUndefined();
    expect(logs).toEqual(["Installing…"]);
  });
});
