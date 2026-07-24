import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactHooksPlugin from "eslint-plugin-react-hooks";

/** @type {import("eslint").Linter.Config[]} */
export default [
  { ignores: ["node_modules/", "dist/", "build/", "coverage/", ".firecrawl/", "*.config.*", "src/data/olive-recipes-catalog.ts"] },
  {
    files: ["src/**/*.{ts,tsx}", "server.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "react-hooks": reactHooksPlugin,
    },
    rules: {
      // ----- Catch unused variables/imports -----
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],

      // ----- Catch `as any` patterns -----
      "@typescript-eslint/no-explicit-any": "warn",

      // ----- Catch missing error handling -----
      "no-throw-literal": "error",

      // ----- Catch empty catch blocks or useless expressions -----
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "@typescript-eslint/no-unused-expressions": "warn",

      // ----- Stray console.log in production code -----
      "no-console": ["warn", { allow: ["warn", "error"] }],

      // ----- React Hooks -----
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // ----- Prevent common footguns -----
      "no-var": "error",
      "prefer-const": "warn",
      "no-duplicate-imports": "warn",
    },
  },
];
