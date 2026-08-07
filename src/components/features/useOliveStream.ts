import { useState, useRef, useCallback, type Dispatch, type SetStateAction } from "react";
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
    setExecutionLogsState((prev) => {
      const next = typeof update === "function" ? update(prev) : update;
      executionLogsRef.current = next;
      return next;
    });
  }, []);
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

  const recordJobCompletion = useCallback(
    (jobId: string, status: "completed" | "failed" | "cancelled", exitCode: number | null) => {
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
    [state],
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
    try {
      setExecutionLogs((prev) => [...prev, "[INFO] Requesting process cancellation..."]);
      const resp = await fetch("/api/olive/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: liveJobId }),
      });
      const data = (await resp.json().catch(() => ({}))) as { status?: string; error?: string };
      if (resp.ok && data.status === "cancelled") {
        setExecutionLogs((prev) => [...prev, "[INFO] Cancellation signal confirmed by server."]);
        setExecutionStatus("cancelled");
        setExecutionExitCode(null);
        setIsRunning(false);
        onRunStateChange?.(false);
        liveSourceRef.current?.close();
        liveSourceRef.current = null;
        recordJobCompletion(liveJobId, "cancelled", null);
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
  }, [liveJobId, onRunStateChange, setExecutionLogs, recordJobCompletion]);

  const handleExecuteLive = useCallback(async () => {
    if (isRunning) return;

    const fresh = buildRecipeFromState(state, { hardwareProbe });

    if (!fresh.isRunnable) {
      const blockingCount = fresh.validation.criticalCount + fresh.localExecutionIssues.length;
      const freshSchemaErrors = fresh.schema.errors ?? [];
      const freshBlockLines = fresh.localExecutionIssues.map(
        (issue) => `[BLOCK] ${issue.title}: ${issue.description}`,
      );
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
      setExecutionStatus("failed");
      return;
    }

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
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
        setExecutionLogs((prev) => [...prev, `[ERROR] ${errData.error}`]);
        setExecutionStatus("failed");
        setIsRunning(false);
        onRunStateChange?.(false);
        pendingCancelRef.current = false;
        return;
      }

      const { jobId } = (await resp.json()) as { jobId: string };
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
          });
          const cancelData = (await cancelResp.json().catch(() => ({}))) as {
            status?: string;
            error?: string;
          };
          if (cancelResp.ok && cancelData.status === "cancelled") {
            setExecutionLogs((prev) => [...prev, "[INFO] Cancellation signal confirmed by server."]);
            setExecutionStatus("cancelled");
            setExecutionExitCode(null);
            setIsRunning(false);
            onRunStateChange?.(false);
            recordJobCompletion(jobId, "cancelled", null);
            return;
          }
          setExecutionLogs((prev) => [
            ...prev,
            cancelResp.ok
              ? `[INFO] Queued cancel found job already ${cancelData.status ?? "finished"}. Connecting stream.`
              : `[ERROR] Queued cancel failed: ${cancelData.error ?? "unknown"}. Continuing with stream.`,
          ]);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          setExecutionLogs((prev) => [
            ...prev,
            `[ERROR] Queued cancel failed: ${message}. Continuing with stream.`,
          ]);
        }
      }

      liveSourceRef.current?.close();

      let reconnectAttempts = 0;
      const MAX_RECONNECT_ATTEMPTS = 10;
      const MAX_BACKOFF_MS = 30000;

      const connectSSE = (targetJobId: string) => {
        if (isUnmountedRef.current) return;
        liveSourceRef.current?.close();

        const evtSource = new EventSource(`/api/olive/stream/${targetJobId}`);
        liveSourceRef.current = evtSource;

        evtSource.onopen = () => {
          if (reconnectAttempts > 0) {
            setExecutionLogs((prev) => [...prev, "[INFO] Stream reconnected successfully."]);
          }
          reconnectAttempts = 0;
        };

        evtSource.addEventListener("log", (e: MessageEvent) => {
          try {
            const payload = JSON.parse(String(e.data)) as { line?: string };
            if (payload.line) {
              setExecutionLogs((prev) => [...prev, payload.line!]);
            }
          } catch {
            /* ignore malformed */
          }
        });

        evtSource.addEventListener("metrics", (e: MessageEvent) => {
          try {
            const parsed: unknown = JSON.parse(e.data);
            const metrics = parseGpuMetrics(parsed);
            if (metrics) setGpuMetrics(metrics);
          } catch {
            /* ignore malformed */
          }
        });

        evtSource.addEventListener("done", (e: MessageEvent) => {
          let exitCode: number | null = null;
          let serverStatus: string | undefined;
          try {
            const payload = JSON.parse(e.data) as { exitCode?: number | null; status?: string };
            exitCode = typeof payload.exitCode === "number" ? payload.exitCode : null;
            serverStatus = payload.status;
          } catch {
            exitCode = null;
          }
          const currentLogs = executionLogsRef.current;
          let finalStatus: "completed" | "failed" | "cancelled";
          if (serverStatus === "cancelled") {
            finalStatus = "cancelled";
          } else if (exitCode === null) {
            finalStatus = "failed";
          } else {
            const failed = exitCode !== 0 || logsIndicateFailure(currentLogs);
            finalStatus = failed ? "failed" : "completed";
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
          recordJobCompletion(targetJobId, finalStatus, reportedExit);
          if (finalStatus === "failed") setMcpFixApplied("");
          evtSource.close();
          liveSourceRef.current = null;
        });

        evtSource.onerror = async () => {
          evtSource.close();
          if (isUnmountedRef.current) return;

          let serverSaysRunning = false;
          try {
            const statusResp = await fetch(`/api/olive/status/${targetJobId}`);
            if (statusResp.ok) {
              const statusData = await statusResp.json();
              if (
                statusData.status === "completed" ||
                statusData.status === "failed" ||
                statusData.status === "cancelled"
              ) {
                const finalStatus =
                  statusData.status === "completed"
                    ? "completed"
                    : statusData.status === "cancelled"
                      ? "cancelled"
                      : "failed";
                setExecutionStatus(finalStatus);
                setExecutionExitCode(statusData.exitCode ?? (finalStatus === "completed" ? 0 : 1));
                setIsRunning(false);
                onRunStateChange?.(false);
                recordJobCompletion(targetJobId, finalStatus, statusData.exitCode);
                if (finalStatus === "failed") setMcpFixApplied("");
                return;
              } else if (statusData.status === "running" || statusData.status === "setting_up") {
                serverSaysRunning = true;
              }
            }
          } catch {
            /* ignore status check failure */
          }

          if (serverSaysRunning || reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            const backoffMs = Math.min(1000 * Math.pow(1.5, reconnectAttempts), MAX_BACKOFF_MS);
            setExecutionLogs((prev) => [
              ...prev,
              `[WARN] Stream connection lost. Reconnecting (attempt ${reconnectAttempts}${serverSaysRunning ? "" : `/${MAX_RECONNECT_ATTEMPTS}`} in ${(backoffMs / 1000).toFixed(1)}s)...`,
            ]);

            reconnectTimeoutRef.current = setTimeout(() => {
              if (!isUnmountedRef.current) connectSSE(targetJobId);
            }, backoffMs);
          } else {
            setExecutionLogs((prev) => [
              ...prev,
              "[ERROR] SSE connection lost permanently after maximum retry attempts.",
            ]);
            setExecutionStatus("failed");
            setIsRunning(false);
            onRunStateChange?.(false);
            recordJobCompletion(targetJobId, "failed", 1);
          }
        };
      };

      connectSSE(jobId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setExecutionLogs((prev) => [...prev, `[ERROR] ${message}`]);
      setExecutionStatus("failed");
      setIsRunning(false);
      onRunStateChange?.(false);
    }
  }, [
    isRunning, state, hardwareProbe, setState, onRunStateChange,
    isUnmountedRef, setMcpFixApplied, setExecutionLogs, executionLogsRef,
    recordJobCompletion,
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
