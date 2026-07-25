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

      // ----- React Hooks (core) -----
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // ----- React Compiler-powered lint rules (subset of eslint-plugin-react-hooks recommended) -----
      // Rules below are enabled as errors — they catch real bugs without React Compiler.
      // Rules flagged "warn" are best-effort; they may require refactoring patterns that are
      // safe without the compiler but strictly enforce Rules of React.

      // setState in render is always a bug — catches render-loop patterns
      "react-hooks/set-state-in-render": "error",
      // Accessing ref.current during render breaks reactivity — move to effects/event handlers
      "react-hooks/refs": "error",
      // Missing useMemo/useCallback where the compiler would have applied them
      "react-hooks/use-memo": "error",
      // Components defined inside other components re-mount on every render
      "react-hooks/static-components": "error",
      // Missing error boundaries
      "react-hooks/error-boundaries": "error",

      // Rules below are "warn" because they're designed for React Compiler-enabled code.
      // setState in effects is often intentional (data fetching, state init).
      "react-hooks/set-state-in-effect": "warn",
      // Hoisting checks are strict — useEffect closures run after render, so runtime is safe.
      "react-hooks/immutability": "warn",
      // Side-effect detection in render — valuable but can be noisy.
      "react-hooks/purity": "warn",
      // Only relevant when React Compiler is actively running transforms.
      "react-hooks/preserve-manual-memoization": "warn",
      // Internal Facebook feature-gating patterns — rarely applicable outside Meta.
      "react-hooks/incompatible-library": "warn",
      "react-hooks/globals": "warn",
      "react-hooks/config": "warn",
      "react-hooks/gating": "warn",
      "react-hooks/unsupported-syntax": "warn",

      // ----- Prevent common footguns -----
      "no-var": "error",
      "prefer-const": "warn",
      "no-duplicate-imports": "warn",
    },
  },
];
