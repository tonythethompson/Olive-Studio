/**
 * Route-level coverage for GET /api/olive/stream/:jobId named SSE events:
 * replay of buffered log/metrics/done, live metric forwarding, immediate
 * terminal closure, and subscriber cleanup on client disconnect.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import type { Server } from "http";
import type { OliveJob } from "../types.ts";
import type { GpuMetrics } from "../../lib/gpuMetrics.ts";
import { pushGpuMetrics, pushLog } from "../services/olive/gpu.ts";
import { finalizeJob, jobRegistry } from "../services/olive/state.ts";

// Keep agent-access policy mutations out of the real `.olive-studio/config.json`.
vi.mock("../config.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config.ts")>();
  let cfg: Record<string, unknown> = {};
  return {
    ...actual,
    readStudioConfig: () => ({ ...cfg }),
    writeStudioConfig: (patch: Record<string, unknown>) => {
      cfg = { ...cfg, ...patch };
      return cfg;
    },
  };
});

import { writeStudioConfig } from "../config.ts";

const { mountOliveRoutes } = await import("./olive.ts");

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  mountOliveRoutes(router);
  app.use("/api", router);
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") return reject(new Error("no port"));
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
    server.on("error", reject);
  });
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  jobRegistry.clear();
  writeStudioConfig({ agentAccess: {} });
  delete process.env.OLIVE_MCP_ALLOW_JOBS;
  delete process.env.OLIVE_MCP_ALLOW_JOB_INSPECTION;
  delete process.env.OLIVE_MCP_ACCESS;
});

afterEach(() => {
  writeStudioConfig({ agentAccess: {} });
  delete process.env.OLIVE_MCP_ALLOW_JOBS;
  delete process.env.OLIVE_MCP_ALLOW_JOB_INSPECTION;
  delete process.env.OLIVE_MCP_ACCESS;
});

describe("GET /api/olive/jobs", () => {
  it("lists jobs newest-first with safe summary fields", async () => {
    seedJob({ id: "old", status: "completed", exitCode: 0, finishedAt: 1 });
    seedJob({ id: "new", status: "running", exitCode: null });
    const res = await fetch(`${baseUrl}/api/olive/jobs`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      count: number;
      jobs: Array<{ id: string; status: string; logCount: number }>;
    };
    expect(body.ok).toBe(true);
    expect(body.count).toBe(2);
    expect(body.jobs.map((j) => j.id)).toEqual(["new", "old"]);
    expect(body.jobs[0]).toMatchObject({ id: "new", status: "running" });
    expect(typeof body.jobs[0].logCount).toBe("number");
  });

  it("returns empty list when registry is empty", async () => {
    const res = await fetch(`${baseUrl}/api/olive/jobs`);
    const body = (await res.json()) as { ok: boolean; count: number; jobs: unknown[] };
    expect(body).toEqual({ ok: true, count: 0, jobs: [] });
  });

  it("returns 403 when job inspection is disabled", async () => {
    writeStudioConfig({ agentAccess: { allowJobInspection: false } });
    seedJob({ id: "hidden", status: "running", exitCode: null });
    const res = await fetch(`${baseUrl}/api/olive/jobs`);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { ok: boolean; error: string; reason: string; policy?: unknown };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("forbidden");
    expect(body.policy).toBeUndefined();
  });
});

describe("GET /api/olive/status/:jobId finishedAt", () => {
  it("includes finishedAt on status payload", async () => {
    seedJob({ id: "done-1", status: "completed", exitCode: 0, finishedAt: 99 });
    const res = await fetch(`${baseUrl}/api/olive/status/done-1`, {
      headers: { "Sec-Fetch-Site": "same-origin" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; finishedAt: number | null };
    expect(body.id).toBe("done-1");
    expect(body.finishedAt).toBe(99);
  });

  it("applies inspection policy to non-UI clients even without MCP header", async () => {
    writeStudioConfig({ agentAccess: { allowJobInspection: false } });
    seedJob({ id: "secret", status: "running", exitCode: null });
    const agentish = await fetch(`${baseUrl}/api/olive/status/secret`);
    expect(agentish.status).toBe(403);
    const ui = await fetch(`${baseUrl}/api/olive/status/secret`, {
      headers: { "Sec-Fetch-Site": "same-origin" },
    });
    expect(ui.status).toBe(200);
  });
});

function sampleMetrics(label = "A100"): GpuMetrics {
  return {
    timestamp: new Date().toISOString(),
    gpus: [
      {
        index: 0,
        name: label,
        utilizationPct: 42,
        memUsedMb: 1024,
        memTotalMb: 40960,
        tempC: 55,
        powerW: 120,
      },
    ],
  };
}

function seedJob(partial: Partial<OliveJob> & Pick<OliveJob, "id" | "status">): OliveJob {
  const job: OliveJob = {
    id: partial.id,
    status: partial.status,
    exitCode: partial.exitCode ?? null,
    logs: partial.logs ?? [],
    subscribers: [],
    metricSubscribers: [],
    process: null,
    latestMetrics: partial.latestMetrics ?? null,
    metricsTimer: null,
    sampling: false,
    tempRecipePath: null,
    finishedAt: partial.finishedAt ?? null,
    doneSubscribers: [],
  };
  jobRegistry.set(job.id, job);
  return job;
}

type SseEvent = { event: string; data: string };

async function readSseEvents(
  url: string,
  opts: {
    stopWhen?: (events: SseEvent[]) => boolean;
    signal?: AbortSignal;
    idleMs?: number;
  } = {},
): Promise<SseEvent[]> {
  const res = await fetch(url, {
    signal: opts.signal,
    headers: { Accept: "text/event-stream", "Sec-Fetch-Site": "same-origin" },
  });
  if (!res.ok || !res.body) {
    throw new Error(`SSE HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: SseEvent[] = [];
  let currentEvent = "message";
  let dataLines: string[] = [];

  const flush = () => {
    if (dataLines.length === 0) {
      currentEvent = "message";
      return;
    }
    events.push({ event: currentEvent, data: dataLines.join("\n") });
    currentEvent = "message";
    dataLines = [];
  };

  const deadline = Date.now() + (opts.idleMs ?? 3000);
  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("event:")) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      } else if (line === "") {
        flush();
        if (opts.stopWhen?.(events)) {
          await reader.cancel().catch(() => undefined);
          return events;
        }
      }
    }
  }
  flush();
  await reader.cancel().catch(() => undefined);
  return events;
}

describe("GET /api/olive/stream/:jobId", () => {
  it("replays buffered log, metrics, and done for a terminal job then closes", async () => {
    const metrics = sampleMetrics("replay");
    seedJob({
      id: "job-terminal",
      status: "completed",
      exitCode: 0,
      logs: ["setup ok", "pass done"],
      latestMetrics: metrics,
      finishedAt: Date.now(),
    });

    const events = await readSseEvents(`${baseUrl}/api/olive/stream/job-terminal`, {
      stopWhen: (ev) => ev.some((e) => e.event === "done"),
    });

    const logs = events.filter((e) => e.event === "log").map((e) => JSON.parse(e.data) as { line: string });
    expect(logs.map((l) => l.line)).toEqual(["setup ok", "pass done"]);

    const metricEv = events.find((e) => e.event === "metrics");
    expect(metricEv).toBeDefined();
    expect(JSON.parse(metricEv!.data)).toMatchObject({ gpus: [{ name: "replay" }] });

    const doneEv = events.find((e) => e.event === "done");
    expect(doneEv).toBeDefined();
    expect(JSON.parse(doneEv!.data)).toMatchObject({
      done: true,
      status: "completed",
      exitCode: 0,
    });
  });

  it("announces trimmed history before replaying truncated logs", async () => {
    const job = seedJob({
      id: "job-truncated",
      status: "completed",
      exitCode: 0,
      logs: ["tail line"],
      finishedAt: Date.now(),
    });
    job.logsTruncated = true;

    const events = await readSseEvents(`${baseUrl}/api/olive/stream/job-truncated`, {
      stopWhen: (ev) => ev.some((e) => e.event === "done"),
    });

    const logs = events.filter((e) => e.event === "log").map((e) => JSON.parse(e.data) as { line: string });
    expect(logs[0].line).toMatch(/Earlier log lines were trimmed/);
    expect(logs.map((l) => l.line)).toEqual([logs[0].line, "tail line"]);
  });

  it("forwards live metrics to an open subscriber", async () => {
    const job = seedJob({ id: "job-live-metrics", status: "running" });

    const streamPromise = readSseEvents(`${baseUrl}/api/olive/stream/job-live-metrics`, {
      stopWhen: (ev) => ev.some((e) => e.event === "metrics"),
      idleMs: 4000,
    });

    // Wait until the route registers its metric subscriber.
    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (job.metricSubscribers.length > 0) return resolve();
        if (Date.now() - start > 2000) return reject(new Error("subscriber not registered"));
        setTimeout(tick, 5);
      };
      tick();
    });

    pushGpuMetrics(job, sampleMetrics("live"));
    const events = await streamPromise;
    const metricEv = events.find((e) => e.event === "metrics");
    expect(metricEv).toBeDefined();
    expect(JSON.parse(metricEv!.data)).toMatchObject({ gpus: [{ name: "live" }] });
  });

  it("emits done immediately when finalizeJob runs on a live stream", async () => {
    const job = seedJob({ id: "job-live-done", status: "running" });

    const streamPromise = readSseEvents(`${baseUrl}/api/olive/stream/job-live-done`, {
      stopWhen: (ev) => ev.some((e) => e.event === "done"),
      idleMs: 4000,
    });

    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (job.doneSubscribers.length > 0) return resolve();
        if (Date.now() - start > 2000) return reject(new Error("done subscriber not registered"));
        setTimeout(tick, 5);
      };
      tick();
    });

    pushLog(job, "almost done");
    job.status = "cancelled";
    job.exitCode = null;
    finalizeJob(job);

    const events = await streamPromise;
    expect(events.some((e) => e.event === "log" && e.data.includes("almost done"))).toBe(true);
    const doneEv = events.find((e) => e.event === "done");
    expect(doneEv).toBeDefined();
    expect(JSON.parse(doneEv!.data)).toMatchObject({
      done: true,
      status: "cancelled",
      exitCode: null,
    });
  });

  it("removes log/metric/done subscribers when the client disconnects", async () => {
    const job = seedJob({ id: "job-disconnect", status: "running" });
    const controller = new AbortController();

    const streamPromise = readSseEvents(`${baseUrl}/api/olive/stream/job-disconnect`, {
      signal: controller.signal,
      idleMs: 5000,
    });

    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (
          job.subscribers.length > 0 &&
          job.metricSubscribers.length > 0 &&
          job.doneSubscribers.length > 0
        ) {
          return resolve();
        }
        if (Date.now() - start > 2000) return reject(new Error("subscribers not registered"));
        setTimeout(tick, 5);
      };
      tick();
    });

    controller.abort();
    await streamPromise.catch(() => undefined);

    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (
          job.subscribers.length === 0 &&
          job.metricSubscribers.length === 0 &&
          job.doneSubscribers.length === 0
        ) {
          return resolve();
        }
        if (Date.now() - start > 2000) {
          return reject(
            new Error(
              `cleanup incomplete: sub=${job.subscribers.length} metric=${job.metricSubscribers.length} done=${job.doneSubscribers.length}`,
            ),
          );
        }
        setTimeout(tick, 5);
      };
      tick();
    });
  });
});
