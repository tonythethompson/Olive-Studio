import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Vitest configuration for component tests (jsdom environment).
 * Standalone config — does not merge with the base config to avoid
 * inheriting the base exclude which omits src/components/.
 *
 * Run with: npx vitest run --config vitest.component.config.ts
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/components/**/*.test.tsx", "src/components/**/*.test.ts"],
    exclude: ["node_modules/**", "src/lib/__tests__/**", "src/**/*.server.test.*"],
    setupFiles: [],
  },
});
