import { describe, expect, it, vi } from "vitest";
import { writeNamedSse } from "./olive.ts";

describe("writeNamedSse", () => {
  it("writes event name plus JSON data", () => {
    const chunks: string[] = [];
    const res = {
      writableEnded: false,
      write: vi.fn((chunk: string) => {
        chunks.push(chunk);
      }),
    };
    writeNamedSse(res, "log", { line: "hello" });
    expect(chunks.join("")).toBe('event: log\ndata: {"line":"hello"}\n\n');
  });

  it("no-ops when the response already ended", () => {
    const write = vi.fn();
    writeNamedSse({ writableEnded: true, write }, "done", { done: true });
    expect(write).not.toHaveBeenCalled();
  });
});
