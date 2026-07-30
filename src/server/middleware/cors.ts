import type { RequestHandler } from "express";

/**
 * CORS middleware — browser + Tauri webviews.
 * Allows same-origin, localhost, and Tauri origins.
 */
export const corsMiddleware: RequestHandler = (req, res, next) => {
  const origin = req.headers.origin;
  let allowed = false;

  if (!origin) {
    allowed = true;
  } else if (origin === "tauri://localhost" || origin === "https://tauri.localhost") {
    allowed = true;
  } else {
    try {
      const url = new URL(origin);
      const hostname = url.hostname;
      if (hostname === "localhost" || hostname === "127.0.0.1") {
        allowed = true;
      }
    } catch {
      allowed = false;
    }
  }

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
