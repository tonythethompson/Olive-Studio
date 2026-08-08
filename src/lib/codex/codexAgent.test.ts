import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isModuleNotFoundError,
  _resetCodexStateForTests,
  getCodex,
  codexAsk,
  buildCodexPrompt,
} from "./codexAgent";

describe("codexAgent", () => {
  beforeEach(() => {
    _resetCodexStateForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("isModuleNotFoundError", () => {
    it("returns true for direct @openai/codex-sdk missing package errors", () => {
      const err = new Error("Cannot find package '@openai/codex-sdk' imported from /app");
      (err as unknown as Record<string, unknown>).code = "ERR_MODULE_NOT_FOUND";
      expect(isModuleNotFoundError(err)).toBe(true);
    });

    it("returns true when err.specifier or err.url contains @openai/codex-sdk", () => {
      const err = new Error("Module not found");
      (err as unknown as Record<string, unknown>).code = "ERR_MODULE_NOT_FOUND";
      (err as unknown as Record<string, unknown>).specifier = "@openai/codex-sdk";
      expect(isModuleNotFoundError(err)).toBe(true);
    });

    it("returns false for missing transitive dependencies inside installed packages", () => {
      const err = new Error("Cannot find package 'some-transitive-dep' imported from /node_modules/@openai/codex-sdk/index.js");
      (err as unknown as Record<string, unknown>).code = "ERR_MODULE_NOT_FOUND";
      (err as unknown as Record<string, unknown>).specifier = "some-transitive-dep";
      expect(isModuleNotFoundError(err)).toBe(false);
    });

    it("returns false for missing transitive dependencies without err.specifier", () => {
      const err = new Error(
        "Cannot find package 'some-transitive-dep' imported from /node_modules/@openai/codex-sdk/index.js",
      );
      (err as unknown as Record<string, unknown>).code = "ERR_MODULE_NOT_FOUND";
      expect(isModuleNotFoundError(err)).toBe(false);
    });

    it("returns false for non-module-not-found errors", () => {
      expect(isModuleNotFoundError(new Error("SyntaxError"))).toBe(false);
      expect(isModuleNotFoundError(new TypeError("Not a function"))).toBe(false);
      expect(isModuleNotFoundError("string error")).toBe(false);
    });
  });

  describe("buildCodexPrompt", () => {
    it("formats prompt with instructions and conversation history", () => {
      const prompt = buildCodexPrompt("System instructions here", [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ]);
      expect(prompt).toContain("System instructions here");
      expect(prompt).toContain("User: Hello");
      expect(prompt).toContain("Assistant: Hi there");
    });
  });

  describe("getCodex & export validation", () => {
    it("routes missing direct package through unavailable error message", async () => {
      const err = new Error("Cannot find package '@openai/codex-sdk'");
      (err as unknown as Record<string, unknown>).code = "ERR_MODULE_NOT_FOUND";

      // Mock dynamic import
      vi.stubGlobal("Function", function () {
        return () => Promise.reject(err);
      });

      await expect(getCodex()).rejects.toThrow(
        /Codex provider unavailable: @openai\/codex-sdk \(optionalDependencies\) is not installed/i,
      );
    });

    it("routes missing transitive dependency through 'failed to load' error message", async () => {
      const err = new Error("Cannot find package 'some-transitive-dep'");
      (err as unknown as Record<string, unknown>).code = "ERR_MODULE_NOT_FOUND";
      (err as unknown as Record<string, unknown>).specifier = "some-transitive-dep";

      vi.stubGlobal("Function", function () {
        return () => Promise.reject(err);
      });

      await expect(getCodex()).rejects.toThrow(/Codex provider failed to load\./i);
    });

    it("routes resolved SDK module without a valid Codex export through 'failed to load' error message", async () => {
      vi.stubGlobal("Function", function () {
        return () => Promise.resolve({});
      });

      await expect(getCodex()).rejects.toThrow(/Codex provider failed to load\./i);
    });

    it("successfully instantiates client when Codex constructor export is valid", async () => {
      class MockCodex {
        startThread() {
          return {
            run: () => Promise.resolve({ finalResponse: "Agent response", items: [] }),
          };
        }
      }

      vi.stubGlobal("Function", function () {
        return () => Promise.resolve({ Codex: MockCodex });
      });

      const codex = await getCodex();
      expect(codex).toBeTruthy();

      const response = await codexAsk("Test prompt");
      expect(response).toBe("Agent response");
    });

    it("clears cached state when Codex constructor throws so a later call can retry", async () => {
      let loadCount = 0;

      class ThrowingCodex {
        constructor() {
          throw new Error("constructor boom");
        }
      }

      class GoodCodex {
        startThread() {
          return {
            run: () => Promise.resolve({ finalResponse: "recovered", items: [] }),
          };
        }
      }

      vi.stubGlobal("Function", function () {
        return () => {
          loadCount += 1;
          if (loadCount === 1) {
            return Promise.resolve({ Codex: ThrowingCodex });
          }
          return Promise.resolve({ Codex: GoodCodex });
        };
      });

      await expect(getCodex()).rejects.toThrow(/Codex provider failed to load\./i);
      expect(loadCount).toBe(1);

      const codex = await getCodex();
      expect(codex).toBeTruthy();
      expect(loadCount).toBe(2);

      const response = await codexAsk("retry");
      expect(response).toBe("recovered");
    });
  });
});
