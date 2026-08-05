import { describe, expect, it } from "vitest";
import { MAX_JOB_LOG_LINES, pushLog } from "./gpu.ts";
import type { OliveJob } from "../../types.ts";

function makeJob(): OliveJob {
  return {
    id: "log-test",
    status: "running",
    exitCode: null,
    logs: [],
    subscribers: [],
    metricSubscribers: [],
    process: null,
    latestMetrics: null,
    metricsTimer: null,
    sampling: false,
    tempRecipePath: null,
    finishedAt: null,
    doneSubscribers: [],
  };
}

describe("pushLog", () => {
  it("records lines and notifies subscribers below the cap", () => {
    const job = makeJob();
    const seen: string[] = [];
    job.subscribers.push((line) => seen.push(line));

    pushLog(job, "a");
    pushLog(job, "b");

    expect(job.logs).toEqual(["a", "b"]);
    expect(seen).toEqual(["a", "b"]);
    expect(job.logsTruncated).toBeUndefined();
  });

  it("trims old lines (keeping the newest) once past the watermark", () => {
    const job = makeJob();
    const seen: string[] = [];
    job.subscribers.push((line) => seen.push(line));
    const total = MAX_JOB_LOG_LINES + 300; // past the +250 trim watermark

    for (let i = 0; i < total; i++) pushLog(job, `line-${i}`);

    // Bounded between the cap and the watermark, newest lines retained.
    expect(job.logs.length).toBeGreaterThanOrEqual(MAX_JOB_LOG_LINES);
    expect(job.logs.length).toBeLessThanOrEqual(MAX_JOB_LOG_LINES + 250);
    expect(job.logs[0]).toBe(`line-${total - job.logs.length}`);
    expect(job.logs.at(-1)).toBe(`line-${total - 1}`);
    expect(job.logsTruncated).toBe(true);
    // Live subscribers still receive every line even after trimming.
    expect(seen).toHaveLength(total);
  });
});
