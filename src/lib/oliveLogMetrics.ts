/** Metrics parsed from Olive stdout/stderr — only surfaced when patterns match real output. */

export interface OliveRunMetrics {
  latency: string;
  throughput: string;
  memory: string;
  compression: string;
}

export function parseOliveMetricsFromLogs(logs: string[]): OliveRunMetrics | undefined {
  const found: Partial<OliveRunMetrics> = {};

  for (const line of logs) {
    const latencyMatch = line.match(/latency[:\s]+([0-9.]+\s*ms)/i);
    if (latencyMatch) found.latency = latencyMatch[1];

    const throughputMatch = line.match(/throughput[:\s]+([0-9.]+\s*(?:tok\/s|req\/s|it\/s|samples\/s))/i);
    if (throughputMatch) found.throughput = throughputMatch[1];

    const memoryMatch = line.match(/(?:memory|vram|footprint)[:\s]+([0-9.]+\s*(?:MB|GB|MiB|GiB))/i);
    if (memoryMatch) found.memory = memoryMatch[1];

    const compressionMatch = line.match(/compression[:\s]+([0-9.]+[x%])/i);
    if (compressionMatch) found.compression = compressionMatch[1];
  }

  if (!found.latency && !found.throughput && !found.memory && !found.compression) {
    return undefined;
  }

  return {
    latency: found.latency ?? "—",
    throughput: found.throughput ?? "—",
    memory: found.memory ?? "—",
    compression: found.compression ?? "—",
  };
}
