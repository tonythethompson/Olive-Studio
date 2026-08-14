import { describe, expect, it } from "vitest";
import { applyInstallStreamEvent, parseInstallStreamEvent, type InstallStreamAcc } from "../runtimeEnvNdjson.ts";

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
});
