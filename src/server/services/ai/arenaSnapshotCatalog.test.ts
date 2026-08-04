/**
 * Keep DEFAULT_BASE_URLS (client pure helper) aligned with registered AI plugins.
 * Drift here would make unit tests claim eligibility for a host the server never uses.
 */
import { describe, it, expect } from "vitest";
import { DEFAULT_BASE_URLS } from "../../../lib/arenaAssistantSnapshot.ts";
import "./index.ts"; // register all providers
import { allProviders } from "./registry.ts";

describe("DEFAULT_BASE_URLS catalog sync", () => {
  it("matches registerProvider defaultBaseUrl for every catalog entry that has one", () => {
    for (const plugin of allProviders()) {
      const catalog = DEFAULT_BASE_URLS[plugin.name];
      if (plugin.defaultBaseUrl && catalog) {
        expect(catalog).toBe(plugin.defaultBaseUrl);
      }
    }
  });
});
