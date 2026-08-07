import { useState, useRef, useCallback, useEffect, type Dispatch, type SetStateAction } from "react";
import { type UIState } from "@/types";
import { buildRecipeFromState, buildRecipeJsonFromState } from "@/lib/recipePipeline";
import { saveJobHistory } from "@/lib/jobHistoryStore";
import { parseGpuMetrics, type GpuMetrics } from "@/lib/gpuMetrics";
import { logsIndicateFailure } from "@/lib/logFailurePatterns";
import type { HardwareProbeResult } from "@/lib/hardwareProbe";

interface UseOliveStreamOptions {
  state: UIState;
  hardwareProbe: HardwareProbeResult | null;
  setState: (s: Partial<UIState>) => void;
  onRunStateChange?: (running: boolean) => void;
  isUnmountedRef: React.MutableRefObject<boolean>;
  setMcpFixApplied: (value: string) => void;
}

export interface UseOliveStreamReturn {
  liveJobId: string | null;
  isRunning: boolean;
  executionLogs: string[];
  setExecutionLogs: Dispatch<SetStateAction<string[]>>;
  executionLogsRef: React.MutableRefObject<string[]>;
  executionStatus: "idle" | "running" | "completed" | "failed" | "cancelled";
  executionExitCode: number | null;
  gpuMetrics: GpuMetrics | null;
  handleExecuteLive: () => Promise<void>;
  handleCancelJob: () => Promise<void>;
}

type TerminalStatus = "completed" | "failed" | "cancelled";

/**
 * Manages Olive job execution, cancellation, event-stream updates, and completion history.
 *
 * @param state - Current Olive configuration used to build and record job recipes.
 * @param hardwareProbe - Hardware information used during recipe construction and validation.
 * @param setState - Updates the shared Olive configuration with the active job ID.
 * @param onRunStateChange - Called when job execution starts or stops.
 * @param isUnmountedRef - Indicates whether the owning component has unmounted.
 * @param setMcpFixApplied - Clears applied MCP fixes when execution fails.
 * @returns Current job state, execution logs, GPU metrics, and job execution controls.
 */
export function useOliveStream({
  state,
  hardwareProbe,
  setState,
  onRunStateChange,
  isUnmountedRef,
  setMcpFixApplied,
}: UseOliveStreamOptions): UseOliveStreamReturn {
  const [liveJobId, setLiveJobId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [executionLogs, setExecutionLogsState] = useState<string[]>([]);
  const executionLogsRef = useRef<string[]>([]);
  const setExecutionLogs: Dispatch<SetStateAction<string[]>> = useCallback((update) => {
    setExecutionLogsState((prev) => (typeof update === "function" ? update(prev) : update));
  }, []);
  useEffect(() => {
    executionLogsRef.current = executionLogs;
  }, [executionLogs]);
  const [executionStatus, setExecutionStatus] = useState<
    "idle" | "running" | "completed" | "failed" | "cancelled"
  >("idle");
  const [executionExitCode, setExecutionExitCode] = useState<number | null>(null);
  const [gpuMetrics, setGpuMetrics] = useState<GpuMetrics | null>(null);
  const liveSourceRef = useRef<EventSource | null>(null);
  const runStartTimeRef = useRef<number | null>(null);
  const runRecipeJsonRef = useRef<string | null>(null);
  const pendingCancelRef = useRef(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const runGenerationRef = useRef(0);
  const runAbortRef = useRef<AbortController | null>(null);
  const statusAbortRef = useRef<AbortController | null>(null);

  const beginNewRunEpoch = useCallback(() => {
    runGenerationRef.current += 1;
    runAbortRef.current?.abort();
    runAbortRef.current = null;
    statusAbortRef.current?.abort();
    statusAbortRef.current = null;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    liveSourceRef.current?.close();
    liveSourceRef.current = null;
    return runGenerationRef.current;
  }, []);

  const isCurrentRun = useCallback(
    (generation: number) =>
      !isUnmountedRef.current && generation === runGenerationRef.current,
    [isUnmountedRef],
  );

  useEffect(() => {
    return () => {
      beginNewRunEpoch();
    };
  }, [beginNewRunEpoch]);

  const recordJobCompletion = useCallback(
    (jobId: string, status: TerminalStatus, exitCode: number | null) => {
      if (isUnmountedRef.current) return;
      const duration = runStartTimeRef.current ? Date.now() - runStartTimeRef.current : 0;
      const activePassesNames: string[] = [];
      if (state.passes.conversion)
        activePassesNames.push(
          `Conversion (${state.passes.conversionFormat === "onnx" ? "ONNX" : "OpenVINO"})`,
        );
      if (state.passes.quantization) activePassesNames.push(`Quantization (${state.passes.quantPrecision})`);
      if (state.passes.pruning) activePassesNames.push(`Pruning (${state.passes.pruningMethod})`);
      if (state.passes.onnxTransforms) activePassesNames.push("ORT Transforms");
      if (activePassesNames.length === 0) activePassesNames.push("Default Baseline Export");

      saveJobHistory({
        id: jobId,
        jobId,
        timestamp: new Date().toISOString(),
        modelId: state.hfModelId || (state.localFiles && state.localFiles[0]?.name) || "Custom Model",
        ihvProvider: state.ihvProvider,
        memoryOffload: state.memoryOffload,
        status,
        exitCode,
        durationMs: duration,
        passCount: activePassesNames.length,
        passNames: activePassesNames,
        recipeJson: runRecipeJsonRef.current ?? buildRecipeJsonFromState(state),
      });
    },
    [state, isUnmountedRef],
  );

  const finalizeExecution = useCallback(
    (
      generation: number,
      args: {
        jobId: string | null;
        status: TerminalStatus;
        exitCode?: number | null;
        /** When false, trust the provided status without log/exit heuristics. */
        applyOutcomeHeuristics?: boolean;
      },
    ) => {
      if (!isCurrentRun(generation)) return;

      let finalStatus = args.status;
      let exitCode = args.exitCode ?? null;
      const applyHeuristics = args.applyOutcomeHeuristics !== false;

      if (applyHeuristics && finalStatus !== "cancelled") {
        if (exitCode === null) {
          finalStatus = "failed";
        } else {
          const failed = exitCode !== 0 || logsIndicateFailure(executionLogsRef.current);
          finalStatus = failed ? "failed" : "completed";
        }
      }

      const reportedExit =
        finalStatus === "cancelled"
          ? exitCode !== null && exitCode !== 0
            ? exitCode
            : null
          : exitCode === null || (finalStatus === "failed" && exitCode === 0)
            ? 1
            : exitCode;

      setExecutionStatus(finalStatus);
      setExecutionExitCode(reportedExit);
      setIsRunning(false);
      setGpuMetrics(null);
      onRunStateChange?.(false);
      if (args.jobId) {
        recordJobCompletion(args.jobId, finalStatus, reportedExit);
      }
      if (finalStatus === "failed") setMcpFixApplied("");
    },
    [isCurrentRun, onRunStateChange, recordJobCompletion, setMcpFixApplied],
  );

  const handleCancelJob = useCallback(async () => {
    if (!liveJobId) {
      pendingCancelRef.current = true;
      setExecutionLogs((prev) => [
        ...prev,
        "[INFO] Cancel queued — will send as soon as the job id is assigned...",
      ]);
      return;
    }
    const jobId = liveJobId;
    try {
      setExecutionLogs((prev) => [...prev, "[INFO] Requesting process cancellation..."]);
      const resp = await fetch("/api/olive/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      const data = (await resp.json().catch(() => ({}))) as { status?: string; error?: string };
      if (resp.ok && data.status === "cancelled") {
        setExecutionLogs((prev) => [...prev, "[INFO] Cancellation signal confirmed by server."]);
        const generation = beginNewRunEpoch();
        finalizeExecution(generation, {
          jobId,
          status: "cancelled",
          exitCode: null,
          applyOutcomeHeuristics: false,
        });
      } else if (resp.ok) {
        setExecutionLogs((prev) => [
          ...prev,
          `[INFO] Job already ${data.status ?? "finished"}; waiting for stream status.`,
        ]);
      } else {
        setExecutionLogs((prev) => [...prev, `[ERROR] Cancel failed: ${data.error ?? "unknown"}`]);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setExecutionLogs((prev) => [...prev, `[ERROR] Failed to send cancel signal: ${message}`]);
    }
  }, [liveJobId, setExecutionLogs, beginNewRunEpoch, finalizeExecution]);

  const handleExecuteLive = useCallback(async () => {
    if (isRunning) return;

    const fresh = buildRecipeFromState(state, { hardwareProbe });

    if (!fresh.isRunnable) {
      const blockingCount = fresh.validation.criticalCount + fresh.localExecutionIssues.length;
      const freshSchemaErrors = fresh.schema.errors ?? [];
      const freshBlockLines = fresh.localExecutionIssues.map(
        (issue) => `[BLOCK] ${issue.title}: ${issue.description}`,
      );
      const generation = beginNewRunEpoch();
      setExecutionLogs([
        fresh.schema.valid
          ? `[ERROR] Cannot execute: ${blockingCount} blocking issue(s).`
          : `[ERROR] Cannot execute: recipe schema invalid.`,
        ...(fresh.schema.valid
          ? [
              ...fresh.validation.issues
                .filter((issue) => issue.severity === "critical")
                .map((issue) => `[BLOCK] ${issue.title}: ${issue.description}`),
              ...freshBlockLines,
            ]
          : freshSchemaErrors.map((e) => `[SCHEMA] ${e}`)),
      ]);
      finalizeExecution(generation, {
        jobId: null,
        status: "failed",
        exitCode: null,
        applyOutcomeHeuristics: false,
      });
      return;
    }

    const generation = beginNewRunEpoch();
    const runAbort = new AbortController();
    runAbortRef.current = runAbort;

    runRecipeJsonRef.current = fresh.recipeJson;
    pendingCancelRef.current = false;
    setLiveJobId(null);
    setState({ activeJobId: null });
    setIsRunning(true);
    onRunStateChange?.(true);
    setExecutionLogs(["[INFO] Initiating Olive run...\n"]);
    setExecutionStatus("running");
    setExecutionExitCode(null);
    setGpuMetrics(null);
    runStartTimeRef.current = Date.now();

    try {
      const resp = await fetch("/api/olive/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipeJson: fresh.recipeJson, cudaVersion: state.cudaVersion ?? "auto" }),
        signal: runAbort.signal,
      });

      if (!isCurrentRun(generation)) return;

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
        if (!isCurrentRun(generation)) return;
        setExecutionLogs((prev) => [...prev, `[ERROR] ${errData.error}`]);
        pendingCancelRef.current = false;
        finalizeExecution(generation, {
          jobId: null,
          status: "failed",
          exitCode: null,
          applyOutcomeHeuristics: false,
        });
        return;
      }

      const { jobId } = (await resp.json()) as { jobId: string };
      if (!isCurrentRun(generation)) return;

      setLiveJobId(jobId);
      setState({ activeJobId: jobId });

      if (pendingCancelRef.current) {
        pendingCancelRef.current = false;
        setExecutionLogs((prev) => [
          ...prev,
          "[INFO] Applying queued cancel now that the job id is assigned...",
        ]);
        try {
          const cancelResp = await fetch("/api/olive/cancel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobId }),
            signal: runAbort.signal,
          });
          if (!isCurrentRun(generation)) return;
          const cancelData = (await cancelResp.json().catch(() => ({}))) as {
            status?: string;
            error?: string;
          };
          if (!isCurrentRun(generation)) return;
          if (cancelResp.ok && cancelData.status === "cancelled") {
            setExecutionLogs((prev) => [...prev, "[INFO] Cancellation signal confirmed by server."]);
            finalizeExecution(generation, {
              jobId,
              status: "cancelled",
              exitCode: null,
              applyOutcomeHeuristics: false,
            });
            return;
          }
          setExecutionLogs((prev) => [
            ...prev,
            cancelResp.ok
              ? `[INFO] Queued cancel found job already ${cancelData.status ?? "finished"}. Connecting stream.`
              : `[ERROR] Queued cancel failed: ${cancelData.error ?? "unknown"}. Continuing with stream.`,
          ]);
        } catch (err: unknown) {
          if (!isCurrentRun(generation)) return;
          if (err instanceof DOMException && err.name === "AbortError") return;
          const message = err instanceof Error ? err.message : String(err);
          setExecutionLogs((prev) => [
            ...prev,
            `[ERROR] Queued cancel failed: ${message}. Continuing with stream.`,
          ]);
        }
      }

      if (!isCurrentRun(generation)) return;

      let reconnectAttempts = 0;
      const MAX_RECONNECT_ATTEMPTS = 10;
      const MAX_BACKOFF_MS = 30000;
      const connectSSE = (targetJobId: string) => {
        if (!isCurrentRun(generation)) return;
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
        liveSourceRef.current?.close();

        const evtSource = new EventSource(`/api/olive/stream/${targetJobId}`);
        liveSourceRef.current = evtSource;

        evtSource.onopen = () => {
          if (!isCurrentRun(generation)) return;
          if (reconnectAttempts > 0) {
            setExecutionLogs((prev) => [...prev, "[INFO] Stream reconnected successfully."]);
          }
          reconnectAttempts = 0;
        };

        evtSource.addEventListener("log", (e: MessageEvent) => {
          if (!isCurrentRun(generation)) return;
          try {
            const payload = JSON.parse(String(e.data)) as { line?: unknown };
            if (typeof payload.line === "string" && payload.line.length > 0) {
              const line = payload.line;
              setExecutionLogs((prev) => [...prev, line]);
            }
          } catch {
            /* ignore malformed */
          }
        });

        evtSource.addEventListener("metrics", (e: MessageEvent) => {
          if (!isCurrentRun(generation)) return;
          try {
            const parsed: unknown = JSON.parse(e.data);
            const metrics = parseGpuMetrics(parsed);
            if (metrics) setGpuMetrics(metrics);
          } catch {
            /* ignore malformed */
          }
        });

        evtSource.addEventListener("done", (e: MessageEvent) => {
          if (!isCurrentRun(generation)) return;
          let exitCode: number | null = null;
          let serverStatus: string | undefined;
          try {
            const payload = JSON.parse(e.data) as { exitCode?: number | null; status?: string };
            exitCode = typeof payload.exitCode === "number" ? payload.exitCode : null;
            serverStatus = payload.status;
          } catch {
            exitCode = null;
          }
          const status: TerminalStatus =
            serverStatus === "cancelled" ? "cancelled" : exitCode === null ? "failed" : "completed";
          finalizeExecution(generation, {
            jobId: targetJobId,
            status,
            exitCode,
            applyOutcomeHeuristics: status !== "cancelled",
          });
          evtSource.close();
          if (liveSourceRef.current === evtSource) {
            liveSourceRef.current = null;
          }
        });

        evtSource.onerror = async () => {
          evtSource.close();
          if (liveSourceRef.current === evtSource) {
            liveSourceRef.current = null;
          }
          if (!isCurrentRun(generation)) return;

          let serverSaysRunning = false;
          try {
            statusAbortRef.current?.abort();
            const statusAbort = new AbortController();
            statusAbortRef.current = statusAbort;
            const statusResp = await fetch(`/api/olive/status/${targetJobId}`, {
              signal: statusAbort.signal,
            });
            if (!isCurrentRun(generation)) return;
            if (statusResp.ok) {
              const statusData = await statusResp.json();
              if (!isCurrentRun(generation)) return;
              if (
                statusData.status === "completed" ||
                statusData.status === "failed" ||
                statusData.status === "cancelled"
              ) {
                const finalStatus: TerminalStatus =
                  statusData.status === "completed"
                    ? "completed"
                    : statusData.status === "cancelled"
                      ? "cancelled"
                      : "failed";
                finalizeExecution(generation, {
                  jobId: targetJobId,
                  status: finalStatus,
                  exitCode:
                    typeof statusData.exitCode === "number"
                      ? statusData.exitCode
                      : finalStatus === "completed"
                        ? 0
                        : 1,
                  applyOutcomeHeuristics: finalStatus !== "cancelled",
                });
                return;
              } else if (statusData.status === "running" || statusData.status === "setting_up") {
                serverSaysRunning = true;
              }
            }
          } catch (err: unknown) {
            if (err instanceof DOMException && err.name === "AbortError") return;
            /* ignore status check failure */
          }

          if (!isCurrentRun(generation)) return;

          if (serverSaysRunning || reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            const backoffMs = Math.min(1000 * Math.pow(1.5, reconnectAttempts), MAX_BACKOFF_MS);
            setExecutionLogs((prev) => [
              ...prev,
              `[WARN] Stream connection lost. Reconnecting (attempt ${reconnectAttempts}${serverSaysRunning ? "" : `/${MAX_RECONNECT_ATTEMPTS}`} in ${(backoffMs / 1000).toFixed(1)}s)...`,
            ]);

            if (reconnectTimeoutRef.current) {
              clearTimeout(reconnectTimeoutRef.current);
              reconnectTimeoutRef.current = null;
            }
            reconnectTimeoutRef.current = setTimeout(() => {
              reconnectTimeoutRef.current = null;
              if (isCurrentRun(generation)) connectSSE(targetJobId);
            }, backoffMs);
          } else {
            setExecutionLogs((prev) => [
              ...prev,
              "[ERROR] SSE connection lost permanently after maximum retry attempts.",
            ]);
            finalizeExecution(generation, {
              jobId: targetJobId,
              status: "failed",
              exitCode: 1,
              applyOutcomeHeuristics: false,
            });
          }
        };
      };

      connectSSE(jobId);
    } catch (err: unknown) {
      if (!isCurrentRun(generation)) return;
      if (err instanceof DOMException && err.name === "AbortError") return;
      const message = err instanceof Error ? err.message : String(err);
      setExecutionLogs((prev) => [...prev, `[ERROR] ${message}`]);
      finalizeExecution(generation, {
        jobId: null,
        status: "failed",
        exitCode: null,
        applyOutcomeHeuristics: false,
      });
    }
  }, [
    isRunning,
    state,
    hardwareProbe,
    setState,
    onRunStateChange,
    setExecutionLogs,
    beginNewRunEpoch,
    isCurrentRun,
    finalizeExecution,
  ]);

  return {
    liveJobId,
    isRunning,
    executionLogs,
    setExecutionLogs,
    executionLogsRef,
    executionStatus,
    executionExitCode,
    gpuMetrics,
    handleExecuteLive,
    handleCancelJob,
  };
}
