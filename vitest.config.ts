import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["src/server/**", "src/components/**", "**/*.integration.test.ts", "node_modules/**"],
    coverage: {
      provider: "v8",
      include: [
        "src/lib/**/*.ts",
        "src/components/features/**/*.tsx",
        "src/server/routes/**/*.ts",
      ],
      exclude: ["**/*.test.*", "**/__tests__/**"],
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
    },
  },
});
