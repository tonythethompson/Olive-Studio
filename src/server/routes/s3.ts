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
import { containmentRoot } from "../services/shared/runtimePaths.ts";

/**
 * Validates a pull destination directory against the project root.
 * Rejects paths outside the root (including across Windows drives) and paths
 * that traverse symlinks — a lexical containment check alone is insufficient
 * because createWriteStream follows symlinks at write time.
 */
function validatePullDestDir(cwd: string, destDir: string): { ok: true } | { ok: false; error: string } {
  // path.relative returns an absolute path across roots (Windows drives),
  // which would slip past the ".." check — treat that as outside too.
  const relativeToCwd = path.relative(cwd, destDir);
  if (path.isAbsolute(relativeToCwd) || relativeToCwd.startsWith("..")) {
    return { ok: false, error: "Destination path must be inside the project directory." };
  }
  let cursor = cwd;
  for (const component of relativeToCwd ? relativeToCwd.split(path.sep) : []) {
    cursor = path.join(cursor, component);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) {
        return { ok: false, error: "Destination path must not contain symlinks." };
      }
    } catch (err: unknown) {
      if (!(err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT")) {
        return { ok: false, error: "Destination path could not be validated." };
      }
      break;
    }
  }
  return { ok: true };
}

/**
 * Application-owned staging directory for pull downloads. Bytes are written
 * here — never directly into the caller-supplied destination — so a symlink
 * swapped into the destination tree after validation cannot redirect the
 * download outside the project root. The finished file is published into the
 * destination only after re-validation.
 *
 * realpath resolves symlinks, so a staging directory that merely looks like
 * it lives under the project root is rejected.
 */
function resolvePullStagingDir(cwd: string): string {
  const staging = path.join(cwd, ".cache", "s3-pulls");
  fs.mkdirSync(staging, { recursive: true });
  const realStaging = fs.realpathSync(staging);
  const realCwd = fs.realpathSync(cwd);
  if (realStaging !== realCwd && !realStaging.startsWith(realCwd + path.sep)) {
    throw new Error("Staging directory could not be verified inside the project directory.");
  }
  return staging;
}

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
    // Reject unknown source values explicitly — silently defaulting a typo to
    // "private" could read the user's private bucket by accident.
    if (rawSource !== undefined && rawSource !== "public" && rawSource !== "private") {
      return res.status(400).json({ error: "source must be \"public\" or \"private\"." });
    }
    const source = rawSource === "public" ? "public" as const : "private" as const;

    // Default destination: <containment root>/models/optimized/<basename>.
    // In packaged apps the containment root is the per-user writable directory
    // — the installed resource directory (cwd) is read-only.
    const basename = path.basename(key);
    const cwd = containmentRoot();
    const destDir = rawDestDir?.trim() ? path.resolve(cwd, rawDestDir.trim()) : path.resolve(cwd, "models", "optimized");
    const destValidation = validatePullDestDir(cwd, destDir);
    if (!destValidation.ok) {
      return res.status(400).json({ error: destValidation.error });
    }
    const localPath = path.join(destDir, basename);
    // Download into the application-owned staging directory (realpath-verified
    // to be inside the project root). The destination tree is only touched at
    // publish time, after re-validation — a symlink swap during the download
    // cannot redirect bytes outside the project directory.
    let stagingDir: string;
    try {
      stagingDir = resolvePullStagingDir(cwd);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(400).json({ error: msg });
    }
    // Request-owned temp file: concurrent pulls can never clobber each other's
    // active download, and the final file only appears once fully downloaded.
    const tmpPath = path.join(stagingDir, `${process.pid}-${Date.now()}-${basename}`);

    // Fast-fail for the common case; the exclusive publish below is the
    // authoritative guard against concurrent pulls.
    if (fs.existsSync(localPath)) {
      return res.status(409).json({
        error: `File already exists: ${basename}`,
        localPath,
        hint: "Delete the existing file or specify a different destDir.",
      });
    }

    try {
      await pullModel(key, tmpPath, source);
      // Re-validate the destination immediately before publishing: a symlink
      // introduced into the destination tree after the preflight must abort
      // the publish instead of redirecting it.
      const revalidation = validatePullDestDir(cwd, destDir);
      if (!revalidation.ok) {
        return res.status(400).json({ error: revalidation.error });
      }
      try {
        // COPYFILE_EXCL fails if the destination appeared in the meantime.
        fs.copyFileSync(tmpPath, localPath, fs.constants.COPYFILE_EXCL);
      } catch (err: unknown) {
        if (!(err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "EEXIST")) {
          throw err;
        }
        return res.status(409).json({
          error: `File already exists: ${basename}`,
          localPath,
          hint: "Delete the existing file or specify a different destDir.",
        });
      }
      const stat = fs.statSync(localPath);
      return res.json({
        ok: true,
        localPath,
        sizeBytes: stat.size,
        source,
      });
    } catch (err: unknown) {
      // Clean up only this request's temp file.
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch { /* ignore cleanup failure */ }
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: `Download failed: ${msg}` });
    } finally {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch { /* already promoted or removed */ }
    }
  });
}
