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

/** Login / auth-sensitive endpoints (Codex, Devin). */
export const authActionRateLimit = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many auth requests. Please wait a minute and try again." },
});

/** Endpoints that spawn subprocesses (model pull, engine install). */
export const heavyCommandRateLimit = rateLimit({
  windowMs: 5 * 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many command requests. Please wait 5 minutes and try again." },
});

/** Endpoints that write filesystem / config (python path). */
export const fsWriteRateLimit = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many filesystem requests. Please wait a minute and try again." },
});

/** Olive job spawn (creates venv / runs recipes). */
export const oliveRunRateLimit = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "Too many Olive run requests. Please wait a minute and try again." },
});

/** GitHub raw proxy (outbound fetch). */
export const githubProxyRateLimit = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many GitHub proxy requests. Please wait a minute and try again." },
});

/** Arena cloud-inference proxy (outbound fetch to user-configured OpenAI-compatible hosts). */
export const arenaProxyRateLimit = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many Arena proxy requests. Please wait a minute and try again." },
});

/** Static / SPA file serving. */
export const staticServeRateLimit = rateLimit({
  windowMs: 60_000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests",
});
