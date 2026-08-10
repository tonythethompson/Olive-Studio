import { describe, it, expect } from "vitest";
import { zipSync, strToU8, unzipSync } from "fflate";

/**
 * Regression tests for OWR deployment bundle ZIP generation.
 * Validates that the fflate-based archive (replacing jszip) produces
 * correct, decompressible archives with all expected files.
 */
describe("OWR bundle ZIP generation (fflate)", () => {
  const mockOrtConfig = { session_options: { graph_optimization_level: "all" } };
  const mockManifest = { model: "test-model", passes: ["OnnxConversion"] };
  const mockWebInit = 'import * as ort from "onnxruntime-web";\n// init code';
  const mockMobileInit = "class OnnxModelExecutor {\n  // init code\n}";

  function buildArchive(platform: "web" | "mobile"): Uint8Array {
    const files: Record<string, Uint8Array> = {};
    files["ort_config.json"] = strToU8(JSON.stringify(mockOrtConfig, null, 2));
    files["onnx_model_manifest.json"] = strToU8(JSON.stringify(mockManifest, null, 2));

    if (platform === "web") {
      files["web_init.js"] = strToU8(mockWebInit);
    } else {
      files["mobile_init.kt"] = strToU8(mockMobileInit);
    }

    files["README.txt"] = strToU8("ONNX Runtime Deployment Bundle\nTarget: " + platform);

    return zipSync(files);
  }

  it("produces a valid ZIP for web platform", () => {
    const archive = buildArchive("web");
    expect(archive).toBeInstanceOf(Uint8Array);
    expect(archive.byteLength).toBeGreaterThan(0);

    // Verify contents by decompressing
    const decompressed = unzipSync(archive);
    const fileNames = Object.keys(decompressed).sort();
    expect(fileNames).toEqual([
      "README.txt",
      "onnx_model_manifest.json",
      "ort_config.json",
      "web_init.js",
    ]);
  });

  it("produces a valid ZIP for mobile platform", () => {
    const archive = buildArchive("mobile");
    const decompressed = unzipSync(archive);
    const fileNames = Object.keys(decompressed).sort();
    expect(fileNames).toEqual([
      "README.txt",
      "mobile_init.kt",
      "onnx_model_manifest.json",
      "ort_config.json",
    ]);
  });

  it("preserves JSON content integrity through zip/unzip", () => {
    const archive = buildArchive("web");
    const decompressed = unzipSync(archive);

    const ortContent = new TextDecoder().decode(decompressed["ort_config.json"]);
    expect(JSON.parse(ortContent)).toEqual(mockOrtConfig);

    const manifestContent = new TextDecoder().decode(decompressed["onnx_model_manifest.json"]);
    expect(JSON.parse(manifestContent)).toEqual(mockManifest);
  });

  it("preserves text file content through zip/unzip", () => {
    const archive = buildArchive("web");
    const decompressed = unzipSync(archive);

    const webInit = new TextDecoder().decode(decompressed["web_init.js"]);
    expect(webInit).toBe(mockWebInit);

    const readme = new TextDecoder().decode(decompressed["README.txt"]);
    expect(readme).toContain("ONNX Runtime Deployment Bundle");
    expect(readme).toContain("Target: web");
  });

  it("produces a Blob-compatible ArrayBuffer", () => {
    const archive = buildArchive("web");
    // This is what the component does to create the download
    const blob = new Blob([archive as unknown as ArrayBuffer], { type: "application/zip" });
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe("application/zip");
  });

  it("handles empty string content without error", () => {
    const files: Record<string, Uint8Array> = {};
    files["empty.txt"] = strToU8("");
    files["data.json"] = strToU8(JSON.stringify({}));

    const archive = zipSync(files);
    const decompressed = unzipSync(archive);
    expect(new TextDecoder().decode(decompressed["empty.txt"])).toBe("");
    expect(JSON.parse(new TextDecoder().decode(decompressed["data.json"]))).toEqual({});
  });

  it("handles unicode content in README", () => {
    const files: Record<string, Uint8Array> = {};
    files["README.txt"] = strToU8("Model: llama-3-8B — optimized with Olive™ 🫒");
    const archive = zipSync(files);
    const decompressed = unzipSync(archive);
    expect(new TextDecoder().decode(decompressed["README.txt"])).toBe(
      "Model: llama-3-8B — optimized with Olive™ 🫒",
    );
  });
});
