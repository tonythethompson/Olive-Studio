/**
 * Unit tests for useCatalogPin hook utilities.
 *
 * Tests the exported pure utility functions (loadStoredMetadata, saveStoredMetadata)
 * and validates the localStorage persistence contract for catalog pinning.
 *
 * The React hook logic is tested via component tests in the jsdom environment.
 *
 * @see Requirements 10.2, 10.3, 10.5, 10.6
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  loadStoredMetadata,
  saveStoredMetadata,
  CATALOG_PIN_STORAGE_KEY,
} from "./useCatalogPin";
import type { CatalogMetadata } from "@/lib/recipeCatalogPin";

// ─── localStorage mock ───────────────────────────────────────────────────────

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
})();

beforeEach(() => {
  localStorageMock.clear();
  vi.stubGlobal("localStorage", localStorageMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("loadStoredMetadata", () => {
  it("returns null when nothing is stored", () => {
    expect(loadStoredMetadata()).toBeNull();
  });

  it("returns null for invalid JSON in localStorage", () => {
    localStorageMock.setItem(CATALOG_PIN_STORAGE_KEY, "not-valid-json{");
    expect(loadStoredMetadata()).toBeNull();
  });

  it("returns null when stored object is missing required fields", () => {
    localStorageMock.setItem(
      CATALOG_PIN_STORAGE_KEY,
      JSON.stringify({ branch: "main" }),
    );
    expect(loadStoredMetadata()).toBeNull();
  });

  it("returns null when commitSha is not 40 characters", () => {
    localStorageMock.setItem(
      CATALOG_PIN_STORAGE_KEY,
      JSON.stringify({
        branch: "main",
        commitSha: "abc123",
        fetchedAt: "2025-01-01T00:00:00.000Z",
      }),
    );
    expect(loadStoredMetadata()).toBeNull();
  });

  it("returns null when commitSha is 40 non-hex characters", () => {
    localStorageMock.setItem(
      CATALOG_PIN_STORAGE_KEY,
      JSON.stringify({
        branch: "main",
        commitSha: "z".repeat(40),
        fetchedAt: "2025-01-01T00:00:00.000Z",
      }),
    );
    expect(loadStoredMetadata()).toBeNull();
  });

  it("returns valid metadata when all fields are present and SHA is 40 chars", () => {
    const validMetadata: CatalogMetadata = {
      branch: "main",
      commitSha: "a".repeat(40),
      fetchedAt: "2025-07-01T12:00:00.000Z",
    };
    localStorageMock.setItem(CATALOG_PIN_STORAGE_KEY, JSON.stringify(validMetadata));

    const result = loadStoredMetadata();
    expect(result).toEqual(validMetadata);
  });

  it("returns metadata for 40-char alphanumeric SHA", () => {
    const validMetadata: CatalogMetadata = {
      branch: "release/v2",
      commitSha: "1234567890abcdef1234567890abcdef12345678",
      fetchedAt: "2025-06-15T08:30:00.000Z",
    };
    localStorageMock.setItem(CATALOG_PIN_STORAGE_KEY, JSON.stringify(validMetadata));

    const result = loadStoredMetadata();
    expect(result).toEqual(validMetadata);
  });
});

describe("saveStoredMetadata", () => {
  it("persists metadata to localStorage under the correct key", () => {
    const metadata: CatalogMetadata = {
      branch: "main",
      commitSha: "b".repeat(40),
      fetchedAt: "2025-07-01T12:00:00.000Z",
    };

    saveStoredMetadata(metadata);

    const raw = localStorageMock.getItem(CATALOG_PIN_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual(metadata);
  });

  it("overwrites previously stored metadata", () => {
    const first: CatalogMetadata = {
      branch: "main",
      commitSha: "a".repeat(40),
      fetchedAt: "2025-01-01T00:00:00.000Z",
    };
    const second: CatalogMetadata = {
      branch: "develop",
      commitSha: "f".repeat(40),
      fetchedAt: "2025-07-01T12:00:00.000Z",
    };

    saveStoredMetadata(first);
    saveStoredMetadata(second);

    const result = loadStoredMetadata();
    expect(result).toEqual(second);
  });

  it("does not throw when localStorage is unavailable", () => {
    // Simulate localStorage quota exceeded
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("QuotaExceededError");
      },
      removeItem: () => {},
      clear: () => {},
      length: 0,
      key: () => null,
    });

    const metadata: CatalogMetadata = {
      branch: "main",
      commitSha: "c".repeat(40),
      fetchedAt: "2025-07-01T12:00:00.000Z",
    };

    // Should not throw
    expect(() => saveStoredMetadata(metadata)).not.toThrow();
  });
});

describe("CATALOG_PIN_STORAGE_KEY", () => {
  it("is the expected key value", () => {
    expect(CATALOG_PIN_STORAGE_KEY).toBe("olive-studio:catalog-pin");
  });
});

describe("roundtrip: save then load", () => {
  it("preserves metadata across save/load cycle", () => {
    const metadata: CatalogMetadata = {
      branch: "feature/test-branch",
      commitSha: "0123456789abcdef0123456789abcdef01234567",
      fetchedAt: "2025-07-20T15:45:30.123Z",
    };

    saveStoredMetadata(metadata);
    const loaded = loadStoredMetadata();
    expect(loaded).toEqual(metadata);
  });
});
