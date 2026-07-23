import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/lib/oliveRecipeBuilder.ts", "src/lib/pipelineValidation.ts", "src/lib/recipePipeline.ts"],
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
    },
  },
});
