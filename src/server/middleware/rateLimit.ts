import rateLimit from "express-rate-limit";

export const kbStatusRateLimit = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { available: false, error: "Too many KB status requests. Please wait." },
});

export const kbSyncRateLimit = rateLimit({
  windowMs: 60_000,
  max: 2,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Rate limited: please wait before syncing again." },
});
