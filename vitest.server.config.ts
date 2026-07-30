import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Vitest configuration for server-side module tests.
 * Run with: npx vitest run --config vitest.server.config.ts
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
    include: ["src/server/**/*.test.ts"],
    exclude: ["src/server/**/*.integration.test.ts"],
    coverage: {
      provider: "v8",
      include: [
        "src/server/services/ai/**/*.ts",
        "src/server/services/venv/**/*.ts",
        "src/server/services/olive/**/*.ts",
        "src/server/middleware/**/*.ts",
      ],
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage/server",
    },
  },
});
