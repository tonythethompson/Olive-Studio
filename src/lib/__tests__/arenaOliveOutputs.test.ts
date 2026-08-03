import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import {
  hasAllowedOliveOutputExtension,
  isPathInsideRoots,
  resolveOliveOutputRoots,
} from "@/lib/arenaOliveOutputs";

describe("resolveOliveOutputRoots", () => {
  it("defaults empty cacheDir to ~/.cache/olive and missing output to models/optimized", () => {
    const roots = resolveOliveOutputRoots({
      cacheDir: "",
      cwd: "/workspace",
      homedir: "/home/olive",
    });
    expect(roots).toEqual([
      { label: "cache", absolutePath: path.resolve("/home/olive", ".cache", "olive") },
      { label: "output", absolutePath: path.resolve("/workspace", "models/optimized") },
    ]);
  });

  it("dedupes when cache and output resolve to the same path", () => {
    const shared = path.join(os.tmpdir(), "olive-shared-root");
    const roots = resolveOliveOutputRoots({
      cacheDir: shared,
      outputDir: shared,
      cwd: "/",
      homedir: "/home/olive",
    });
    expect(roots).toHaveLength(1);
    expect(roots[0]?.label).toBe("cache");
  });

  it("resolves relative cacheDir against cwd like outputDir does", () => {
    const roots = resolveOliveOutputRoots({
      cacheDir: "relative/cache",
      outputDir: "relative/output",
      cwd: "/workspace",
      homedir: "/home/olive",
    });
    expect(roots).toEqual([
      { label: "cache", absolutePath: path.resolve("/workspace", "relative/cache") },
      { label: "output", absolutePath: path.resolve("/workspace", "relative/output") },
    ]);
  });

  it("handles Windows-style absolute paths without duplicating drive letters or breaking UNC", () => {
    const roots = resolveOliveOutputRoots({
      cacheDir: "C:\\Users\\test\\.cache\\olive",
      outputDir: "C:\\models\\optimized",
      cwd: "C:\\workspace",
      homedir: "C:\\Users\\test",
    });
    // Normalized to forward slashes internally but should not duplicate C: or break structure
    expect(roots[0]?.absolutePath).toMatch(/^C:\//);
    expect(roots[1]?.absolutePath).toMatch(/^C:\//);
    expect(roots[0]?.absolutePath).not.toMatch(/C:.*C:/);
    expect(roots[1]?.absolutePath).not.toMatch(/C:.*C:/);
  });

  it("preserves drive letter when resolving relative cache/output against a C:\\ cwd", () => {
    const roots = resolveOliveOutputRoots({
      cacheDir: "relative/cache",
      outputDir: "models/optimized",
      cwd: "C:\\workspace",
      homedir: "C:\\Users\\test",
    });
    expect(roots[0]?.absolutePath).toBe("C:/workspace/relative/cache");
    expect(roots[1]?.absolutePath).toBe("C:/workspace/models/optimized");
    expect(roots[0]?.absolutePath).not.toMatch(/^\/C:/);
    expect(roots[1]?.absolutePath).not.toMatch(/^\/C:/);
  });

  it("preserves UNC prefix when resolving relative cache/output against a \\\\server\\share base", () => {
    const roots = resolveOliveOutputRoots({
      cacheDir: "relative/cache",
      outputDir: "models/optimized",
      cwd: "\\\\server\\share\\workspace",
      homedir: "\\\\server\\share\\Users\\test",
    });
    expect(roots[0]?.absolutePath).toBe("//server/share/workspace/relative/cache");
    expect(roots[1]?.absolutePath).toBe("//server/share/workspace/models/optimized");
  });
});

describe("isPathInsideRoots", () => {
  it("accepts the root itself and nested files", () => {
    const root = path.resolve("/tmp/olive-root");
    expect(isPathInsideRoots(root, [root])).toBe(true);
    expect(isPathInsideRoots(path.join(root, "a", "b.onnx"), [root])).toBe(true);
  });

  it("rejects siblings and traversal escapes", () => {
    const root = path.resolve("/tmp/olive-root");
    expect(isPathInsideRoots(path.resolve("/tmp/olive-root-other/x.onnx"), [root])).toBe(false);
    expect(isPathInsideRoots(path.resolve("/tmp/escape.onnx"), [root])).toBe(false);
  });
});

describe("hasAllowedOliveOutputExtension", () => {
  it("allows .onnx and .ort only", () => {
    expect(hasAllowedOliveOutputExtension("model.onnx")).toBe(true);
    expect(hasAllowedOliveOutputExtension("model.ORT")).toBe(true);
    expect(hasAllowedOliveOutputExtension("model.bin")).toBe(false);
    expect(hasAllowedOliveOutputExtension("model.json")).toBe(false);
  });
});
