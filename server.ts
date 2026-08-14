import express, { NextFunction, Request, Response, Router } from "express";
import expressStaticGzip from "express-static-gzip";
import helmet from "helmet";
import path from "path";
import fs from "fs";
import { ANY_DOT_VENV_DIR } from "./src/server/shared/anyDotVenvDir.ts";

import { loadStudioEnv } from "./src/server/loadStudioEnv.ts";
import { shutdownMcpClient } from "./src/server/services/mcp/client.ts";
import { mountSystemRoutes, type SystemProbeOptions } from "./src/server/routes/system.ts";
import { mountGithubRoutes } from "./src/server/routes/github.ts";
import { mountAiRoutes } from "./src/server/routes/ai/index.ts";
import { mountMcpRoutes, performKbSync } from "./src/server/routes/mcp.ts";
import { ensureMcpSetupInBackground } from "./src/server/services/mcp/ensureMcpSetup.ts";
import { mountEnvRoutes } from "./src/server/routes/env.ts";
import { mountOliveRoutes } from "./src/server/routes/olive.ts";
import { mountArenaRoutes } from "./src/server/routes/arena.ts";
import { probeTensorRtLoadable } from "./src/server/services/olive/tensorrt.ts";
import { probeTensorRtRtxLoadable } from "./src/server/services/olive/tensorrt-rtx.ts";
import { probeOpenVino } from "./src/server/services/olive/openvino.ts";
import { probeQnn } from "./src/server/services/olive/qnn.ts";
import { staticServeRateLimit } from "./src/server/middleware/rateLimit.ts";
import { corsMiddleware } from "./src/server/middleware/cors.ts";

// After imports: hydrate .env / .env.local / Windows User+Machine API keys into process.env.
loadStudioEnv();

const app = express();
// strict:false lets top-level JSON null/primitives reach parseBody, which
// rejects non-objects. Omitted bodies stay undefined (defaulted per-route).
app.use(express.json({ limit: "10mb", strict: false }));

// Security headers with a CSP that allows the app's own assets + CDN for ORT WASM.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://esm.sh"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "https://cdn.jsdelivr.net", "https://huggingface.co", "https://*.hf.co"],
      workerSrc: ["'self'", "blob:"],
      childSrc: ["'self'", "blob:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
    },
  },
}));

// Prevent indexing if accidentally exposed to the public internet
app.use((_req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex");
  next();
});

/** Shared readiness flag: false until listen succeeds (or tests call markServerReady). */
let serverReady = false;

export function markServerReady(): void {
  serverReady = true;
}

export function isServerReady(): boolean {
  return serverReady;
}

// CORS early — browser + Tauri webviews (same-origin normally; helps desktop edge cases)
app.use(corsMiddleware);

const PORT = Number.parseInt(process.env.PORT || "3000", 10) || 3000;

/**
 * Bind address. Defaults to 127.0.0.1. Set OLIVE_BIND=0.0.0.0 only when you
 * explicitly need LAN access and understand the threat model: wider binding
 * exposes only routes without loopback gates, while Olive UI actions
 * (/api/olive/run, status, stream, cancel) and /api/mcp/sync-kb remain
 * loopback-only. The API assumes a local-trust threat model and must not be
 * exposed to LAN or public networks without bind and authentication fixes.
 * SYNC_KB_TOKEN is not protection for remote sync access.
 */
const BIND_HOST = process.env.OLIVE_BIND?.trim() || "127.0.0.1";
const IS_ALL_INTERFACES = BIND_HOST === "0.0.0.0" || BIND_HOST === "::";

// ─── GitHub recipe proxy route ──────────────────────────────────────────────────

// ─── Modular route wiring ────────────────────────────────────────────────────

const githubRouter = Router();
mountGithubRoutes(githubRouter);
app.use("/api", githubRouter);

const aiRouter = Router();
mountAiRoutes(aiRouter);
app.use("/api", aiRouter);

const mcpRouter = Router();
mountMcpRoutes(mcpRouter);
app.use("/api", mcpRouter);

const envRouter = Router();
mountEnvRoutes(envRouter);
app.use("/api", envRouter);

const oliveRouter = Router();
mountOliveRoutes(oliveRouter);
app.use("/api", oliveRouter);

const systemRouter = Router();
const systemProbeOpts: SystemProbeOptions = {
  probeTensorRtLoadable,
  probeTensorRtRtxLoadable,
  probeOpenVino,
  probeQnn,
};
mountSystemRoutes(systemRouter, systemProbeOpts);
app.use("/api", systemRouter);

const arenaRouter = Router();
mountArenaRoutes(arenaRouter);
app.use("/api", arenaRouter);

// ─── Health check (required by Tauri desktop bootstrap) ────────────────────
// Tauri (src-tauri/src/lib.rs wait_for_health) accepts ready:true, ok:true, or status:"ok".
app.get("/api/health", (_req, res) => {
  if (!serverReady) {
    return res.status(503).json({
      status: "starting",
      ready: false,
      uptime: process.uptime(),
    });
  }
  return res.json({
    status: "ok",
    ready: true,
    ok: true,
    uptime: process.uptime(),
  });
});

// ─── API 404 fallback ────────────────────────────────────────────────────
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API route not found." });
});

// ─── Vite / Static ────────────────────────────────────────────────────────────
/**
 * `pnpm start` runs the bundled `dist/server.mjs` and must serve static files.
 * Only `pnpm dev` (tsx server.ts) should use Vite middleware.
 * Do not rely solely on NODE_ENV — Windows/`pnpm start` often leave it unset.
 * ESM format is required: packages like @openai/codex-sdk are ESM-only (no CJS export).
 *
 * Precedence: `OLIVE_SERVE_STATIC` (explicit, testable) → `NODE_ENV` →
 * `OLIVE_DIST_DIR` → entry-script fallback for a bare `node dist/server.mjs`.
 */
function shouldServeProductionStatic(): boolean {
  const explicit = process.env.OLIVE_SERVE_STATIC;
  if (explicit === "true" || explicit === "1") return true;
  if (explicit === "false" || explicit === "0") return false;
  if (process.env.NODE_ENV === "production") return true;
  if (process.env.NODE_ENV === "development") return false;
  if (process.env.OLIVE_DIST_DIR) return true;
  // Back-compat fallback: `pnpm start` / `node dist/server.mjs` without any env set.
  const entry = (process.argv[1] ?? "").replace(/\\/g, "/");
  return entry.endsWith("dist/server.mjs") || entry.endsWith("dist/server.cjs");
}

/**
 * Starts the server with development middleware or production static assets, then listens for incoming connections.
 */
async function startServer() {
  if (!shouldServeProductionStatic()) {
    // Dynamic import keeps vite (a devDependency) out of the production
    // runtime path — the static branch never loads it.
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        watch: {
          ignored: [
            "**/.venv/**",
            ANY_DOT_VENV_DIR,
            "**/node_modules/**",
            "**/models/**",
            "**/.cache/**",
          ],
        },
      },
      appType: "spa",
    });
    // Pre-bundle deps BEFORE Tauri WebView opens — otherwise every import is "Failed to fetch"
    try {
      await vite.warmupRequest("/src/main.tsx");
      await vite.warmupRequest("/src/App.tsx");
    } catch (err) {
      console.warn("[vite] warmup skipped:", err instanceof Error ? err.message : err);
    }
    app.use((req, res, next) => {
      if (req.path.startsWith("/api")) {
        return next();
      }
      vite.middlewares(req, res, next);
    });
  } else {
    // Ensure downstream code and logs treat this as production.
    process.env.NODE_ENV = "production";
    const distPath = path.resolve(process.env.OLIVE_DIST_DIR ?? path.join(process.cwd(), "dist"));
    const indexHtml = path.join(distPath, "index.html");
    if (!fs.existsSync(indexHtml)) {
      console.error(`Production build not found at ${indexHtml}\nRun: pnpm build\nThen:  pnpm start`);
      process.exit(1);
    }
    app.use(
      staticServeRateLimit,
      expressStaticGzip(distPath, {
        index: "index.html",
        enableBrotli: true,
        orderPreference: ["br", "gz"],
        serveStatic: {
          setHeaders: (res, filePath) => {
            if (/index\.html(\.(gz|br))?$/.test(filePath)) {
              // express-static-gzip rewrites the served path to the .gz
              // variant when the client accepts it, so a plain endsWith
              // check on "index.html" misses it — the SPA shell would fall
              // through to the hashed-asset branch below and get cached.
              res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
              return;
            }
            // Only Vite's Rollup-emitted JS/CSS carry a content hash in the
            // filename (name-<8-char-hash>.js) — safe to cache forever.
            // Matching on extension alone would also catch any stable-URL
            // .js/.css copied verbatim from public/, so require the actual
            // hash suffix. Everything else under dist/ (logo.png, fonts,
            // favicon) has a stable URL and must be revalidated, not served
            // from a 1-year cache untouched.
            const isHashedBuildOutput = /-[\w-]{8}\.(js|css)(\.(gz|br))?$/.test(filePath);
            res.setHeader(
              "Cache-Control",
              isHashedBuildOutput ? "public, max-age=31536000, immutable" : "public, max-age=3600",
            );
          },
        },
      }),
    );
    // SPA fallback for client routes (Express 5-safe; avoid bare "*")
    app.use(staticServeRateLimit, (req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      if (req.path.startsWith("/api")) return next();
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.sendFile(indexHtml);
    });
    // eslint-disable-next-line no-console -- intentional server startup message
    console.log(`Serving UI from ${distPath}`);
  }

  // ─── Global error handling (must be last, before listen) ────────────────────
  // Sanitize 500s so stack traces are not leaked to clients. Registered at the
  // end of startServer() so errors from Vite, static middleware, and all
  // application middleware are handled here.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[express] unhandled error:", err instanceof Error ? err.stack ?? err.message : err);
    if (res.headersSent) return;
    res.status(500).json({ error: "Internal server error" });
  });

  await new Promise<void>((resolve) => {
    app.listen(PORT, BIND_HOST, () => {
      markServerReady();
      const displayHost = IS_ALL_INTERFACES ? "0.0.0.0 (all interfaces)" : BIND_HOST;
      // eslint-disable-next-line no-console -- intentional server startup message
      console.log(`Server running on http://${displayHost}:${PORT}`);
      if (IS_ALL_INTERFACES) {
        console.warn(
          "[security] Server is bound to all network interfaces. Only enable this on a trusted LAN and protect sync/admin endpoints with SYNC_KB_TOKEN.",
        );
      }
      // Soft KB sync on boot: reload passes.json and persist freshness so the
      // header does not start "stale" after every server restart.
      try {
        const result = performKbSync();
        if (result.ok) {
          // eslint-disable-next-line no-console -- intentional server startup message
          console.log(`[kb] synced at startup (${result.status.passCount ?? "?"} passes)`);
        } else {
          console.warn("[kb] startup sync skipped:", result.body.error ?? "unavailable");
        }
      } catch (err: unknown) {
        console.warn("[kb] startup sync failed:", err instanceof Error ? err.message : err);
      }
      // Fire-and-forget: sets up the bundled MCP server venv on first launch of
      // a packaged desktop build (or a fresh checkout that skipped postinstall).
      // Never blocks readiness or startup.
      if (shouldServeProductionStatic()) {
        ensureMcpSetupInBackground();
      }
      resolve();
    });
  });
}

process.on("SIGINT", () => {
  // eslint-disable-next-line no-console -- intentional shutdown logging
  console.log("\n[SIGINT] Shutting down.");
  void shutdownMcpClient().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  // eslint-disable-next-line no-console -- intentional shutdown logging
  console.log("\n[SIGTERM] Shutting down.");
  void shutdownMcpClient().finally(() => process.exit(0));
});

process.on("exit", () => {
  // Modular routes handle their own cleanup
});

export { app };

// Only start the server when run directly (not imported by tests)
import { fileURLToPath } from "url";
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  startServer();
}
