# Validate Production Builds Locally

The development server (`pnpm dev`) runs Express + Vite together. The production build bundles the client with Vite and the server with esbuild. This difference can hide bugs until deployment.

## Why it matters

Issues like case-sensitive file imports, missing public assets, or aggressive tree-shaking might not appear in Dev mode but will crash the Production build or runtime.

## Anti-Pattern

Pushing code to CI/CD immediately after verifying it works in `pnpm dev`.

```bash
# Don't do this only
pnpm dev
git commit -m "It works on my machine"
git push
```

## Correct Workflow

Always run a full build and production smoke locally before pushing major changes.

```package.json
{
  "scripts": {
    "dev": "tsx server.ts",
    "build": "vite build && esbuild server.ts --bundle --platform=node --format=esm --packages=external --sourcemap --outfile=dist/server.mjs",
    "start": "node dist/server.mjs",
    "lint": "tsc --noEmit && eslint"
  }
}
```

1. **Typecheck First:** Run `pnpm lint` (includes `tsc --noEmit`) to catch type errors.
2. **Build:** Run `pnpm build` to generate `dist/` (client assets + `dist/server.mjs`).
3. **Smoke:** Run `pnpm start` and click around the app on port 3000.
4. **Verify behaviors:** Confirm API routes, provider settings, and recipe export still work in the production bundle.
