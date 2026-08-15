/**
 * GenAI model download service.
 *
 * Downloads the pre-optimized ONNX model from S3/CloudFront for the built-in
 * GenAI assistant provider. Models are cached locally so subsequent starts
 * are instant.
 *
 * Model location: .cache/genai-models/<model-name>/ (relative to project root)
 *
 * The model directory must contain:
 *  - genai_config.json (ONNX Runtime GenAI configuration)
 *  - model.onnx (or model.onnx.data for external data)
 *  - tokenizer files (tokenizer.json, tokenizer_config.json, etc.)
 */

import fs from "node:fs";
import path from "node:path";

import { resolvePublicS3Config } from "../s3/client.ts";
import { pullModel } from "../s3/operations.ts";

// ─── Configuration ────────────────────────────────────────────────────────────

/** Default model to download for the built-in GenAI assistant. */
export const DEFAULT_GENAI_MODEL = "qwen2.5-coder-1.5b-instruct-onnx";

/** Local cache directory for GenAI models. */
const GENAI_MODELS_DIR = path.join(process.cwd(), ".cache", "genai-models");

/**
 * CDN base URL for model downloads. Falls back to direct S3 if not set.
 * Set OLIVE_GENAI_CDN_URL for CloudFront distribution (recommended).
 */
function getCdnBaseUrl(): string | null {
  return process.env.OLIVE_GENAI_CDN_URL?.trim() || null;
}

// ─── Model Manifest ───────────────────────────────────────────────────────────

/**
 * Describes a downloadable GenAI model and its required files.
 * In production, this would come from a manifest.json in the S3 bucket.
 */
export interface GenaiModelManifest {
  name: string;
  displayName: string;
  description: string;
  /** S3 key prefix (under the public bucket prefix) for this model's files. */
  s3Prefix: string;
  /** List of files to download (relative to s3Prefix). */
  files: string[];
  /** Total download size in bytes (approximate, for progress). */
  totalBytes: number;
  /** Execution providers this model supports. */
  supportedEps: ("cpu" | "cuda" | "dml")[];
}

/**
 * Built-in model catalog. In the future this could be fetched from S3.
 * For now, the recommended default model is hardcoded.
 */
export const GENAI_MODEL_CATALOG: readonly GenaiModelManifest[] = [
  {
    name: "qwen2.5-coder-1.5b-instruct-onnx",
    displayName: "Qwen2.5-Coder (1.5B) ONNX",
    description: "Pre-optimized for Olive Studio assistant. Best accuracy for recipe generation.",
    s3Prefix: "qwen2.5-coder-1.5b-instruct-onnx/",
    files: [
      "genai_config.json",
      "model.onnx",
      "model.onnx.data",
      "tokenizer.json",
      "tokenizer_config.json",
      "special_tokens_map.json",
    ],
    totalBytes: 1_800_000_000, // ~1.8GB
    supportedEps: ["cpu", "cuda", "dml"],
  },
];

// ─── Status ───────────────────────────────────────────────────────────────────

export interface ModelDownloadStatus {
  /** Whether all required files are present locally. */
  ready: boolean;
  /** Local directory path (may not exist if not downloaded). */
  localPath: string;
  /** Files present vs required. */
  filesPresent: number;
  filesRequired: number;
  /** Total local size in bytes (0 if not downloaded). */
  localSizeBytes: number;
}

/**
 * Checks whether a GenAI model is fully downloaded and ready for inference.
 */
export function getModelStatus(modelName: string = DEFAULT_GENAI_MODEL): ModelDownloadStatus {
  const manifest = GENAI_MODEL_CATALOG.find((m) => m.name === modelName);
  if (!manifest) {
    return { ready: false, localPath: "", filesPresent: 0, filesRequired: 0, localSizeBytes: 0 };
  }

  const modelDir = path.join(GENAI_MODELS_DIR, manifest.name);
  let filesPresent = 0;
  let localSizeBytes = 0;

  for (const file of manifest.files) {
    const filePath = path.join(modelDir, file);
    if (fs.existsSync(filePath)) {
      filesPresent++;
      try {
        localSizeBytes += fs.statSync(filePath).size;
      } catch { /* ignore stat errors */ }
    }
  }

  return {
    ready: filesPresent === manifest.files.length,
    localPath: modelDir,
    filesPresent,
    filesRequired: manifest.files.length,
    localSizeBytes,
  };
}

/**
 * Returns the local model directory path if the model is ready.
 * Returns null if the model needs to be downloaded first.
 */
export function getReadyModelPath(modelName: string = DEFAULT_GENAI_MODEL): string | null {
  const status = getModelStatus(modelName);
  return status.ready ? status.localPath : null;
}

// ─── Download ─────────────────────────────────────────────────────────────────

export type DownloadProgressCallback = (progress: {
  file: string;
  fileIndex: number;
  totalFiles: number;
  bytesDownloaded: number;
  totalBytes: number;
  percent: number;
}) => void;

/**
 * Downloads all files for a GenAI model from S3/CDN to the local cache.
 *
 * Uses the public S3 bucket or CDN URL. Downloads are resumable at the file
 * level (partially downloaded files are removed and re-fetched).
 *
 * @param modelName - Model identifier from the catalog.
 * @param onProgress - Progress callback for UI streaming.
 * @returns The local model directory path on success.
 */
export async function downloadModel(
  modelName: string = DEFAULT_GENAI_MODEL,
  onProgress?: DownloadProgressCallback,
): Promise<{ ok: true; modelPath: string } | { ok: false; error: string }> {
  const manifest = GENAI_MODEL_CATALOG.find((m) => m.name === modelName);
  if (!manifest) {
    return { ok: false, error: `Unknown model: ${modelName}` };
  }

  const modelDir = path.join(GENAI_MODELS_DIR, manifest.name);
  fs.mkdirSync(modelDir, { recursive: true });

  const cdnUrl = getCdnBaseUrl();
  let bytesDownloaded = 0;

  for (let i = 0; i < manifest.files.length; i++) {
    const file = manifest.files[i];
    const localPath = path.join(modelDir, file);

    // Skip files that already exist (resume support)
    if (fs.existsSync(localPath)) {
      try {
        bytesDownloaded += fs.statSync(localPath).size;
      } catch { /* ignore */ }
      onProgress?.({
        file,
        fileIndex: i,
        totalFiles: manifest.files.length,
        bytesDownloaded,
        totalBytes: manifest.totalBytes,
        percent: Math.round((bytesDownloaded / manifest.totalBytes) * 100),
      });
      continue;
    }

    // Ensure subdirectory exists for the file
    fs.mkdirSync(path.dirname(localPath), { recursive: true });

    try {
      if (cdnUrl) {
        // Download from CloudFront CDN (simple HTTPS fetch)
        await downloadFromCdn(cdnUrl, manifest.s3Prefix + file, localPath, (loaded) => {
          onProgress?.({
            file,
            fileIndex: i,
            totalFiles: manifest.files.length,
            bytesDownloaded: bytesDownloaded + loaded,
            totalBytes: manifest.totalBytes,
            percent: Math.round(((bytesDownloaded + loaded) / manifest.totalBytes) * 100),
          });
        });
      } else {
        // Download from S3 directly (requires public bucket config)
        const publicCfg = resolvePublicS3Config();
        if (!publicCfg) {
          return { ok: false, error: "No CDN URL or public S3 bucket configured. Set OLIVE_GENAI_CDN_URL or OLIVE_S3_PUBLIC_BUCKET." };
        }
        const s3Key = publicCfg.prefix + manifest.s3Prefix + file;
        await pullModel(s3Key, localPath, "public", (progress) => {
          onProgress?.({
            file,
            fileIndex: i,
            totalFiles: manifest.files.length,
            bytesDownloaded: bytesDownloaded + progress.loaded,
            totalBytes: manifest.totalBytes,
            percent: Math.round(((bytesDownloaded + progress.loaded) / manifest.totalBytes) * 100),
          });
        });
      }

      // Update running total
      try {
        bytesDownloaded += fs.statSync(localPath).size;
      } catch { /* ignore */ }
    } catch (err: unknown) {
      // Clean up partial file
      try {
        if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
      } catch { /* ignore */ }
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Failed to download ${file}: ${msg}` };
    }
  }

  // Final verification
  const status = getModelStatus(modelName);
  if (!status.ready) {
    return { ok: false, error: `Download completed but verification failed (${status.filesPresent}/${status.filesRequired} files).` };
  }

  return { ok: true, modelPath: modelDir };
}

// ─── CDN Download Helper ──────────────────────────────────────────────────────

/**
 * Downloads a single file from CloudFront/CDN via HTTPS.
 */
async function downloadFromCdn(
  baseUrl: string,
  relativePath: string,
  localPath: string,
  onProgress?: (loaded: number) => void,
): Promise<void> {
  const url = `${baseUrl.replace(/\/$/, "")}/${relativePath}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`CDN download failed: ${response.status} ${response.statusText} for ${relativePath}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const writer = fs.createWriteStream(localPath);
  let loaded = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!writer.write(Buffer.from(value))) {
        await new Promise<void>((resolve, reject) => {
          writer.once("drain", resolve);
          writer.once("error", reject);
        });
      }
      loaded += value.byteLength;
      onProgress?.(loaded);
    }
  } finally {
    writer.end();
    await new Promise<void>((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });
  }
}
