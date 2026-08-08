import type { NextFunction, Request, Response } from "express";

/**
 * Reject non-loopback clients for local-first sensitive routes (Arena proxy).
 *
 * The HTTP server binds `0.0.0.0`, so loopback on `req.socket.remoteAddress`
 * alone is not enough: a same-host reverse proxy makes every client look local.
 * When the override is off, also reject requests that carry reverse-proxy
 * forwarding headers.
 *
 * Override with `OLIVE_ARENA_ALLOW_REMOTE=true` for Docker / remote lab setups
 * (disables this gate intentionally).
 */
export function isLoopbackRemoteAddress(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  const ip = remoteAddress.replace(/^::ffff:/i, "").toLowerCase();
  return ip === "127.0.0.1" || ip === "::1" || ip === "localhost";
}

/** Headers that indicate the request arrived via a reverse proxy / trusted hop. */
const PROXY_FORWARDING_HEADERS = [
  "x-forwarded-for",
  "x-forwarded-host",
  "x-real-ip",
  "forwarded",
] as const;

export function hasProxyForwardingHeaders(req: Request): boolean {
  for (const name of PROXY_FORWARDING_HEADERS) {
    const value = req.headers[name];
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.some((v) => typeof v === "string" && v.trim().length > 0)) return true;
    } else if (typeof value === "string" && value.trim().length > 0) {
      return true;
    }
  }
  return false;
}

function enforceLoopbackOnly(req: Request, res: Response, next: NextFunction): void {
  // Same-host reverse proxies preserve a loopback remoteAddress while exposing
  // Arena to the outside world — reject when forwarding headers are present.
  if (hasProxyForwardingHeaders(req)) {
    res.status(403).json({
      error: "Arena endpoints are only available from loopback (not via reverse proxy)",
    });
    return;
  }
  if (isLoopbackRemoteAddress(req.socket.remoteAddress)) {
    next();
    return;
  }
  res.status(403).json({ error: "Arena endpoints are only available from loopback" });
}

export function arenaLocalOnly(req: Request, res: Response, next: NextFunction): void {
  if (process.env.OLIVE_ARENA_ALLOW_REMOTE === "true") {
    next();
    return;
  }
  enforceLoopbackOnly(req, res, next);
}

/**
 * Strict loopback gate for credential-bearing routes (e.g. Assistant API key snapshot).
 * Never honors `OLIVE_ARENA_ALLOW_REMOTE` — remote Arena access must not expose secrets.
 */
export function arenaStrictLocalOnly(req: Request, res: Response, next: NextFunction): void {
  enforceLoopbackOnly(req, res, next);
}

/**
 * Strict loopback gate for Studio-local MCP / agent routes (policy, job control).
 * Never honors `OLIVE_ARENA_ALLOW_REMOTE`. Rejects reverse-proxy hops and non-loopback.
 */
export function studioLocalOnly(req: Request, res: Response, next: NextFunction): void {
  if (hasProxyForwardingHeaders(req) || !isLoopbackRemoteAddress(req.socket.remoteAddress)) {
    res.status(403).json({ error: "This endpoint is only available from loopback" });
    return;
  }
  next();
}
