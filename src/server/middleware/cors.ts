import type { RequestHandler } from "express";

/** Same-origin, loopback, and Tauri webview origins. Missing Origin is treated as a non-browser local client. */
export function isTrustedStudioOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (origin === "tauri://localhost" || origin === "https://tauri.localhost") return true;
  try {
    const url = new URL(origin);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/**
 * CORS middleware — browser + Tauri webviews.
 * Allows same-origin, localhost, and Tauri origins.
 */
export const corsMiddleware: RequestHandler = (req, res, next) => {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
  const allowed = isTrustedStudioOrigin(origin);

  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
};
