import { describe, it, expect } from "vitest";
import { getFileDetailedInfo } from "../localFileDetails";

describe("getFileDetailedInfo", () => {
  it("prefers reconstructed history over localFiles for the same baseName", () => {
    const localFiles = [{ name: "model.onnx", size: 10 }];
    const reconstructedHistory = [
      {
        baseName: "model.onnx",
        totalSize: 42,
        finalHash: "sha256:abc",
        chunks: [
          { name: "model.onnx.001", size: 20, hash: "sha256:c1" },
          { name: "model.onnx.002", size: 22, hash: "sha256:c2" },
        ],
        reconstructedAt: "2026-01-01T00:00:00.000Z",
      },
    ];

    const info = getFileDetailedInfo("model.onnx", localFiles, reconstructedHistory);

    expect(info).toMatchObject({
      name: "model.onnx",
      size: 42,
      status: "Reconstructed Binary",
      reconstructed: true,
    });
    expect(info?.lineage).toEqual(reconstructedHistory[0]);
  });

  it("returns Local Asset when only localFiles contains the name", () => {
    const info = getFileDetailedInfo("plain.onnx", [{ name: "plain.onnx", size: 8 }], []);
    expect(info).toMatchObject({
      status: "Local Asset",
      reconstructed: false,
      lineage: null,
    });
  });
});
