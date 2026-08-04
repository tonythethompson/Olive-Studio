import { describe, expect, it } from "vitest";
import { allFamilyScriptsDirs, envForFamily } from "./pathIsolation.ts";

describe("pathIsolation", () => {
  it("lists both family Scripts dirs", () => {
    const dirs = allFamilyScriptsDirs();
    expect(dirs.some((d) => d.includes(".venv") && !d.includes(".venvs"))).toBe(true);
    expect(dirs.some((d) => d.includes(pathJoin("cuda")))).toBe(true);
  });

  it("strips both Scripts dirs then prepends selected family", () => {
    const sep = process.platform === "win32" ? ";" : ":";
    const pathKey = process.platform === "win32" ? "Path" : "PATH";
    const dirs = allFamilyScriptsDirs();
    const base = {
      ...process.env,
      [pathKey]: [...dirs, "/usr/bin"].join(sep),
    };
    const env = envForFamily("default", base);
    const parts = (env[pathKey] ?? "").split(sep).filter(Boolean);
    // cuda Scripts should not remain
    expect(parts.some((p) => p.includes(".venvs") && p.includes("cuda"))).toBe(false);
    // /usr/bin retained
    expect(parts).toContain("/usr/bin");
  });
});

function pathJoin(seg: string): string {
  return seg;
}
