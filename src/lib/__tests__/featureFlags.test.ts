import { afterEach, describe, expect, it } from "vitest";
import { isMultiLoraEnabled } from "@/lib/featureFlags";

const ENV_KEY = "VITE_FEATURE_MULTI_LORA";

describe("featureFlags Node env fallback", () => {
  const previous = process.env[ENV_KEY];

  afterEach(() => {
    if (previous === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = previous;
    }
  });

  it("enables multiLora from process.env when Vite import.meta.env is unset", () => {
    process.env[ENV_KEY] = "true";
    expect(isMultiLoraEnabled()).toBe(true);
  });

  it("treats process.env 1 as enabled", () => {
    process.env[ENV_KEY] = "1";
    expect(isMultiLoraEnabled()).toBe(true);
  });
});
