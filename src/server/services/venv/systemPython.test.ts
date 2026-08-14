import { describe, expect, it } from "vitest";
import { collectPreferredPythonFileCandidates, parsePythonExeLines } from "./systemPython.ts";

describe("parsePythonExeLines", () => {
  it("reads pymanager --format=exe lines", () => {
    const text = [
      "C:\\Users\\me\\AppData\\Local\\Python\\pythoncore-3.12-64\\python.exe",
      "C:\\Users\\me\\AppData\\Local\\Programs\\Python\\Python311\\python.exe",
    ].join("\n");
    expect(parsePythonExeLines(text)).toEqual([
      "C:\\Users\\me\\AppData\\Local\\Python\\pythoncore-3.12-64\\python.exe",
      "C:\\Users\\me\\AppData\\Local\\Programs\\Python\\Python311\\python.exe",
    ]);
  });

  it("reads legacy py -0p output", () => {
    const text = " -3.12-64        C:\\Users\\me\\AppData\\Local\\Programs\\Python\\Python312\\python.exe *";
    expect(parsePythonExeLines(text)).toEqual([
      "C:\\Users\\me\\AppData\\Local\\Programs\\Python\\Python312\\python.exe",
    ]);
  });
});

describe("collectPreferredPythonFileCandidates", () => {
  it("prefers Python 3.12 and includes the install-manager layout on Windows", () => {
    const found = collectPreferredPythonFileCandidates("win32", {
      LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
      ProgramFiles: "C:\\Program Files",
    });
    expect(found[0]).toContain("Python312");
    expect(found.some((p) => p.replace(/\\/g, "/").includes("Local/Python/bin/python3.12.exe"))).toBe(
      true,
    );
  });

  it("includes versioned interpreters for Linux", () => {
    const found = collectPreferredPythonFileCandidates("linux", {});
    expect(found.some((p) => p.replace(/\\/g, "/").endsWith("/usr/bin/python3.12"))).toBe(true);
    expect(found.some((p) => p.replace(/\\/g, "/").endsWith("/usr/bin/python3.10"))).toBe(true);
  });

  it("includes the python.org framework install on macOS", () => {
    const found = collectPreferredPythonFileCandidates("darwin", {});
    expect(
      found.some((p) => p.includes("/Library/Frameworks/Python.framework/Versions/3.12/bin/python3")),
    ).toBe(true);
  });
});
