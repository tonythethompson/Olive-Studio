/**
 * S3 model storage routes.
 *
 * All routes are loopback-only (studioLocalOnly) since they access user AWS
 * credentials and write to the local filesystem.
 *
 * Routes:
 *  GET  /s3/status        — Check S3 configuration status
 *  GET  /s3/models        — List models in user's private bucket
 *  GET  /s3/public-models — List models in public distribution bucket
 *  POST /s3/push          — Upload a local optimized model to S3
 *  POST /s3/pull          — Download a model from S3 to local disk
 */

import type { Router } from "express";
import path from "node:path";
import fs from "node:fs";

import { studioLocalOnly } from "../middleware/localOnly.ts";
import { heavyCommandRateLimit } from "../middleware/rateLimit.ts";
import { parseBody, isParseBodyError } from "../middleware/bodyGuard.ts";
import { resolveS3Config, resolvePublicS3Config } from "../services/s3/client.ts";
import { listUserModels, listPublicModels, pushModel, pullModel } from "../services/s3/operations.ts";
import { resolveOliveOutputForDownload } from "../services/playground/oliveOutputScan.ts";

export function mountS3Routes(router: Router): void {
  // ─── Status: check if S3 is configured ──────────────────────────────────
  router.get("/s3/status", studioLocalOnly, (_req, res) => {
    const privateCfg = resolveS3Config();
    const publicCfg = resolvePublicS3Config();
    return res.json({
      private: privateCfg
        ? { configured: true, bucket: privateCfg.bucket, region: privateCfg.region, prefix: privateCfg.prefix }
        : { configured: false },
      public: publicCfg
        ? { configured: true, bucket: publicCfg.bucket, region: publicCfg.region }
        : { configured: false },
    });
  });

  // ─── List user's private models ─────────────────────────────────────────
  router.get("/s3/models", studioLocalOnly, async (_req, res) => {
    try {
      const entries = await listUserModels();
      if (entries === null) {
        return res.status(400).json({ error: "S3 not configured. Set OLIVE_S3_BUCKET." });
      }
      return res.json({ models: entries });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: `Failed to list S3 models: ${msg}` });
    }
  });

  // ─── List public distribution models ────────────────────────────────────
  router.get("/s3/public-models", studioLocalOnly, async (_req, res) => {
    try {
      const entries = await listPublicModels();
      if (entries === null) {
        return res.status(400).json({ error: "Public model bucket not configured." });
      }
      return res.json({ models: entries });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: `Failed to list public models: ${msg}` });
    }
  });

  // ─── Push: upload a local optimized model to S3 ─────────────────────────
  router.post("/s3/push", studioLocalOnly, heavyCommandRateLimit, async (req, res) => {
    const body = parseBody<{ outputId: string; destKey?: string }>(req.body, {
      outputId: { type: "string", message: "Missing outputId (from /api/arena/olive-outputs)" },
      destKey: { type: "string", required: false },
    });
    if (isParseBodyError(body)) return res.status(400).json({ error: body.error });

    const { outputId, destKey } = body.parsed;

    // Resolve the local file from the opaque output ID (same system as Arena downloads)
    const resolved = resolveOliveOutputForDownload(outputId);
    if (!resolved.ok) {
      return res.status(resolved.status).json({ error: "Invalid or inaccessible output file." });
    }

    try {
      const key = await pushModel(resolved.absolutePath, destKey ?? undefined, (progress) => {
        // Progress is not streamed here — this is a simple POST.
        // Future: convert to NDJSON stream for large uploads.
        void progress;
      });
      return res.json({
        ok: true,
        key,
        bucket: resolveS3Config()!.bucket,
        sizeBytes: resolved.sizeBytes,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: `Upload failed: ${msg}` });
    }
  });

  // ─── Pull: download a model from S3 to local disk ──────────────────────
  router.post("/s3/pull", studioLocalOnly, heavyCommandRateLimit, async (req, res) => {
    const body = parseBody<{ key: string; source?: string; destDir?: string }>(req.body, {
      key: { type: "string", message: "Missing S3 object key" },
      source: { type: "string", required: false },
      destDir: { type: "string", required: false },
    });
    if (isParseBodyError(body)) return res.status(400).json({ error: body.error });

    const { key, source: rawSource, destDir: rawDestDir } = body.parsed;
    const source = rawSource === "public" ? "public" as const : "private" as const;

    // Default destination: ./models/optimized/<basename>
    const basename = path.basename(key);
    const cwd = process.cwd();
    const destDir = rawDestDir?.trim() ? path.resolve(cwd, rawDestDir.trim()) : path.resolve(cwd, "models", "optimized");
    if (path.relative(cwd, destDir).startsWith("..")) {
      return res.status(400).json({ error: "Destination path must be inside the project directory." });
    }
    // Reject symlinked destination components. A lexical containment check is
    // insufficient because createWriteStream follows symlinks at write time.
    let cursor = cwd;
    const relativeDest = path.relative(cwd, destDir);
    for (const component of relativeDest ? relativeDest.split(path.sep) : []) {
      cursor = path.join(cursor, component);
      try {
        if (fs.lstatSync(cursor).isSymbolicLink()) {
          return res.status(400).json({ error: "Destination path must not contain symlinks." });
        }
      } catch (err: unknown) {
        if (!(err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT")) {
          return res.status(400).json({ error: "Destination path could not be validated." });
        }
        break;
      }
    }
    const localPath = path.join(destDir, basename);

    // Don't overwrite existing files without explicit intent
    if (fs.existsSync(localPath)) {
      return res.status(409).json({
        error: `File already exists: ${basename}`,
        localPath,
        hint: "Delete the existing file or specify a different destDir.",
      });
    }

    try {
      await pullModel(key, localPath, source);
      const stat = fs.statSync(localPath);
      return res.json({
        ok: true,
        localPath,
        sizeBytes: stat.size,
        source,
      });
    } catch (err: unknown) {
      // Clean up partial downloads
      try {
        if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
      } catch { /* ignore cleanup failure */ }
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: `Download failed: ${msg}` });
    }
  });
}
