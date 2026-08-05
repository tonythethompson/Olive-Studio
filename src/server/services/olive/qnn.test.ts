import { describe, expect, it } from "vitest";
import {
  getQnnHtpDiagnosticPath,
  readQnnHtpDiagnosticCache,
  writeQnnHtpDiagnosticCache,
} from "./qnn.ts";
import fs from "fs";
import os from "os";
import path from "path";

describe("qnn HTP diagnostic cache", () => {
  it("defaults to not_run when cache file is absent", () => {
    const prev = process.cwd();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "olive-qnn-cache-"));
    try {
      process.chdir(tmp);
      expect(readQnnHtpDiagnosticCache()).toEqual({ status: "not_run" });
      expect(getQnnHtpDiagnosticPath()).toContain(".olive-studio");
      writeQnnHtpDiagnosticCache({ status: "failed", detail: "no npu" });
      expect(readQnnHtpDiagnosticCache().status).toBe("failed");
      expect(readQnnHtpDiagnosticCache().detail).toBe("no npu");
    } finally {
      process.chdir(prev);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
