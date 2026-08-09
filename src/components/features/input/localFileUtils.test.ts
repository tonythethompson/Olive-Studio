import { describe, expect, it } from "vitest";
import { getReconstructableGroups } from "./localFileUtils";

function files(...names: string[]) {
  return names.map((name) => ({ name, size: 1024 }));
}

describe("getReconstructableGroups", () => {
  it("accepts a valid consecutive 001/002 pair", () => {
    expect(getReconstructableGroups(files("model.bin.001", "model.bin.002"))).toEqual([
      ["model.bin", [{ name: "model.bin.001", size: 1024 }, { name: "model.bin.002", size: 1024 }]],
    ]);
  });

  it("rejects a single chunk", () => {
    expect(getReconstructableGroups(files("model.bin.001"))).toEqual([]);
  });

  it("rejects sequences that start at 002", () => {
    expect(getReconstructableGroups(files("model.bin.002", "model.bin.003"))).toEqual([]);
  });

  it("rejects gaps such as 001/003", () => {
    expect(getReconstructableGroups(files("model.bin.001", "model.bin.003"))).toEqual([]);
  });

  it("rejects duplicate suffixes", () => {
    expect(getReconstructableGroups(files("model.bin.001", "model.bin.001"))).toEqual([]);
  });

  it("rejects noncanonical suffix padding such as 0001/0002", () => {
    expect(getReconstructableGroups(files("model.0001", "model.0002"))).toEqual([]);
  });
});
