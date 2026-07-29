import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Vitest configuration for integration tests.
 *
 * All external dependencies (Python, AI providers, LM Studio, Ollama) are
 * mocked via `src/server/__tests__/setup.integration.ts` so tests pass
 * reliably in any CI environment without real services installed.
 *
 * Run:  npx vitest run --config vitest.integration.config.ts
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["src/server/__tests__/setup.integration.ts"],
    include: ["src/server/__tests__/**/*.integration.test.ts"],
    // Integration tests start a real server — allow generous timeouts
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: "v8",
      include: [
        "src/server/routes/**/*.ts",
        "src/server/services/**/*.ts",
      ],
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage/integration",
    },
  },
});
