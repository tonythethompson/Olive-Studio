/** Reconstructed ONNX/bin assembly tracked in the local file inspector. */
export interface ReconstructedFileItem {
  baseName: string;
  totalSize: number;
  finalHash: string;
  chunks: { name: string; size: number; hash: string }[];
  reconstructedAt: string;
}

/** Lineage for an archived chunk points back at the assembled model. */
export type ArchivedChunkLineage = ReconstructedFileItem & { parent: string };

export type FileDetailLineage = ReconstructedFileItem | ArchivedChunkLineage;

export interface FileDetailedInfo {
  name: string;
  size: number;
  status: string;
  isChunk: boolean;
  reconstructed: boolean;
  lineage: FileDetailLineage | null;
}

const CHUNK_SUFFIX = /^(.*)\.(\d{3,})$/;

/** True when filename looks like a numbered chunk segment (e.g. model.onnx.001). */
export function isChunkFileName(filename: string): boolean {
  return CHUNK_SUFFIX.test(filename);
}

/**
 * Resolve inspector details for a selected local/reconstructed file.
 * Prefer reconstructed history when the same baseName also exists in localFiles.
 */
export function getFileDetailedInfo(
  name: string | null,
  localFiles: Array<{ name: string; size: number }>,
  reconstructedHistory: ReconstructedFileItem[],
): FileDetailedInfo | null {
  if (!name) return null;

  const recon = reconstructedHistory.find((r) => r.baseName === name);
  if (recon) {
    return {
      name: recon.baseName,
      size: recon.totalSize,
      status: "Reconstructed Binary",
      isChunk: false,
      reconstructed: true,
      lineage: recon,
    };
  }

  const active = localFiles.find((f) => f.name === name);
  if (active) {
    return {
      name: active.name,
      size: active.size,
      status: "Local Asset",
      isChunk: isChunkFileName(active.name),
      reconstructed: false,
      lineage: null,
    };
  }

  for (const r of reconstructedHistory) {
    const chunk = r.chunks.find((c) => c.name === name);
    if (chunk) {
      const lineage: ArchivedChunkLineage = { parent: r.baseName, ...r };
      return {
        name: chunk.name,
        size: chunk.size,
        status: "Archived Chunk Segment",
        isChunk: true,
        reconstructed: false,
        lineage,
      };
    }
  }

  return null;
}
