/**
 * S3 client factory with dual credential mode.
 *
 * Mirrors the Bedrock provider pattern:
 *  1. Explicit credentials from env/config: AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY
 *  2. Auto-detect from default credential chain (env, ~/.aws/credentials, IAM role, SSO)
 *
 * Bucket and region are configured via environment variables:
 *  - OLIVE_S3_BUCKET: target bucket name (required for push/pull operations)
 *  - OLIVE_S3_PREFIX: optional key prefix for all objects (default: "olive-studio/")
 *  - OLIVE_S3_REGION: bucket region (falls back to AWS_REGION, then us-east-1)
 *  - OLIVE_S3_PUBLIC_BUCKET: read-only public bucket for pre-optimized models (CDN source)
 *  - OLIVE_S3_PUBLIC_REGION: region for the public bucket
 */

import { S3Client } from "@aws-sdk/client-s3";
import { fromIni } from "@aws-sdk/credential-providers";

// ─── Configuration ────────────────────────────────────────────────────────────

export interface S3Config {
  bucket: string;
  prefix: string;
  region: string;
}

/** Resolves S3 configuration for the user's private bucket (push/pull). */
export function resolveS3Config(): S3Config | null {
  const bucket = process.env.OLIVE_S3_BUCKET?.trim();
  if (!bucket) return null;

  const prefix = process.env.OLIVE_S3_PREFIX?.trim() || "olive-studio/";
  const region =
    process.env.OLIVE_S3_REGION?.trim() ||
    process.env.AWS_REGION?.trim() ||
    process.env.AWS_DEFAULT_REGION?.trim() ||
    "us-east-1";

  return { bucket, prefix, region };
}

/** Resolves S3 configuration for the public model distribution bucket (read-only). */
export function resolvePublicS3Config(): S3Config | null {
  const bucket = process.env.OLIVE_S3_PUBLIC_BUCKET?.trim();
  if (!bucket) return null;

  const prefix = process.env.OLIVE_S3_PUBLIC_PREFIX?.trim() || "models/";
  // Mirror resolveS3Config's fallback chain so both clients agree when only
  // AWS_DEFAULT_REGION is set.
  const region =
    process.env.OLIVE_S3_PUBLIC_REGION?.trim() ||
    process.env.AWS_REGION?.trim() ||
    process.env.AWS_DEFAULT_REGION?.trim() ||
    "us-east-1";

  return { bucket, prefix, region };
}

// ─── Client Factory ───────────────────────────────────────────────────────────

/**
 * Creates an S3Client using the same dual-mode credential resolution as the
 * Bedrock provider: explicit env vars → AWS_PROFILE → default chain.
 */
export function createS3Client(region: string): S3Client {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();

  if (accessKeyId && secretAccessKey) {
    return new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  const profile = process.env.AWS_PROFILE?.trim();
  if (profile) {
    return new S3Client({
      region,
      credentials: fromIni({ profile }),
    });
  }

  // Default credential chain
  return new S3Client({ region });
}

/**
 * Creates an unauthenticated S3Client for reading from a public bucket.
 * Uses the signer override to skip signing (public-read ACL or bucket policy).
 */
export function createPublicS3Client(region: string): S3Client {
  return new S3Client({
    region,
    signer: { sign: async (request) => request },
  });
}
