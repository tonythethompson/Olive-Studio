import express, { Router } from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import { loadStudioEnv } from "./src/server/loadStudioEnv.ts";
import { mountSystemRoutes, type SystemProbeOptions } from "./src/server/routes/system.ts";
import { mountGithubRoutes } from "./src/server/routes/github.ts";
import { mountAiRoutes } from "./src/server/routes/ai.ts";
import { mountMcpRoutes, performKbSync } from "./src/server/routes/mcp.ts";
import { mountEnvRoutes } from "./src/server/routes/env.ts";
import { mountOliveRoutes } from "./src/server/routes/olive.ts";
import { mountArenaRoutes } from "./src/server/routes/arena.ts";
import { probeTensorRtLoadable } from "./src/server/services/olive/tensorrt.ts";
import { probeTensorRtRtxLoadable } from "./src/server/services/olive/tensorrt-rtx.ts";
import { probeOpenVino } from "./src/server/services/olive/openvino.ts";
import { staticServeRateLimit } from "./src/server/middleware/rateLimit.ts";

// After imports: hydrate .env / .env.local / Windows User+Machine API keys into process.env.
loadStudioEnv();

const app = express();
app.use(express.json({ limit: "10mb" }));

/** Shared readiness flag: false until listen succeeds (or tests call markServerReady). */
let serverReady = false;

export function markServerReady(): void {
  serverReady = true;
}

export function isServerReady(): boolean {
  return serverReady;
}

// CORS early — browser + Tauri webviews (same-origin normally; helps desktop edge cases)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  let allowed = false;

  if (!origin) {
    allowed = true;
  } else if (origin === "tauri://localhost" || origin === "https://tauri.localhost") {
    // Exact match for Tauri origins
    allowed = true;
  } else {
    // Parse URL to validate hostname for http origins (any port allowed for local/Tauri)
    try {
      const url = new URL(origin);
      const hostname = url.hostname;

      // Allow localhost and 127.0.0.1 with any port for dev/Tauri
      if (hostname === "localhost" || hostname === "127.0.0.1") {
        allowed = true;
      }
    } catch {
      // Invalid URL, reject
      allowed = false;
    }
  }

  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
});

const PORT = Number.parseInt(process.env.PORT || "3000", 10) || 3000;

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
 */
function shouldServeProductionStatic(): boolean {
  if (process.env.NODE_ENV === "production") return true;
  if (process.env.NODE_ENV === "development") return false;
  if (process.env.OLIVE_DIST_DIR) return true;
  const entry = (process.argv[1] ?? "").replace(/\\/g, "/");
  return (
    entry.endsWith("/dist/server.mjs") ||
    entry.endsWith("server.mjs") ||
    // legacy CJS bundle name (older builds)
    entry.endsWith("/dist/server.cjs") ||
    entry.endsWith("server.cjs")
  );
}

/**
 * Starts the server with development middleware or production static assets, then listens for incoming connections.
 */
async function startServer() {
  if (!shouldServeProductionStatic()) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        watch: {
          ignored: ["**/.venv/**", "**/node_modules/**", "**/models/**", "**/.cache/**"],
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
    app.use(staticServeRateLimit, express.static(distPath, { index: "index.html" }));
    // SPA fallback for client routes (Express 5-safe; avoid bare "*")
    app.use(staticServeRateLimit, (req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      if (req.path.startsWith("/api")) return next();
      res.sendFile(indexHtml);
    });
    // eslint-disable-next-line no-console -- intentional server startup message
    console.log(`Serving UI from ${distPath}`);
  }

  await new Promise<void>((resolve) => {
    app.listen(PORT, "0.0.0.0", () => {
      markServerReady();
      // eslint-disable-next-line no-console -- intentional server startup message
      console.log(`Server running on http://localhost:${PORT}`);
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
      resolve();
    });
  });
}

process.on("SIGINT", () => {
  // eslint-disable-next-line no-console -- intentional shutdown logging
  console.log("\n[SIGINT] Shutting down (modular routes handle cleanup).");
  process.exit(0);
});

process.on("SIGTERM", () => {
  // eslint-disable-next-line no-console -- intentional shutdown logging
  console.log("\n[SIGTERM] Shutting down (modular routes handle cleanup).");
  process.exit(0);
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
