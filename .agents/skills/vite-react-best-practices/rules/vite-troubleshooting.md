# Common Vite Troubleshooting

Quick fixes for the most frequent issues encountered in Vite + React projects.

## 1. "Module is external" (SSR / bundler)

**Cause:** A dependency is treated as external during SSR or library mode, so Vite/Rollup does not bundle it and Node tries to resolve it at runtime.
**Fix:** Add the package to `ssr.noExternal` (or remove it from `ssr.external`) so Vite pre-bundles it for the server graph.

```ts
// vite.config.ts
export default defineConfig({
  ssr: {
    noExternal: ["some-cjs-only-lib"],
  },
});
```

## 2. "Cannot find module" (dev / client)

**Cause:** Missing dependency, wrong import path, or a CJS package that Vite has not pre-optimized for the browser graph.
**Fix:** Install the package, fix the import, or add it to `optimizeDeps.include` so esbuild pre-bundles it on first dev load.

```ts
// vite.config.ts
export default defineConfig({
  optimizeDeps: {
    include: ["broken-lib/dist/utils"],
  },
});
```

## 3. HMR Not Working (Full Reload on Save)

**Cause:**

1. **Circular Dependency:** A imports B, B imports A. Check console warnings.
2. **Export Default vs Named:** React Fast Refresh prefers Named Exports or consistent exports.
3. **Case Sensitivity:** Vite cannot resolve imports whose casing differs from the actual filename on Linux (and in CI), even when a case-insensitive filesystem (macOS/Windows) hides the mismatch. Import paths must match the exact filename casing to prevent production or CI build failures.

## 4. Styles Missing in Production

**Cause:** Dynamic imports of CSS files that the bundler cannot trace statically.
**Fix:** Ensure CSS imports are static or part of the module graph.

## 5. 404 on Refresh

**Cause:** Missing client-side routing fallback.
**Fix:** Configure rewrites on your static host (see `vite-spa-rewrites.md`).
