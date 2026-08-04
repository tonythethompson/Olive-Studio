import { describe, expect, it } from "vitest";
import {
  getModelCatalogMembership,
  modelCatalogMembershipLabel,
} from "./modelCatalogMembership";

const catalog = [{ id: "gpt-4o" }, { id: "claude-sonnet" }];

describe("getModelCatalogMembership", () => {
  it("returns empty for blank input", () => {
    expect(getModelCatalogMembership("  ", catalog, "live")).toEqual({ status: "empty" });
  });

  it("returns unknown-source when catalog source is unset", () => {
    expect(getModelCatalogMembership("gpt-4o", catalog, null)).toEqual({
      status: "unknown-source",
    });
  });

  it("detects ids present in a live catalog", () => {
    expect(getModelCatalogMembership("gpt-4o", catalog, "live")).toEqual({
      status: "in-catalog",
      source: "live",
    });
  });

  it("flags freehand ids missing from a live catalog", () => {
    expect(getModelCatalogMembership("my-fine-tune", catalog, "live")).toEqual({
      status: "not-in-catalog",
      source: "live",
    });
  });
});

describe("modelCatalogMembershipLabel", () => {
  it("only warns for unrecognized ids against a live catalog", () => {
    expect(modelCatalogMembershipLabel({ status: "in-catalog", source: "live" })).toBeNull();
    expect(modelCatalogMembershipLabel({ status: "in-catalog", source: "fallback" })).toBeNull();
    expect(
      modelCatalogMembershipLabel({ status: "not-in-catalog", source: "live" }),
    ).toBe("Model ID not recognized. Requests may fail.");
    expect(
      modelCatalogMembershipLabel({ status: "not-in-catalog", source: "fallback" }),
    ).toBeNull();
    expect(modelCatalogMembershipLabel({ status: "empty" })).toBeNull();
  });
});
