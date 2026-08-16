/**
 * S3 storage operations for Olive Studio optimized model artifacts.
 *
 * Provides push (upload), pull (download), and list operations for the
 * user's private bucket. Also supports reading from the public distribution bucket.
 */

import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, ListObjectsV2Command, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import {
  createS3Client,
  createPublicS3Client,
  resolveS3Config,
  resolvePublicS3Config,
} from "./client.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface S3ModelEntry {
  key: string;
  displayName: string;
  sizeBytes: number;
  lastModified: string;
}

export interface UploadProgress {
  percent: number;
  loaded: number;
  total: number;
}

// ─── List ─────────────────────────────────────────────────────────────────────

/**
 * Lists model artifacts in the user's private S3 bucket under the configured prefix.
 *
 * @returns Array of model entries, or null if S3 is not configured.
 */
export async function listUserModels(): Promise<S3ModelEntry[] | null> {
  const cfg = resolveS3Config();
  if (!cfg) return null;

  const client = createS3Client(cfg.region);
  const entries: S3ModelEntry[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: cfg.bucket,
        Prefix: cfg.prefix,
        ContinuationToken: continuationToken,
        MaxKeys: 200,
      }),
    );

    for (const obj of response.Contents ?? []) {
      if (!obj.Key || obj.Size == null) continue;
      // Skip "directory" markers
      if (obj.Key.endsWith("/")) continue;
      entries.push({
        key: obj.Key,
        displayName: obj.Key.slice(cfg.prefix.length),
        sizeBytes: obj.Size,
        lastModified: obj.LastModified?.toISOString() ?? "",
      });
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return entries;
}

/**
 * Lists pre-optimized models available in the public distribution bucket.
 *
 * @returns Array of model entries, or null if the public bucket is not configured.
 */
export async function listPublicModels(): Promise<S3ModelEntry[] | null> {
  const cfg = resolvePublicS3Config();
  if (!cfg) return null;

  const client = createPublicS3Client(cfg.region);
  const entries: S3ModelEntry[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: cfg.bucket,
        Prefix: cfg.prefix,
        ContinuationToken: continuationToken,
        MaxKeys: 100,
      }),
    );

    for (const obj of response.Contents ?? []) {
      if (!obj.Key || !obj.Size || obj.Key.endsWith("/")) continue;
      entries.push({
        key: obj.Key,
        displayName: obj.Key.slice(cfg.prefix.length),
        sizeBytes: obj.Size,
        lastModified: obj.LastModified?.toISOString() ?? "",
      });
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return entries;
}

// ─── Push (Upload) ────────────────────────────────────────────────────────────

/**
 * Resolves the S3 key for a push. destKey is treated as prefix-relative and
 * is always placed under the configured OLIVE_S3_PREFIX so pushed models stay
 * discoverable by listUserModels.
 */
function resolveDestKey(prefix: string, fallbackName: string, destKey?: string): string {
  const relative = (destKey ?? fallbackName).trim().replace(/^\/+/, "");
  const segments = relative.split("/");
  if (!relative || segments.some((segment) => segment === "" || segment === "..")) {
    throw new Error("Invalid destKey: must be a relative key under the configured S3 prefix.");
  }
  return `${prefix}${relative}`;
}

/**
 * Uploads a local file to the user's private S3 bucket.
 * Uses multipart upload for large files (>5MB automatically).
 *
 * @param localPath - Absolute path to the file on disk.
 * @param destKey - Optional custom key, relative to the configured prefix.
 * @param onProgress - Optional progress callback.
 * @returns The full S3 key of the uploaded object.
 */
export async function pushModel(
  localPath: string,
  destKey?: string,
  onProgress?: (progress: UploadProgress) => void,
): Promise<string> {
  const cfg = resolveS3Config();
  if (!cfg) throw new Error("S3 not configured. Set OLIVE_S3_BUCKET environment variable.");

  const stat = fs.statSync(localPath);
  if (!stat.isFile()) throw new Error(`Not a file: ${localPath}`);

  const key = resolveDestKey(cfg.prefix, path.basename(localPath), destKey);
  const client = createS3Client(cfg.region);
  const fileStream = fs.createReadStream(localPath);

  const upload = new Upload({
    client,
    params: {
      Bucket: cfg.bucket,
      Key: key,
      Body: fileStream,
      ContentType: inferContentType(localPath),
    },
    queueSize: 4,
    partSize: 8 * 1024 * 1024, // 8MB parts
  });

  upload.on("httpUploadProgress", (progress) => {
    if (onProgress && progress.loaded != null && stat.size > 0) {
      onProgress({
        percent: Math.round((progress.loaded / stat.size) * 100),
        loaded: progress.loaded,
        total: stat.size,
      });
    }
  });

  await upload.done();
  return key;
}

// ─── Pull (Download) ──────────────────────────────────────────────────────────

/**
 * Downloads an object from S3 to a local file path.
 * Supports both private bucket (authenticated) and public bucket (unsigned).
 *
 * @param key - The S3 object key to download.
 * @param localPath - Absolute destination path on disk.
 * @param source - "private" for user bucket, "public" for distribution bucket.
 * @param onProgress - Optional progress callback.
 */
export async function pullModel(
  key: string,
  localPath: string,
  source: "private" | "public" = "private",
  onProgress?: (progress: UploadProgress) => void,
): Promise<void> {
  const cfg = source === "public" ? resolvePublicS3Config() : resolveS3Config();
  if (!cfg) {
    const envVar = source === "public" ? "OLIVE_S3_PUBLIC_BUCKET" : "OLIVE_S3_BUCKET";
    throw new Error(`S3 not configured. Set ${envVar} environment variable.`);
  }

  const client = source === "public" ? createPublicS3Client(cfg.region) : createS3Client(cfg.region);

  // Get file size first for progress reporting
  let totalSize = 0;
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
    totalSize = head.ContentLength ?? 0;
  } catch {
    // HEAD failed — proceed without progress reporting
  }

  const response = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
  if (!response.Body) throw new Error(`Empty response for key: ${key}`);

  // Ensure destination directory exists
  const destDir = path.dirname(localPath);
  fs.mkdirSync(destDir, { recursive: true });

  const body = response.Body as Readable;
  const writeStream = fs.createWriteStream(localPath);

  let downloaded = 0;
  body.on("data", (chunk: Buffer) => {
    downloaded += chunk.length;
    if (onProgress && totalSize > 0) {
      onProgress({
        percent: Math.round((downloaded / totalSize) * 100),
        loaded: downloaded,
        total: totalSize,
      });
    }
  });

  await pipeline(body, writeStream);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inferContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".onnx":
      return "application/x-onnx";
    case ".ort":
      return "application/x-onnx-runtime";
    case ".json":
      return "application/json";
    case ".bin":
      return "application/octet-stream";
    case ".safetensors":
      return "application/octet-stream";
    default:
      return "application/octet-stream";
  }
}
