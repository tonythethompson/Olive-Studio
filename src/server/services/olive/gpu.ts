import type { GpuMetrics } from "../../../lib/gpuMetrics.ts";
import type { OliveJob } from "../../types.ts";
import { execFileAsync } from "../shared/exec.ts";

/**
 * Retained log lines per job. Long Olive runs can emit thousands of lines;
 * unbounded growth wastes memory and the SSE replay floods reconnects.
 */
export const MAX_JOB_LOG_LINES = 1_000;
/** Trim watermark — batched splices instead of one per line at capacity. */
const LOG_TRIM_WATERMARK = MAX_JOB_LOG_LINES + 250;

/** Records a job log line and notifies its active subscribers. */
export function pushLog(job: OliveJob, line: string): void {
  job.logs.push(line);
  if (job.logs.length > LOG_TRIM_WATERMARK) {
    job.logs.splice(0, job.logs.length - MAX_JOB_LOG_LINES);
    job.logsTruncated = true;
  }
  for (const sub of job.subscribers) {
    try {
      sub(line);
    } catch {
      /* subscriber gone */
    }
  }
}

/** Stores the latest GPU metrics and broadcasts them to subscribed listeners. */
export function pushGpuMetrics(job: OliveJob, metrics: GpuMetrics): void {
  job.latestMetrics = metrics;
  for (const sub of job.metricSubscribers) {
    try {
      sub(metrics);
    } catch {
      /* subscriber gone */
    }
  }
}

/** Collects current metrics for available NVIDIA GPUs. */
export async function sampleGpuMetrics(): Promise<GpuMetrics | null> {
  try {
    const { stdout } = await execFileAsync(
      "nvidia-smi",
      [
        "--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw",
        "--format=csv,noheader,nounits",
      ],
      { timeout: 10_000 },
    );
    const lines = stdout.trim().split("\n").filter(Boolean);
    if (lines.length === 0) return null;
    const gpus = lines.map((line) => {
      const parts = line.split(",").map((s) => s.trim());
      const parseNum = (v: string | undefined): number | null => {
        if (!v || v === "[N/A]") return null;
        const n = parseFloat(v);
        return isNaN(n) ? null : n;
      };
      return {
        index: parseInt(parts[0] ?? "0", 10),
        name: parts[1] ?? "Unknown GPU",
        utilizationPct: parseNum(parts[2]),
        memUsedMb: parseNum(parts[3]),
        memTotalMb: parseNum(parts[4]),
        tempC: parseNum(parts[5]),
        powerW: parseNum(parts[6]),
      };
    });
    return { timestamp: new Date().toISOString(), gpus };
  } catch {
    return null;
  }
}

/** Start periodic GPU metrics sampling for a job. */
export function startGpuMetricsTimer(job: OliveJob): void {
  if (job.metricsTimer) return;
  const sample = async () => {
    if (job.status !== "running") {
      stopGpuMetricsTimer(job);
      return;
    }
    if (job.sampling) return;
    job.sampling = true;
    try {
      const metrics = await sampleGpuMetrics();
      if (metrics) pushGpuMetrics(job, metrics);
    } finally {
      job.sampling = false;
    }
  };
  void sample();
  job.metricsTimer = setInterval(() => void sample(), 3000);
}

/** Stop GPU metrics sampling for a job. */
export function stopGpuMetricsTimer(job: OliveJob): void {
  if (job.metricsTimer) {
    clearInterval(job.metricsTimer);
    job.metricsTimer = null;
  }
}
