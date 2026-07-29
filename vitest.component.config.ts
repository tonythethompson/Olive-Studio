import { defineConfig, mergeConfig } from "vitest/config";
import path from "path";
import baseConfig from "./vitest.config";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      include: ["src/components/**/*.test.tsx", "src/components/**/*.test.ts"],
      exclude: ["src/lib/__tests__/**", "src/**/*.server.test.*"],
      setupFiles: [],
      globals: true,
    },
  }),
);
