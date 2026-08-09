/**
 * Utility functions for local file upload, chunk detection, and display.
 * Extracted from InputEnvironmentPanel to reduce complexity.
 */

/** Identify chunked files (e.g. model.bin.001, model.bin.002). Returns base name or null. */
export function getBaseName(filename: string): string | null {
  const match = filename.match(/^(.*)\.(\d{3,})$/);
  return match ? match[1] : null;
}

/** Format a byte count into a human-readable string. */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/** Returns a human-readable format label for a model file by extension. */
export function getFileFormatLabel(name: string): string {
  const chunkMatch = name.match(/\.(\d{3,})$/);
  if (chunkMatch) return "Olive Binary Chunk Segment";
  if (name.endsWith(".pt") || name.endsWith(".pth")) return "PyTorch State Dict (Checkpoint)";
  if (name.endsWith(".bin")) return "PyTorch Binary Weights";
  if (name.endsWith(".safetensors")) return "HF Safetensors Weight Map";
  if (name.endsWith(".onnx")) return "ONNX Runtime Optimized Model";
  if (name.endsWith(".xml")) return "OpenVINO Intermediate Representation (XML)";
  if (name.endsWith(".json")) return "Model Hyperparameters Config (JSON)";
  return "Generalized Model Binary Blob";
}

/** Returns a longer description for a model file format. */
export function getFileDescription(name: string): string {
  const fmt = getFileFormatLabel(name);
  if (fmt.includes("PyTorch State Dict")) {
    return "Contains floating point model weight tensors indexed by layer names. Raw parameters from trainer output.";
  }
  if (fmt.includes("Weights")) {
    return "CJS-compliant weight array buffer suitable for multi-threaded direct binary loads.";
  }
  if (fmt.includes("Safetensors")) {
    return "Secure, zero-copy, memory-mapped key-value header model format safely omitting executable Python pickles.";
  }
  if (fmt.includes("ONNX")) {
    return "Optimized platform-independent dataflow graph representing operations and layer nodes in the ONNX spec.";
  }
  if (fmt.includes("Config")) {
    return "Hyperparameters config mapping architecture layers, vocabulary size, attention heads, type tokens, and weights formats.";
  }
  if (fmt.includes("Chunk Segment")) {
    return "Byte-exact partition of a large-scale weight file segmented for robust transfers and parallel cache assemblies.";
  }
  return "Standard model compilation asset. Subject to parsing, quantization, and layer alignment workflows.";
}

/** Generate simulated tensor metadata for display purposes. */
export function getSimulatedTensors(
  name: string,
  size: number,
  getDisplayHash: (name: string) => string | null,
): Array<{ key: string; val: string }> {
  const isChunk = name.match(/\.(\d{3,})$/) !== null;
  if (isChunk) {
    return [
      { key: "partition_id", val: name.split(".").pop() || "001" },
      { key: "compression", val: "None (Raw Bytes)" },
      { key: "memory_footprint", val: `${(size / (1024 * 1024)).toFixed(1)} MB` },
      { key: "segment_checksum", val: getDisplayHash(name) ? "SHA-256 verified" : "Not hashed" },
    ];
  }
  if (name.endsWith(".json")) {
    return [
      { key: "vocab_size", val: "32,000 token embeddings" },
      { key: "hidden_size", val: "4096 dimensions" },
      { key: "num_attention_heads", val: "32 heads" },
      { key: "num_hidden_layers", val: "32 layer blocks" },
      { key: "model_architecture", val: "llama" },
    ];
  }
  // Standard weight files
  const baseTensorsCount = Math.floor((size / 10000000) % 200) + 50;
  return [
    { key: "total_parameters", val: `${(size / 400000000).toFixed(2)}B parameters (est)` },
    { key: "weight_dtype", val: size > 2500000000 ? "Float32 (32-bit float)" : "Float16 (16-bit float)" },
    { key: "registered_tensors", val: `${baseTensorsCount} unique tensors` },
    { key: "tensor_index_status", val: "Ready (Fully mapped)" },
  ];
}

/** Group files by base name and return only groups that have chunks for reconstruction. */
export function getReconstructableGroups(
  localFiles: { name: string; size: number }[],
): [string, { name: string; size: number }[]][] {
  const groups: Record<string, { name: string; size: number }[]> = {};
  for (const f of localFiles) {
    const base = getBaseName(f.name);
    if (base) {
      if (!groups[base]) groups[base] = [];
      groups[base].push(f);
    }
  }
  return Object.entries(groups).filter(([, files]) => {
    if (files.length < 2) return false;
    // Require consecutive numeric suffixes to prevent corrupted reconstruction
    const indices = files
      .map((f) => {
        const m = f.name.match(/\.(\d{3,})$/);
        return m ? parseInt(m[1], 10) : -1;
      })
      .filter((n) => n >= 0)
      .sort((a, b) => a - b);
    if (indices.length < 2) return false;
    for (let i = 1; i < indices.length; i++) {
      if (indices[i] !== indices[i - 1] + 1) return false;
    }
    return true;
  });
}
