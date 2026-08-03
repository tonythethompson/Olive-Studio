import type { NextFunction, Request, Response } from "express";

/**
 * Reject non-loopback clients for local-first sensitive routes (Arena proxy).
 * Override with OLIVE_ARENA_ALLOW_REMOTE=true for Docker / remote lab setups.
 */
export function isLoopbackRemoteAddress(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  const ip = remoteAddress.replace(/^::ffff:/i, "").toLowerCase();
  return ip === "127.0.0.1" || ip === "::1" || ip === "localhost";
}

export function arenaLocalOnly(req: Request, res: Response, next: NextFunction): void {
  if (process.env.OLIVE_ARENA_ALLOW_REMOTE === "true") {
    next();
    return;
  }
  if (isLoopbackRemoteAddress(req.socket.remoteAddress)) {
    next();
    return;
  }
  res.status(403).json({ error: "Arena endpoints are only available from loopback" });
}
