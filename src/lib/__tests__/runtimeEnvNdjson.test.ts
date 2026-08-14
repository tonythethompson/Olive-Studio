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

  it("does not throw progress text when the stream ends without a done event", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"type":"log","message":"Installing…"}\n'));
        controller.close();
      },
    });
    const res = new Response(stream, { status: 200 });
    await expect(consumeInstallNdjson(res, "Could not install Python.")).rejects.toThrow(
      "Could not install Python.",
    );
  });

  it("uses the done error, not the last progress line, when the install fails", async () => {
    const body = [
      '{"type":"log","message":"Installing…"}\n',
      '{"type":"done","ok":false,"error":"winget missing"}\n',
    ].join("");
    const res = new Response(body, {
      status: 200,
      headers: { "content-type": "application/x-ndjson" },
    });
    const result = await consumeInstallNdjson(res, "Could not install Python.");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("winget missing");
  });

  it("uses the done message as the error when ok is false and error is omitted", async () => {
    const body = '{"type":"log","message":"Installing…"}\n{"type":"done","ok":false,"message":"pip failed"}\n';
    const res = new Response(body, { status: 200 });
    const result = await consumeInstallNdjson(res, "Could not install Python.");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("pip failed");
  });
});
